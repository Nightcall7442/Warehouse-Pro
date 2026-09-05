import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Экран агента не должен звать запрос, который агенту закрыт.
 *
 * Так и вышло с окном быстрого заказа: оно открывается из каталога кнопкой
 * «Заказать» и брало магазины через shop.list — запрос для руководителя,
 * оператора и супервайзера. Агент видел ПУСТОЙ список магазинов: выбрать
 * некого, заказ не оформить. А каталог — ровно тот путь, которым агент и
 * заказывает, стоя у прилавка.
 *
 * Молча это и проходит: отказ по правам не роняет экран, он просто оставляет
 * список пустым, и выглядит как «магазинов нет».
 *
 * Список файлов ниже — то, что агент открывает в работе. Он закрытый нарочно:
 * дерево компонентов статически не обойти, а перечислить путь агента можно.
 */
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf8");

/** Вид процедуры -> роли, прямо из middleware. */
const PROC_ROLES: Record<string, string[]> = (() => {
  const mw = read("api/middleware.ts");
  const map: Record<string, string[]> = {};
  for (const m of mw.matchAll(/export const (\w+)\s*=\s*authedQuery[\s\S]{0,180}?requireRole\(\[([^\]]+)\]\)/g)) {
    map[m[1]] = m[2].split(",").map((r) => r.trim().replace(/"/g, ""));
  }
  // agentQuery объявлен присваиванием, своего requireRole у него нет.
  if (map.fieldSalesQuery) map.agentQuery = map.fieldSalesQuery;
  return map;
})();

/** Процедура -> её вид, по всем роутерам. */
const PROC_KIND: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const f of fs.readdirSync(path.resolve(ROOT, "api")).filter((x) => x.endsWith("-router.ts"))) {
    const src = read(`api/${f}`);
    const router = f.replace("-router.ts", "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    for (const m of src.matchAll(/^ {2}(\w+):\s*(\w+Query)/gm)) map[`${router}.${m[1]}`] = m[2];
  }
  return map;
})();

/** Экраны и компоненты, которые агент открывает в работе. */
const AGENT_FILES = [
  "src/pages/AgentDashboard.tsx",
  "src/pages/AgentShops.tsx",
  "src/pages/Catalog.tsx",
  "src/pages/AgentOrders.tsx",
  "src/pages/OfflineOrders.tsx",
  "src/components/orders/ShopSelector.tsx",
  "src/components/orders/ProductSelector.tsx",
  "src/components/orders/QuickOrderModal.tsx",
];

/**
 * Признаки, выведенные из роли: `const useMyShops = isAgent`, где `isAgent`
 * считан из `user?.role`. Запрос, выключенный таким признаком, закрыт агенту
 * намеренно — и это не беда, а замысел.
 *
 * Собираются разбором, а не списком имён: список пришлось бы править вслед за
 * каждым переименованием, и проверка начала бы врать. Два прохода — признак
 * часто выводится из другого признака.
 */
function roleFlagsOf(src: string): Set<string> {
  const flags = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    for (const d of src.matchAll(/const (\w+)\s*=\s*([^;\n]+)/g)) {
      const name = d[1];
      const expr = d[2];
      const fromRole = /user\?\.role|\brole\b/.test(expr);
      const fromFlag = [...flags].some((fl) => new RegExp(`\\b${fl}\\b`).test(expr));
      if (fromRole || fromFlag) flags.add(name);
    }
  }
  return flags;
}

describe("запросы на пути агента", () => {
  it("список файлов не разъехался с деревом", () => {
    // Иначе проверка ниже стерегла бы несуществующее и молчала.
    for (const f of AGENT_FILES) {
      expect(fs.existsSync(path.resolve(ROOT, f)), `нет файла ${f}`).toBe(true);
    }
    expect(Object.keys(PROC_ROLES).length, "не разобрали виды процедур").toBeGreaterThan(4);
    expect(Object.keys(PROC_KIND).length, "не разобрали процедуры").toBeGreaterThan(20);
  });

  it("каждый запрос, который агент реально выполняет, ему разрешён", () => {
    const broken: string[] = [];
    for (const f of AGENT_FILES) {
      const src = read(f);
      const flags = roleFlagsOf(src);

      for (const m of src.matchAll(/trpc\.(\w+)\.(\w+)\.useQuery\(([\s\S]{0,220}?)\)\s*;/g)) {
        const key = `${m[1]}.${m[2]}`;
        const roles = PROC_ROLES[PROC_KIND[key]];
        if (!roles || roles.includes("agent")) continue;

        const call = m[3];
        const gated = /enabled:/.test(call) && [...flags].some((fl) => new RegExp(`\\b${fl}\\b`).test(call));
        if (gated) continue;

        broken.push(`${f}: ${key} (${PROC_KIND[key]}: ${roles.join("/")})`);
      }
    }
    expect(broken, `агент вызывает закрытые ему запросы:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("разбор признаков роли работает — иначе проверка выше слепа", () => {
    /*
      Без этого «ни одной беды» означало бы лишь то, что каждый запрос сочли
      выключенным. Проверяем на настоящем файле: в ShopSelector магазины для
      начальства выключены признаком, выведенным из роли.
    */
    const flags = roleFlagsOf(read("src/components/orders/ShopSelector.tsx"));
    expect(flags.has("useMyShops"), `признак роли не распознан: ${[...flags].join(", ")}`).toBe(true);
  });
});

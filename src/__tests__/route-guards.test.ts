import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Кому какой маршрут открыт.
 *
 * Половина страниц не имела RoleGuard вовсе: пункта в меню у роли нет, а по
 * прямому адресу — закладка, ссылка в сообщении, кнопка «назад» — страница
 * открывалась и наполовину не работала. Курьер на «Каталоге» выдавал до сорока
 * отказов подряд и видел «не удалось загрузить» с кнопкой «Повторить», которая
 * повторяла тот же отказ.
 *
 * Это не защита — права проверяет сервер, у каждой процедуры requireRole.
 * Смысл в другом: не звать роль туда, где ей ответят отказом.
 *
 * Главная опасность правки — закрыть лишнее. Поэтому первая проверка здесь не
 * про «закрыто», а про «у роли осталось всё, что у неё в меню».
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const APP = read("src/App.tsx");
const CONST = read("src/const.ts");
const LAYOUT = read("src/components/Layout.tsx");
const PALETTE = read("src/components/CommandPalette.tsx");

const ROLES = ["ceo", "operator", "supervisor", "agent", "merchandiser", "courier", "superadmin"];

/** Маршруты и их RoleGuard из App.tsx. */
function routes(): Array<{ path: string; roles: string[] | null }> {
  const out: Array<{ path: string; roles: string[] | null }> = [];
  for (const m of APP.matchAll(/<Route path="([^"]+)"\s+element=\{(?:<RoleGuard roles=\{\[([^\]]*)\]\}>)?/g)) {
    out.push({ path: m[1], roles: m[2] ? m[2].split(",").map(x => x.trim().replace(/"/g, "")) : null });
  }
  return out;
}

const ROUTES = routes();

/** Может ли роль открыть путь: ищем самое длинное совпадение по маршрутам. */
function canOpen(path: string, role: string): boolean {
  const hit = ROUTES
    .filter(r => r.path === path || path.startsWith(r.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!hit) return true;          // маршрут не найден — не наше дело
  return hit.roles === null || hit.roles.includes(role);
}

/** Пути из бокового меню и нижней панели роли. */
function menuPaths(role: string): string[] {
  const paths = new Set<string>();
  const navAt = CONST.indexOf(`  ${role}: [`);
  if (navAt > 0) for (const m of CONST.slice(navAt, CONST.indexOf("],", navAt)).matchAll(/path: "([^"]+)"/g)) paths.add(m[1]);
  const body = LAYOUT.slice(LAYOUT.indexOf("const BOTTOM_NAV"));
  const botAt = body.indexOf(`  ${role}: [`);
  if (botAt > 0) for (const m of body.slice(botAt, body.indexOf("\n  ],", botAt)).matchAll(/path: "([^"]+)"/g)) paths.add(m[1]);
  return [...paths];
}

describe("разбор исходников", () => {
  it("маршруты и меню прочитались", () => {
    // Без этого все проверки ниже зелены на пустом множестве.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES.filter(r => r.roles !== null).length).toBeGreaterThan(15);
    for (const role of ROLES) expect(menuPaths(role).length, `меню роли ${role}`).toBeGreaterThan(0);
  });
});

describe("у роли не отняли её же разделы", () => {
  for (const role of ROLES) {
    it(`${role}: каждый пункт меню открывается`, () => {
      const broken = menuPaths(role).filter(p => !canOpen(p, role));
      expect(broken, `${role} не может открыть свои пункты: ${broken.join(", ")}`).toEqual([]);
    });
  }
});

describe("роль не заходит туда, где ей ответят отказом", () => {
  it("курьер — только свои разделы", () => {
    /*
      product.list и order.list — fieldSalesQuery, курьера там нет. Его
      рабочие экраны: доставки, свой KPI, настройки и уведомления.
    */
    for (const path of ["/catalog", "/products", "/orders", "/orders/new", "/offline-orders", "/barcode", "/shops", "/dashboard"]) {
      expect(canOpen(path, "courier"), `курьер всё ещё открывает ${path}`).toBe(false);
    }
    for (const path of ["/deliveries", "/agent/kpi", "/settings", "/notifications"]) {
      expect(canOpen(path, "courier"), `курьеру закрыли ${path}`).toBe(true);
    }
  });

  it("агент и мерчендайзер не ходят в офисные разделы", () => {
    // Магазины у них свои — /agent/shops; главная руководителя считается
    // запросами, которых им не отдадут.
    for (const role of ["agent", "merchandiser"]) {
      expect(canOpen("/shops", role)).toBe(false);
      expect(canOpen("/dashboard", role)).toBe(false);
      expect(canOpen("/warehouse", role)).toBe(false);
    }
  });

  it("оператор не открывает главную руководителя", () => {
    // Все четыре её запроса — supervisorQuery (ceo и супервайзер). Раньше
    // оператор видел там «не удалось загрузить» первым же экраном после входа;
    // с тех пор Home уводит его на «Заказы», а теперь и адрес закрыт.
    expect(canOpen("/dashboard", "operator")).toBe(false);
    expect(canOpen("/orders", "operator")).toBe(true);
  });

  it("супервайзер получил магазины и заказы, но не склад", () => {
    expect(canOpen("/shops", "supervisor")).toBe(true);
    expect(canOpen("/orders", "supervisor")).toBe(true);
    expect(canOpen("/warehouse", "supervisor")).toBe(false);
    expect(canOpen("/arrivals", "supervisor")).toBe(false);
  });

  it("общие разделы остаются общими", () => {
    // Настройки и уведомления — authedQuery, внутри каждый видит своё.
    for (const role of ROLES) {
      expect(canOpen("/settings", role), `${role} потерял настройки`).toBe(true);
      expect(canOpen("/notifications", role), `${role} потерял уведомления`).toBe(true);
    }
  });
});

describe("отказ объясняется", () => {
  it("вошедшему с другой ролью показывают экран, а не выкидывают молча", () => {
    const at = APP.indexOf("const RoleGuard");
    const body = APP.slice(at, APP.indexOf("});", at));
    expect(body, "не вошедшего по-прежнему ведём на вход").toContain('if (!user) return <Navigate to="/" replace />;');
    expect(body, "чужую роль снова выкидывают без объяснения").toContain("return <NoAccess />;");
  });
});

describe("палитра команд", () => {
  it("не предлагает то, что закрыто", () => {
    /*
      Палитра — второй вход в те же разделы, и список в ней был один на все
      роли: курьеру предлагались «Пользователи», «Склад» и «Главная».
    */
    const at = PALETTE.indexOf("const navItems");
    expect(at, "список пунктов палитры не найден").toBeGreaterThan(0);
    const end = PALETTE.indexOf(", [role]);", at);
    expect(end, "конец списка пунктов не найден").toBeGreaterThan(at);
    const block = PALETTE.slice(at, end);
    expect(block, "пункты палитры больше не знают о ролях").toContain("roles:");
    expect(block, "палитра не фильтруется").toContain("item.roles.includes(role)");

    /*
      Каждый пункт с адресом сверяется с маршрутом: у закрытого маршрута пункт
      обязан объявить роли, и они не шире тех, что пускает RoleGuard. Без
      первой половины достаточно стереть `roles:` у пункта — и он снова
      предлагается всем.
    */
    const items = [...block.matchAll(/\{ id: "([^"]+)"[\s\S]*?\},$/gm)];
    expect(items.length, "пункты палитры не разобрались").toBeGreaterThan(5);

    for (const item of items) {
      const src = item[0];
      const pathM = src.match(/path: "([^"]+)"/);
      if (!pathM) continue;
      const path = pathM[1];
      const rolesM = src.match(/roles: (\[[^\]]*\]|\w+)/);
      const guarded = ROLES.some(r => !canOpen(path, r));

      if (guarded) {
        expect(rolesM, `пункт «${item[1]}» ведёт на закрытый ${path}, но роли не объявлены`).not.toBeNull();
      }
      if (!rolesM) continue;

      const roles = rolesM[1].startsWith("[")
        ? rolesM[1].replace(/[[\]"]/g, "").split(",").map(x => x.trim()).filter(Boolean)
        : ["ceo", "operator", "supervisor", "agent", "merchandiser"]; // FIELD_ROLES
      for (const role of roles) {
        expect(canOpen(path, role), `палитра зовёт ${role} на ${path}, а маршрут закрыт`).toBe(true);
      }
    }
  });
});

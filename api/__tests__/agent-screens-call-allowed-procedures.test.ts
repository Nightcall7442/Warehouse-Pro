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

/* ═══════════════════════════════════════════════════════════════════════════
   То же самое для экрана СУПЕРАДМИНА — и та же беда там уже была.

   ── Что нашлось ─────────────────────────────────────────────────────────────

   Блок «Заявки с сайта» стоит на странице Super Admin и зовёт `lead.list` и
   `lead.markHandled`. Обе были объявлены на adminQuery — «директор арендатора,
   суперадмин ИСКЛЮЧЁН намеренно» (так и написано в middleware). То есть экран
   написан, ручки написаны, и ровно между ними лежала одна строка: заявки
   копились, а видеть их было некому.

   Вторая половина той же ошибки страшнее: у таблицы `leads` нет организации —
   это заявки с САЙТА, общие для всей платформы. adminQuery означал, что любой
   директор любого арендатора мог прочитать двести последних: имена, компании,
   телефоны и комментарии чужих людей.

   Одна неверная строка давала одновременно мёртвый экран у того, кому нужно, и
   открытую дверь тому, кому нельзя.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Экраны, которые открывает ТОЛЬКО суперадмин. */
const SUPERADMIN_FILES = [
  "src/pages/SuperAdmin.tsx",
  "src/components/superadmin/PlatformStats.tsx",
  "src/components/superadmin/TenantList.tsx",
  "src/components/superadmin/TenantDetail.tsx",
  "src/components/superadmin/LeadInbox.tsx",
  "src/components/superadmin/FeatureUsage.tsx",
  "src/components/superadmin/SandboxSection.tsx",
  "src/components/superadmin/CreateTenantModal.tsx",
];

describe("запросы на экране суперадмина", () => {
  it("список файлов не разъехался с деревом", () => {
    for (const f of SUPERADMIN_FILES) {
      expect(fs.existsSync(path.resolve(ROOT, f)), `нет файла ${f}`).toBe(true);
    }
  });

  it("каждый запрос и каждая правка ему разрешены", () => {
    /*
      Проверяются и запросы, и мутации: у заявок сломаны были обе — и чтение
      списка, и отметка «разобрано».

      Личные ручки суперадмина (свой профиль, свой пароль) объявлены на
      authedQuery — без requireRole вовсе, — и поэтому в PROC_ROLES их нет:
      они открыты каждому, кто вошёл, и беды не составляют.
    */
    const broken: string[] = [];
    for (const f of SUPERADMIN_FILES) {
      const src = read(f);
      for (const m of src.matchAll(/trpc\.(\w+)\.(\w+)\.use(?:Query|Mutation)\(/g)) {
        const key = `${m[1]}.${m[2]}`;
        const kind = PROC_KIND[key];
        const roles = PROC_ROLES[kind];
        if (!roles || roles.includes("superadmin")) continue;
        broken.push(`${f}: ${key} (${kind}: ${roles.join("/")})`);
      }
    }
    expect(broken, `суперадмин вызывает закрытые ему ручки:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("разбор видит ручки суперадмина — иначе проверка выше слепа", () => {
    /*
      Без этого «ни одной беды» означало бы лишь то, что ни одной ручки не
      разобрали. Берём заведомо существующую: список арендаторов.
    */
    expect(PROC_KIND["tenant.list"], "не разобрали tenant.list").toBe("superAdminQuery");
    expect(PROC_ROLES.superAdminQuery, "не разобрали роли суперадмина").toEqual(["superadmin"]);
    expect(PROC_KIND["lead.list"], "не разобрали lead.list").toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Общие данные платформы не открываются арендатору.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("заявки с сайта — данные платформы, а не арендатора", () => {
  it("у таблицы заявок нет организации — значит защищает только роль", () => {
    /*
      Это и есть причина, по которой роль здесь важнее обычного: у остальных
      таблиц есть tenant_id, и даже промах в роли не выпустил бы данные за
      пределы своей организации. Здесь выпустил бы сразу все.
    */
    const schema = read("db/schema.ts");
    const at = schema.indexOf("export const leads = mysqlTable(");
    expect(at, "таблицы заявок нет").toBeGreaterThan(-1);
    const body = schema.slice(at, schema.indexOf("export const ", at + 10));
    expect(body, "у заявок появилась организация — правило ниже надо пересмотреть")
      .not.toContain("tenantId");
  });

  it("читать и отмечать их может только суперадмин", () => {
    for (const proc of ["lead.list", "lead.markHandled"]) {
      expect(PROC_KIND[proc], `${proc}: ручка пропала`).toBeTruthy();
      expect(PROC_ROLES[PROC_KIND[proc]], `${proc}: открыт не тому`).toEqual(["superadmin"]);
    }
  });

  it("оставить заявку по-прежнему можно без входа", () => {
    // Иначе форма на лендинге перестала бы работать, а заметили бы это по
    // тишине в разборе заявок — то есть не сразу.
    const src = read("api/lead-router.ts");
    expect(src).toContain("create: publicQuery");
  });
});


/* ═══════════════════════════════════════════════════════════════════════════
   Старение долга: кому оно открыто.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("супервайзер видит, КАК ДАВНО висит долг", () => {
  it("ручка открыта владельцу, оператору и супервайзеру", () => {
    /*
      От этого набора зависит целая вкладка в телефоне («Долги»), и её
      видимость выведена из этих же ролей. Сузь набор — и супервайзер получит
      экран с отказом; расширь — и агент увидит долги чужих маршрутов.

      Супервайзера здесь не было изначально, и это была дыра в его работе, а
      не бережность: долговой журнал, карточку долга и список должников с
      суммами он видел и так. Не хватало ровно возраста — того единственного,
      из чего он решает, к кому ехать сегодня.
    */
    expect(PROC_KIND["shop.receivablesAging"], "ручка старения долга пропала").toBe("managementQuery");
    expect(PROC_ROLES.managementQuery, "набор ролей разошёлся с вкладкой в телефоне")
      .toEqual(["ceo", "operator", "supervisor"]);
  });

  it("оператор доступа не потерял", () => {
    // Он собирает долг: обе стороны расчётов ему нужны в одном месте.
    expect(PROC_ROLES[PROC_KIND["shop.receivablesAging"]]).toContain("operator");
  });

  it("возраст и суммы приходят одним ответом", () => {
    /*
      Телефон в поле не должен собирать экран из двух запросов: связь там
      рвётся, и половина ответа — это список без сумм или суммы без имён.
    */
    /*
      Поля ищутся в САМОМ договоре ShopAging и по имени целиком.

      Первая попытка искала подстроку по всему файлу — и молчала, когда поле
      переименовали в `oldestDaysGone`: старое имя осталось внутри нового и
      в тексте запроса. Поймано нарочной поломкой.
    */
    const SRC = read("api/services/receivables.ts");
    const at = SRC.indexOf("export interface ShopAging {");
    expect(at, "договор ShopAging пропал").toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf("\n}", at));

    for (const field of ["oldestDays", "phone", "agentName", "buckets", "unattributed", "debt"]) {
      expect(body, `в ответе нет поля ${field}`).toMatch(new RegExp(`\\b${field}\\??:`));
    }
  });
});

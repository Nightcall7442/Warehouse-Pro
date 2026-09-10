import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OPERATOR_CAPABILITIES } from "@contracts/constants";

/**
 * Права оператора настраиваются по организациям.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Роли зашиты в middleware и одинаковы для всех арендаторов: оператор везде
 * может удалить заказ, править товары, принимать деньги и корректировать
 * остатки. Организации же устроены по-разному — в одной оператор правая рука
 * директора, в другой наёмный человек на телефоне, которому удалять заказы
 * нельзя. Отобрать было нечем: любая просьба упиралась в «перепишем роль всем».
 *
 * ── Как устроено ────────────────────────────────────────────────────────────
 *
 * Роль осталась потолком, настройка только опускает пол: разрешить сверх роли
 * отсюда нельзя, можно лишь запретить. В таблице лежат ТОЛЬКО отличия от
 * умолчания — нет строки, значит можно, как и раньше. Поэтому выкладка не
 * меняет поведение ни одному арендатору.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * 1. Умолчание — «можно», и мусор в базе его не ломает.
 * 2. Роли без настройки (директор, агент) не теряют ничего.
 * 3. Каждая возможность действительно закрывает хотя бы одну процедуру —
 *    иначе переключатель в настройках обещает то, чего не делает.
 * 4. Проверка стоит ПОСЛЕ вида процедуры, а не вместо него: вид — то, по чему
 *    стражи ролей узнают, кому ручка открыта.
 * 5. Экран есть у обоих: у директора в настройках, у суперадмина в карточке.
 */
const store = new Map<string, unknown>();
vi.mock("../lib/cache", () => ({
  cache: {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => { store.set(k, v); },
    invalidate: (k: string) => { store.delete(k); },
  },
  CacheKeys: {},
  CacheTTL: {},
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { capabilitiesOf, capabilityMap, forgetCapabilities } from "../lib/role-permissions";

function dbWith(rows: Array<{ capability: string; allowed: boolean }>) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as never;
}

beforeEach(() => store.clear());

describe("что можно оператору", () => {
  it("без настройки — всё, как было до этой возможности", async () => {
    const map = await capabilityMap(dbWith([]), 1, "operator");
    expect(Object.keys(map).sort()).toEqual([...OPERATOR_CAPABILITIES].sort());
    expect(Object.values(map).every(v => v === true)).toBe(true);
  });

  it("строка с запретом закрывает ровно одно действие", async () => {
    const map = await capabilityMap(dbWith([{ capability: "orders.delete", allowed: false }]), 1, "operator");
    expect(map["orders.delete"]).toBe(false);
    expect(map["orders.edit"]).toBe(true);
  });

  it("неизвестное имя в базе не попадает в ответ", async () => {
    /*
      Возможность когда-нибудь переименуют, а строка останется. Набор ключей
      задаёт код: иначе на экране появился бы переключатель-призрак, который
      ничего не закрывает, и никто бы не заметил.
    */
    const map = await capabilityMap(dbWith([{ capability: "orders.teleport", allowed: false }]), 1, "operator");
    expect("orders.teleport" in map).toBe(false);
    expect(Object.values(map).every(v => v === true)).toBe(true);
  });

  it("роли без настройки не теряют ничего", async () => {
    // Директор — владелец прав; отбирать у него настройкой, которую он же и
    // ведёт, бессмысленно. Агент и супервайзер до этих процедур не доходят.
    for (const role of ["ceo", "agent", "supervisor", "superadmin"]) {
      const map = await capabilitiesOf(dbWith([{ capability: "orders.delete", allowed: false }]), 1, role);
      expect(map["orders.delete"], `${role} потерял право`).toBe(true);
    }
  });

  it("настройка одной организации не видна другой", async () => {
    const denied = dbWith([{ capability: "orders.delete", allowed: false }]);
    expect((await capabilityMap(denied, 1, "operator"))["orders.delete"]).toBe(false);
    // Ключ кэша включает организацию — иначе сосед по кэшу получил бы чужой запрет.
    expect((await capabilityMap(dbWith([]), 2, "operator"))["orders.delete"]).toBe(true);
  });

  it("после правки настройка перечитывается", async () => {
    await capabilityMap(dbWith([]), 1, "operator");
    forgetCapabilities(1, "operator");
    const map = await capabilityMap(dbWith([{ capability: "import.run", allowed: false }]), 1, "operator");
    expect(map["import.run"]).toBe(false);
  });
});

// ── Разбор исходников ────────────────────────────────────────────────────────
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const ROUTERS = fs.readdirSync(path.resolve(ROOT, "api"))
  .filter(f => f.endsWith("-router.ts"))
  .map(f => ({ file: f, src: read(`api/${f}`) }));

describe("переключатель закрывает настоящие ручки", () => {
  const guarded = ROUTERS.flatMap(r =>
    [...r.src.matchAll(/\n {2}(\w+): (\w+Query)\.use\(can\("([\w.]+)"\)\)/g)]
      .map(m => ({ file: r.file, proc: m[1], kind: m[2], cap: m[3] })));

  it("каждая возможность закрывает хотя бы одну процедуру", () => {
    /*
      Иначе получается переключатель, который ничего не делает: человек его
      выключает, верит, что закрыл действие, а оно работает. В этом продукте
      «написано, но не вызывается» уже случалось не раз.
    */
    const covered = new Set(guarded.map(g => g.cap));
    const dead = OPERATOR_CAPABILITIES.filter(c => !covered.has(c));
    expect(dead, `возможности без единой процедуры: ${dead.join(", ")}`).toEqual([]);
  });

  it("закрываются только те действия, что названы в списке", () => {
    const unknown = guarded.filter(g => !(OPERATOR_CAPABILITIES as readonly string[]).includes(g.cap));
    expect(unknown.map(g => `${g.file}:${g.proc} → ${g.cap}`)).toEqual([]);
  });

  it("проверка стоит ПОСЛЕ вида процедуры, а не вместо него", () => {
    /*
      `delete: operatorQuery.use(can(...))`, а не `delete: opCan(...)`. Вид
      процедуры — единственное, по чему и человек, и стражи ролей в этом наборе
      узнают, кому ручка открыта; спрячь его за обёрткой — они замолчат.
    */
    expect(guarded.length, "ни одна процедура не закрыта настройкой").toBeGreaterThan(20);
    /*
      Вид процедуры обязан быть — но не обязан быть именно operatorQuery.

      order.updateItems открыт агенту сознательно: заказ оформляет он, и
      «добавьте ещё две коробки» он слышит в магазине, а не оператор в офисе.
      Настройка директора при этом продолжает действовать — can() ограничивает
      ОПЕРАТОРА и никого больше, — а границы агента стоят своими проверками
      внутри (свой заказ, и пока он не уехал).

      Поэтому здесь проверяется то, ради чего страж и написан: что настройка
      не подменяет собой вид процедуры. Списка допустимых видов ровно два, и
      расширять его дальше — осознанное решение, а не правка на ходу.
    */
    const ALLOWED_KINDS = ["operatorQuery", "fieldSalesQuery"];
    const odd = guarded.filter(g => !ALLOWED_KINDS.includes(g.kind));
    expect(odd.map(g => `${g.file}:${g.proc} → ${g.kind}`), "настройка стоит на неожиданном виде процедуры").toEqual([]);
    for (const r of ROUTERS) {
      expect(r.src, `${r.file}: can() применён без вида процедуры`).not.toMatch(/\n {2}\w+: can\(/);
    }
  });

  it("удаление заказа и приём денег закрыты — то, ради чего это делалось", () => {
    const has = (proc: string, cap: string) => guarded.some(g => g.proc === proc && g.cap === cap);
    expect(has("delete", "orders.delete"), "order.delete не закрыт").toBe(true);
    expect(has("restore", "orders.delete") || has("restore", "shops.delete")).toBe(true);
    expect(has("addPayment", "payments.accept")).toBe(true);
    expect(has("adjustStock", "warehouse.adjust")).toBe(true);
  });
});

describe("проверка сама по себе", () => {
  const MW = read("api/middleware.ts");

  it("касается только оператора и только запрещает", () => {
    const at = MW.indexOf("export function can(");
    expect(at).toBeGreaterThan(0);
    const body = MW.slice(at, MW.indexOf("\n}", at));
    expect(body).toContain('ctx.user?.role === "operator"');
    // Именно `=== false`: отсутствие ключа не должно читаться как запрет.
    expect(body).toContain("map[capability] === false");
    expect(body).toContain("FORBIDDEN");
  });

  it("отказ объясняет, что решение приняла организация", () => {
    // «Недостаточно прав» отправило бы человека спорить с платформой, а решение
    // принял его собственный руководитель.
    expect(MW).toContain("закрыто оператору в вашей организации");
  });
});

describe("настройка доступна обоим", () => {
  const ACCESS = read("api/access-router.ts");

  it("директор правит свою организацию, суперадмин — названную", () => {
    expect(ACCESS).toMatch(/^ {2}operatorAccess: adminQuery/m);
    expect(ACCESS).toMatch(/^ {2}setOperatorAccess: adminQuery/m);
    expect(ACCESS).toMatch(/^ {2}operatorAccessFor: superAdminQuery/m);
    expect(ACCESS).toMatch(/^ {2}setOperatorAccessFor: superAdminQuery/m);
    /*
      Директору id организации не передаётся вовсе — он берётся из ключа.
      Пришли он его сам, пропущенная проверка означала бы правку чужих прав.
    */
    const own = ACCESS.slice(ACCESS.indexOf("setOperatorAccess:"), ACCESS.indexOf("operatorAccessFor:"));
    expect(own).toContain("ctx.tenant.id");
    expect(own).not.toContain("input.tenantId");
  });

  it("разрешение — это удаление строки, а не строка со значением true", () => {
    // Умолчание задаёт код; копия умолчания в базе однажды с ним разойдётся.
    const write = ACCESS.slice(ACCESS.indexOf("async function writeAccess"));
    expect(write).toContain("delete(rolePermissions)");
    expect(write).toContain("allowed: false");
    expect(write).not.toContain("allowed: true");
  });

  it("отобранное право попадает в журнал", () => {
    expect(ACCESS).toContain('action: "access.operator"');
  });

  it("роутер подключён", () => {
    expect(read("api/router.ts")).toContain("access:       accessRouter,");
  });
});

describe("экраны знают, что закрыто", () => {
  it("возможности приезжают вместе с auth.me", () => {
    // Отдельным запросом экран успел бы нарисовать кнопку до того, как узнал,
    // что она закрыта, и человек нажал бы её ради отказа.
    expect(read("api/auth-router.ts")).toContain("can: await capabilitiesOf(");
  });

  it("умолчание на экране — «можно», пока ответ не пришёл", () => {
    // Иначе кнопки мигают «появились — исчезли» на каждом открытии страницы.
    expect(read("src/hooks/useCan.ts")).toContain("!== false");
  });

  it("настройка есть у директора и у суперадмина", () => {
    expect(read("src/pages/Settings.tsx")).toContain("<OperatorAccess />");
    expect(read("src/components/superadmin/TenantDetail.tsx")).toContain("<OperatorAccess tenantId={tenantId} />");
  });

  it("кнопки, которые могут не сработать, спрятаны", () => {
    const pages: Array<[string, string]> = [
      ["src/pages/Orders.tsx", "orders.delete"],
      ["src/pages/OrderDetail.tsx", "orders.delete"],
      ["src/pages/Products.tsx", "products.manage"],
      ["src/pages/Warehouse.tsx", "warehouse.adjust"],
      ["src/pages/ShopDetail.tsx", "shops.delete"],
      ["src/components/orders/OrderSlideOver.tsx", "payments.accept"],
      ["src/components/counterparties/CounterpartiesSection.tsx", "suppliers.manage"],
      ["src/pages/AgentKpi.tsx", "commission.manage"],
    ];
    const missing = pages.filter(([f, cap]) => !read(f).includes(`can("${cap}")`));
    expect(missing.map(([f]) => f), "экран не спрашивает про закрытое действие").toEqual([]);
  });

  it("список переключателей на экране совпадает со списком в коде", () => {
    // Забытый ярлык — это переключатель без названия; лишний — обещание того,
    // чего сервер не знает.
    const ui = read("src/components/settings/OperatorAccess.tsx");
    for (const cap of OPERATOR_CAPABILITIES) {
      expect(ui, `нет подписи для ${cap}`).toContain(`"${cap}"`);
    }
  });
});

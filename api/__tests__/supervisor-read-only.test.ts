import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canOperate, canAdminister, canSupervise } from "../../src/lib/permissions";

/**
 * Супервайзер получил «Магазины» и «Заказы» — на чтение.
 *
 * Сервер и раньше отдавал ему и то и другое (shop.list — managementQuery,
 * order.list — fieldSalesQuery), а в мобильном приложении «Магазины» у него
 * вкладкой. В вебе пунктов не было: чтобы посмотреть точку своего агента или
 * его заказ, надо было знать адрес страницы наизусть.
 *
 * Открыть страницу мало: на ней полно кнопок оператора — завести магазин,
 * удалить, очистить всё, импортировать, сменить статус заказа, назначить
 * курьера, напечатать накладные. Каждая из них ответила бы супервайзеру
 * отказом, то есть страница обещала бы то, чего не может.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const MW = read("api/middleware.ts");
const CONST = read("src/const.ts");
const LAYOUT = read("src/components/Layout.tsx");
const SHOPS = read("src/pages/Shops.tsx");
const SHOP_DETAIL = read("src/pages/ShopDetail.tsx");
const SHOP_LIST = read("src/components/shops/ShopList.tsx");
const SHOP_CARD = read("src/components/shops/ShopCard.tsx");
const ORDERS = read("src/pages/Orders.tsx");
const KANBAN = read("src/components/orders/OrderKanbanBoard.tsx");
const ROUTER = read("api/router.ts");

function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const m = MW.slice(at, MW.indexOf(";", at)).match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}

function kindOfCall(call: string): string {
  const [routerKey, proc] = call.split(".");
  const imports = new Map<string, string>();
  for (const m of ROUTER.matchAll(/import \{ (\w+) \}\s+from\s+"\.\/([\w-]+)"/g)) imports.set(m[1], m[2]);
  const mount = ROUTER.match(new RegExp(`^\\s*${routerKey}:\\s*(\\w+),`, "m"));
  expect(mount, `роутер ${routerKey} не подключён`).not.toBeNull();
  const file = imports.get(mount![1])!;
  const m = read(`api/${file}.ts`).match(new RegExp(`^  ${proc}:\\s*(\\w+Query)`, "m"));
  expect(m, `процедура ${call} не найдена`).not.toBeNull();
  return m![1];
}

/** Пункты меню роли из src/const.ts. */
function navPaths(role: string): string[] {
  const at = CONST.indexOf(`  ${role}: [`);
  expect(at, `меню роли ${role} не найдено`).toBeGreaterThan(0);
  return [...CONST.slice(at, CONST.indexOf("],", at)).matchAll(/path: "([^"]+)"/g)].map(m => m[1]);
}

/** Пункты нижней панели роли из Layout.tsx. */
function bottomPaths(role: string): string[] {
  const body = LAYOUT.slice(LAYOUT.indexOf("const BOTTOM_NAV"));
  const at = body.indexOf(`  ${role}: [`);
  expect(at, `нижняя панель роли ${role} не найдена`).toBeGreaterThan(0);
  return [...body.slice(at, body.indexOf("\n  ],", at)).matchAll(/path: "([^"]+)"/g)].map(m => m[1]);
}

describe("права на экране повторяют серверные", () => {
  /*
    Фронтенд не может спросить сервер, кому что можно, поэтому границы в
    src/lib/permissions.ts — копия. Копия без сверки расходится с оригиналом:
    кто-нибудь расширит operatorQuery, а кнопка останется спрятанной, и никто
    не поймёт почему.
  */
  const ROLES = ["ceo", "operator", "supervisor", "agent", "merchandiser", "courier", "superadmin"];

  it("canOperate — это operatorQuery", () => {
    const allowed = new Set(rolesOf("operatorQuery"));
    for (const role of ROLES) expect(canOperate(role), role).toBe(allowed.has(role));
  });

  it("canAdminister — это adminQuery", () => {
    const allowed = new Set(rolesOf("adminQuery"));
    for (const role of ROLES) expect(canAdminister(role), role).toBe(allowed.has(role));
  });

  it("canSupervise — это supervisorQuery", () => {
    const allowed = new Set(rolesOf("supervisorQuery"));
    for (const role of ROLES) expect(canSupervise(role), role).toBe(allowed.has(role));
  });

  it("без роли — ничего", () => {
    // Пока auth.me не ответил, user?.role — undefined. Кнопки в это время
    // рисовать нельзя: покажем и тут же спрячем.
    expect(canOperate(undefined)).toBe(false);
    expect(canAdminister(undefined)).toBe(false);
    expect(canSupervise(undefined)).toBe(false);
  });
});

describe("магазины и заказы в меню супервайзера", () => {
  it("есть и в боковом меню, и в нижней панели", () => {
    // На телефоне нижняя панель — единственный способ перейти между экранами.
    for (const path of ["/shops", "/orders"]) {
      expect(navPaths("supervisor"), `${path} нет в боковом меню`).toContain(path);
      expect(bottomPaths("supervisor"), `${path} нет в нижней панели`).toContain(path);
    }
  });

  it("нижняя панель не растянута сверх шести пунктов", () => {
    // Внизу помещается шесть; седьмой сминает подписи в нечитаемое.
    expect(bottomPaths("supervisor").length).toBeLessThanOrEqual(6);
  });

  it("страницы, куда ведут пункты, ему отвечают", () => {
    /*
      Смысл всей правки. Если чтение магазинов или заказов когда-нибудь сузят
      до оператора, пункт меню станет дверью в «не удалось загрузить».
    */
    for (const call of ["shop.list", "shop.getById", "shop.territories", "order.list", "order.getById", "order.stats"]) {
      expect(rolesOf(kindOfCall(call)), `${call} закрыт супервайзеру`).toContain("supervisor");
    }
  });
});

describe("магазины: смотреть можно, править нельзя", () => {
  it("страница знает, кто перед ней", () => {
    expect(SHOPS).toContain('import { canOperate } from "@/lib/permissions"');
    expect(SHOPS).toContain("const canEdit = canOperate(user?.role);");
  });

  it("импорт, очистка и добавление — под условием", () => {
    // Все три — operatorQuery: shop.create, shop.clearAll, import.executeImport.
    const toolbar = SHOPS.slice(SHOPS.indexOf("{canEdit && (<>"), SHOPS.indexOf("</>)}"));
    expect(toolbar, "кнопка импорта осталась снаружи").toContain("setShowImport");
    expect(toolbar, "очистка осталась снаружи").toContain("clearAllMutation.mutate()");
    expect(toolbar, "добавление осталось снаружи").toContain("setShowForm");
    expect(SHOPS).toContain("{canEdit && showForm && <ShopForm");
    expect(SHOPS).toContain("{canEdit && showImport && <ExcelImport");
  });

  it("территории остаются доступны — это его работа", () => {
    // territory.create и соседи — supervisorQuery.
    expect(rolesOf(kindOfCall("territory.create"))).toContain("supervisor");
    const at = SHOPS.indexOf("setShowTerritoryManager(true)");
    expect(at, "кнопка территорий пропала").toBeGreaterThan(0);
    expect(SHOPS.slice(at - 400, at), "территории закрыли вместе с правкой").not.toContain("{canEdit && (<>");
  });

  it("галочки для удаления пачкой — только тем, кто удаляет", () => {
    expect(SHOPS).toContain("selectable={canEdit}");
    expect(SHOPS).toContain("{canEdit && selected.size > 0 && (");
    expect(SHOP_LIST).toContain("selectable = true");
    expect(SHOP_LIST).toContain("{selectable && data && data.length > 0 && (");
    expect(SHOP_LIST).toContain("onToggleSelect={selectable ? () => onToggleSelect(s.id) : undefined}");
  });

  it("фото точки в списке меняет только оператор", () => {
    // shop.uploadPhoto — operatorQuery, а карточка живёт в общем списке:
    // раньше отказ прилетал уже после выбора файла.
    expect(SHOP_CARD).toContain("const canEdit = canOperate(user?.role);");
    expect(SHOP_CARD).toContain('onClick={canEdit ? () => fileRef.current?.click() : undefined}');
  });

  it("карточка магазина: правка, удаление, платёж и фото закрыты", () => {
    expect(SHOP_DETAIL).toContain("const canEdit = canOperate(user?.role);");
    expect(SHOP_DETAIL).toContain("{canEdit && (\n        <div className=\"flex gap-2\">");
    expect(SHOP_DETAIL).toContain('onClick={canEdit ? () => fileRef.current?.click() : undefined}');
    const pay = SHOP_DETAIL.indexOf('data-testid="payment-open"');
    expect(pay, "кнопка платежа не найдена").toBeGreaterThan(0);
    expect(SHOP_DETAIL.slice(pay - 200, pay), "платёж остался открытым").toContain("{canEdit && (");
    // Список пользователей — ceo-only; спрашиваем его только у тех, кто правит.
    expect(SHOP_DETAIL).toContain("{ enabled: canEdit }");
  });
});

describe("заказы: смотреть можно, вести нельзя", () => {
  it("смена статуса из строки закрыта", () => {
    /*
      «В работу» и «Выполнен» зовут order.updateStatus (operatorQuery). Вторая
      — через окно приёмки, то есть отказ прилетал уже после заполнения формы.
    */
    const at = ORDERS.indexOf("if (OPEN_STATUSES.includes(o.status)) {");
    expect(at, "действия строки не найдены").toBeGreaterThan(0);
    expect(ORDERS.slice(at, at + 600)).toContain("if (!isOperatorOrCeo) return null;");
  });

  it("панель массовых действий и выделение — только оператору", () => {
    expect(ORDERS).toContain("{isOperatorOrCeo && (\n    <OrderBulkActions");
    expect(ORDERS).toContain("{isOperatorOrCeo && (\n                <th style={{ width: \"40px\"");
    expect(ORDERS).toContain("{isOperatorOrCeo && (\n                      <td style={{ padding: \"14px 8px 14px 16px\"");
  });

  it("доска смотрится, но не двигается", () => {
    // Перетаскивание — та же смена статуса. Без обработчика карточки просто
    // не таскаются, вместо отказа после броска.
    expect(KANBAN).toContain("onStatusChange?: (orderId: number, newStatus: string) => void;");
    expect(KANBAN).toContain("draggable={!!onStatusChange}");
    expect(ORDERS).toContain("onStatusChange={isOperatorOrCeo ?");
  });

  it("списки агентов и курьеров не запрашиваются впустую", () => {
    // user.list — adminQuery: у супервайзера оба запроса уходили в отказ на
    // каждом открытии страницы.
    expect(ORDERS).toContain('trpc.user.list.useQuery({ role: "agent", pageSize: 200 }, { enabled: isOperatorOrCeo })');
    expect(ORDERS).toContain('trpc.user.list.useQuery({ role: "courier", pageSize: 100 }, { enabled: isOperatorOrCeo })');
  });
});

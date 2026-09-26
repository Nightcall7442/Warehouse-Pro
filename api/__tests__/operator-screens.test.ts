import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Что оператору показывают — то сервер ему и отдаёт.
 *
 * Прогон 20.09.2026: у оператора на главной, магазинах и заказах в консоли
 * «Insufficient permissions». user.list стоял под adminQuery (один
 * руководитель), а экраны оператора звали его четырежды — назначить курьера,
 * закрепить агента за магазином, ставки ЗП; shop.districts — под
 * supervisorQuery, а «Магазины» открыты и оператору. Отказ выглядел не
 * ошибкой, а пустым списком: оператор не мог назначить курьера и считал,
 * что курьеров нет.
 *
 * Здесь два стража. Точечный — про эти две ручки. Общий — про привычку:
 * каждый запрос, который экран из меню оператора шлёт безусловно или под
 * условием «оператор или руководитель», должен идти в ручку, куда оператора
 * пускают. Иначе экран обещает то, чего сервер не отдаст.
 *
 * Нарочная поломка: верни `list: adminQuery` в user-router — упадут обе
 * проверки; поставь `enabled: isOperatorOrCeo` у запроса к ручке
 * adminQuery на любой странице оператора — упадёт общая.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const MW = read("api/middleware.ts");
const APP = read("src/App.tsx");
const ROUTER = read("api/router.ts");

const ALL_ROLES = ["superadmin", "ceo", "operator", "agent", "supervisor", "merchandiser", "courier"];

function rolesOf(kind: string): string[] {
  // authedQuery — любой вошедший, без requireRole.
  if (kind === "authedQuery") return ALL_ROLES;
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const decl = MW.slice(at, MW.indexOf(";", at));
  const m = decl.match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}

/** Вид процедуры по имени в дереве роутеров: "user.list" → "operatorQuery"; null — не нашли. */
function kindOfCall(call: string): string | null {
  const [routerKey, proc] = call.split(".");
  const imports = new Map<string, string>();
  for (const m of ROUTER.matchAll(/import \{ (\w+) \}\s+from\s+"\.\/([\w-]+)"/g)) imports.set(m[1], m[2]);
  const mount = ROUTER.match(new RegExp(`^\\s*${routerKey}:\\s*(\\w+),`, "m"));
  if (!mount) return null;
  const file = imports.get(mount[1]);
  if (!file || !fs.existsSync(path.resolve(process.cwd(), `api/${file}.ts`))) return null;
  const m = read(`api/${file}.ts`).match(new RegExp(`^  ${proc}:\\s*(\\w+Query)`, "m"));
  return m ? m[1] : null;
}

function routeRoles(routePath: string): string[] {
  const at = APP.indexOf(`path="${routePath}"`);
  expect(at, `маршрут ${routePath} не найден`).toBeGreaterThan(0);
  const m = APP.slice(at, APP.indexOf("/>", at)).match(/roles=\{\[([^\]]+)\]\}/);
  expect(m, `${routePath} без RoleGuard`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}

/** Аргументы вызова от открывающей скобки до парной закрывающей. */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return src.slice(openParen + 1, i); }
  }
  return src.slice(openParen + 1);
}

/** Запросы файла: ручка и текст аргументов. */
function queriesOf(file: string): Array<{ call: string; args: string }> {
  const src = read(file);
  const out: Array<{ call: string; args: string }> = [];
  for (const m of src.matchAll(/trpc\.(\w+)\.(\w+)\.useQuery\(/g)) {
    out.push({ call: `${m[1]}.${m[2]}`, args: callArgs(src, m.index! + m[0].length - 1) });
  }
  return out;
}

/** Экраны из меню оператора (NAV_ITEMS.operator) и компоненты, которые они держат
    на странице. «Главная» оператора — не Dashboard: Home уводит его на «Заказы». */
const OPERATOR_SCREENS = [
  "src/pages/Shops.tsx", "src/pages/ShopDetail.tsx", "src/pages/Orders.tsx", "src/pages/OrderDetail.tsx",
  "src/pages/Returns.tsx", "src/pages/Warehouse.tsx", "src/pages/Arrivals.tsx", "src/pages/ArrivalEditor.tsx", "src/pages/Products.tsx", "src/pages/ProductDetail.tsx",
  "src/components/arrivals/SupplierDebtSection.tsx",
  "src/pages/Reports.tsx", "src/pages/AgentKpi.tsx", "src/pages/Settings.tsx",
  "src/components/reports/ReportFilters.tsx", "src/components/orders/LoadingListsModal.tsx", "src/components/orders/OrderBulkActions.tsx",
  "src/components/orders/OneCExport.tsx", "src/components/orders/OrderMoney.tsx", "src/components/orders/OrderComments.tsx",
  "src/components/shops/ShopMoney.tsx", "src/components/shops/ShopStats.tsx", "src/components/plans/VisitReports.tsx",
  "src/components/CommandPalette.tsx", "src/components/GlobalSearch.tsx", "src/components/Layout.tsx",
];

describe("оператор: экран зовёт только то, что сервер ему отдаст", () => {
  it("user.list открыт оператору (курьер в карточке заказа, агент у магазина, ставки ЗП), но не полю", () => {
    const roles = rolesOf(kindOfCall("user.list")!);
    expect(roles).toContain("operator");
    expect(roles).toContain("ceo");
    for (const r of ["agent", "courier", "merchandiser", "supervisor"]) expect(roles, `${r} видит полный список людей`).not.toContain(r);
  });

  it("города и районы магазинов открыты всем, кому открыты «Магазины»", () => {
    for (const call of ["shop.cities", "shop.districts", "shop.list"]) {
      const roles = rolesOf(kindOfCall(call)!);
      for (const role of routeRoles("/shops")) expect(roles, `${role} открывает магазины, но ${call} ему закрыт`).toContain(role);
    }
  });

  it("безусловные запросы экранов оператора идут в ручки, куда оператора пускают", () => {
    const offenders: string[] = [];
    for (const file of OPERATOR_SCREENS) {
      for (const { call, args } of queriesOf(file)) {
        const enabled = /enabled\s*:/.test(args);
        // Запрос под чужим условием (canEdit, open, role === "ceo" …) экран
        // решает сам; здесь важны безусловные и «оператор или руководитель».
        if (enabled && !/isOperatorOrCeo|isOffice|role === "operator"/.test(args)) continue;
        const kind = kindOfCall(call);
        if (!kind) continue; // ручка не нашлась по имени — не о ней речь
        if (!rolesOf(kind).includes("operator")) offenders.push(`${file}: ${call} (${kind})`);
      }
    }
    expect(offenders, "оператору обещано то, чего сервер не отдаст:\n" + offenders.join("\n")).toEqual([]);
  });

  /*
    Прайс-листы (26.09.2026): страница /price-lists/:id и раздел настроек
    открыты оператору, правка — operatorQuery, а list/getById/shopMap стояли
    под supervisorQuery. Оператор жал «Создать» и попадал на FORBIDDEN.
    Общий страж этого не видел: getById идёт с enabled: listId > 0, а
    мутации он не смотрит. Здесь — каждый запрос и каждая мутация трёх
    файлов против всех ролей, кого пускают маршрут и раздел «Прайс-листы».
    Нарочная поломка: верни getById под supervisorQuery — тест падает.
  */
  it("прайс-листы: страница, ступени и раздел настроек зовут только то, что открыто их ролям", () => {
    const SETTINGS = read("src/pages/Settings.tsx");
    const section = SETTINGS.slice(SETTINGS.indexOf(`key: "prices"`)).match(/roles:\s*\[([^\]]+)\]/);
    expect(section, "раздел «Прайс-листы» без roles").not.toBeNull();
    const roles = new Set([...routeRoles("/price-lists/:id"), ...section![1].split(",").map(x => x.trim().replace(/["']/g, ""))]);
    expect([...roles]).toContain("operator");

    const offenders: string[] = [];
    let seen = 0;
    for (const file of ["src/pages/PriceListEditor.tsx", "src/components/settings/PriceListSettings.tsx", "src/components/price-lists/PriceTiers.tsx"]) {
      for (const m of read(file).matchAll(/trpc\.(\w+)\.(\w+)\.(?:useQuery|useMutation)\(/g)) {
        const call = `${m[1]}.${m[2]}`;
        const kind = kindOfCall(call);
        expect(kind, `${file}: ручка ${call} не нашлась`).not.toBeNull();
        seen++;
        for (const role of roles) if (!rolesOf(kind!).includes(role)) offenders.push(`${file}: ${call} (${kind}) закрыт для ${role}`);
      }
    }
    expect(seen, "страж не нашёл ни одного вызова — разбор сломался").toBeGreaterThan(10);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS, ROLE_ROUTES } from "@/const";

/**
 * Экраны PWA — как в мобилке v8.
 *
 * Владелец, 25.09.2026, на список «что осталось» — «все сделай абсолютно»:
 * вкладки директора, оператора, супервайзера и курьера как в мобилке; на
 * «Моём дне» график продаж и заказы за сегодня; остальные экраны — раскладкой
 * мобильного приложения (Warehouse-Pro-Mobile): надзорная и курьерская
 * главные, магазины с территориями, карточка магазина агента, корзина
 * каталога, заказы, план, профиль, уведомления, долги, GPS, сканер, путь
 * заказа, шаги мастера, доставки.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · верни директору вкладку «Заказы» — «вкладки директора»;
 *   · в Dashboard убери развилку useIsMobile — «главная директора на телефоне»;
 *   · в NewOrder верни `const fromCart = searchParams.get(…)` — «корзина
 *     уезжает в заказ» (а в new-order-from-catalog-cart — «после отправки
 *     корзина пуста»);
 *   · в Barcode верни `/orders/new?productCode=` — «сканер кладёт товар в заказ»;
 *   · в order-read уберите shopName — «мои заказы с магазином»;
 *   · в SupervisorPlans верни `neo-btn w-10 h-10` — «стрелки дат видны».
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const LAYOUT = read("src/components/Layout.tsx");

function tabs(role: string): string[] {
  const body = LAYOUT.slice(LAYOUT.indexOf("const BOTTOM_NAV"));
  const at = body.indexOf(`  ${role}: [`);
  expect(at, `панель роли ${role} не найдена`).toBeGreaterThan(0);
  return [...body.slice(at, body.indexOf("\n  ],", at)).matchAll(/path: "([^"]+)"/g)].map(m => m[1]);
}

describe("вкладки — как в мобилке (src/lib/tabs.ts мобилки)", () => {
  it("вкладки директора: Главная, Карта, Планы, Магазины", () => {
    expect(tabs("ceo")).toEqual(["/dashboard", "/supervisor", "/supervisor/plans", "/shops"]);
  });
  it("вкладки супервайзера — те же четыре", () => {
    expect(tabs("supervisor")).toEqual(["/dashboard", "/supervisor", "/supervisor/plans", "/shops"]);
  });
  it("оператору — без экранов, где сервер ему откажет (главная руководителя и планы)", () => {
    const op = tabs("operator");
    expect(op).toEqual(["/orders", "/shops", "/warehouse", "/settings"]);
    expect(op).not.toContain("/dashboard");
    expect(op).not.toContain("/supervisor/plans");
  });
  it("курьер: Главная, Доставки, Профиль — и попадает на свою главную", () => {
    expect(tabs("courier")).toEqual(["/courier", "/deliveries", "/settings"]);
    expect(ROLE_ROUTES.courier).toBe("/courier");
    expect(read("src/pages/Home.tsx")).toContain('courier:      "/courier"');
    expect(NAV_ITEMS.courier.map(i => i.path)).toContain("/courier");
    expect(read("src/App.tsx")).toContain('<Route path="/courier"       element={<RoleGuard roles={["courier"]}><CourierHome /></RoleGuard>} />');
  });
});

describe("телефон рисует экран мобилки, большой экран — свой", () => {
  const branches: Array<[string, string]> = [
    ["src/pages/Dashboard.tsx", "return phone ? <OversightHome /> : <DesktopDashboard />;"],
    ["src/pages/Shops.tsx", "return phone ? <OversightShops /> : <DesktopShops />;"],
    ["src/pages/AgentPlans.tsx", "return phone ? <PhonePlan /> : <DesktopAgentPlans />;"],
    ["src/pages/Notifications.tsx", "return phone ? <PhoneNotifications /> : <DesktopNotifications />;"],
    ["src/pages/Settings.tsx", "if (phone && !params.get(\"section\")) return <PhoneProfile />;"],
  ];
  for (const [file, line] of branches) {
    it(`главная директора на телефоне и др.: ${file.split("/").pop()}`, () => {
      const src = strip(read(file));
      expect(src, `${file}: развилки телефона нет`).toContain(line);
      expect(src).toContain("const phone = useIsMobile();");
    });
  }
  it("магазины агента на телефоне — ShopBrowser с карточкой точки", () => {
    const src = strip(read("src/pages/AgentShops.tsx"));
    expect(src).toContain("if (phone) {");
    expect(src).toContain("onOpen={id => navigate(`/agent/shops/${id}`)}");
    expect(read("src/App.tsx")).toContain('path="/agent/shops/:id"');
  });
});

describe("главные — раскладка мобилки", () => {
  it("«Мой день»: график продаж за 7 дней и заказы за сегодня", () => {
    const src = strip(read("src/pages/AgentDashboard.tsx"));
    expect(src).toContain("trpc.dashboard.revenueTrend.useQuery({ days: 7 }");
    expect(src).toContain("trpc.order.myOrders.useQuery(");
    expect(src).toContain(".slice(0, 5)");
    expect(src).toContain('data-testid="agent-trend"');
  });
  it("надзорная главная: подсказки, долги, динамика, статусы, «Трекинг», последние заказы", () => {
    const src = strip(read("src/components/phone/OversightHome.tsx"));
    for (const call of ["dashboard.trends", "dashboard.statusBreakdown", "dashboard.activity", "notification.smartAlerts", "shop.receivablesAging"]) {
      expect(src).toContain(`trpc.${call}.useQuery(`);
    }
    expect(src).toContain('<CtaTile icon={MapPin} label={t("Трекинг", "Kuzatuv")}');
  });
  it("курьерская главная: день в числах из списка и kpi.courierKpi(today)", () => {
    const src = strip(read("src/pages/CourierHome.tsx"));
    expect(src).toContain("trpc.courier.listMyDeliveries.useQuery(");
    expect(src).toContain('trpc.kpi.courierKpi.useQuery({ period: "today" }');
  });
});

describe("деталь за деталью", () => {
  it("корзина уезжает в заказ: мастер берёт её по тому же ?fromCart=1, что ставят каталог и сканер", () => {
    /*
      Здесь стояла проверка строки `if (user && fromCart) clearCart` — и была
      зелёной, пока корзина после отправки не чистилась: признак читался
      заново на каждом шаге, а шаги ходят без ?fromCart. Само поведение —
      вход, «назад», отправка онлайн и офлайн, цены магазина — теперь
      проверяет new-order-from-catalog-cart.test.tsx на живом мастере. Тут
      остаётся только стык файлов: имя параметра и то, что оно читается один
      раз на входе.
    */
    const src = strip(read("src/pages/NewOrder.tsx"));
    expect(src).toContain('const [fromCart, setFromCart] = useState(() => searchParams.get("fromCart") === "1");');
    expect(src).toContain("setItems(cartToItems(lines));");
    expect(strip(read("src/pages/Catalog.tsx"))).toContain('navigate("/orders/new?fromCart=1")');
  });
  it("сканер кладёт товар в заказ через корзину, а не мёртвым ?productCode=", () => {
    const src = strip(read("src/pages/Barcode.tsx"));
    expect(src).not.toContain("productCode=");
    expect(src).toContain('navigate("/orders/new?fromCart=1")');
    expect(src).toContain("useState(phone)");
  });
  it("мои заказы с магазином: order.myOrders отдаёт shopName", () => {
    const src = strip(read("api/services/order-read.ts"));
    const fn = src.slice(src.indexOf("export async function myOrders"), src.indexOf("export async function batchGetOrdersForPrint"));
    expect(fn).toContain("shopName: shops.name,");
    expect(fn).toContain(".leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))");
  });
  it("стрелки дат видны: кнопки-значки, а не neo-btn шириной 35 с полями по 20", () => {
    expect(read("src/pages/SupervisorPlans.tsx")).not.toContain("neo-btn w-10 h-10");
    for (const f of readdirSync(join(root, "src/pages"))) {
      expect(read(`src/pages/${f}`), f).not.toContain("neo-btn w-10 h-10");
    }
  });
  it("путь заказа на телефоне и шаги мастера — как в мобилке", () => {
    expect(read("src/pages/OrderDetail.tsx")).toContain("<OrderPipeline status={order.status}");
    const steps = read("src/components/orders/Steps.tsx");
    expect(steps).toContain('data-testid="phone-steps"');
    expect(steps).toContain("`ШАГ ${current} ИЗ ${total}`");
  });
  it("стрелка шапки на шагах мастера — шаг назад, а не выход из заказа", () => {
    expect(LAYOUT).toContain('location.pathname.startsWith("/orders/new/") ? navigate(-1) : navigate(meta.parentPath!)');
  });
  it("«Профиль» на телефоне, «Планы» — вкладка без стрелки назад", () => {
    expect(LAYOUT).toContain('return { title: pick({ ru: "Профиль", uz: "Profil" }) };');
    expect(LAYOUT).toContain('"/supervisor/plans":  { title: { ru: "Планы",         uz: "Rejalar" } },');
  });
  it("доставки: одна строка вместо плиток, «Выехал по всем», итоги месяца", () => {
    const src = strip(read("src/pages/CourierDeliveries.tsx"));
    expect(src).toContain("`Ожидают ${assigned.length} · В пути ${inTransit.length}`");
    expect(src).toContain('data-testid="courier-take-all"');
    expect(src).toContain("<MonthTotals />");
  });
});

describe("телефонные детали — только токены", () => {
  it("в components/phone нет цвета числом", () => {
    for (const f of readdirSync(join(root, "src/components/phone"))) {
      const code = strip(read(`src/components/phone/${f}`)).replace(/var\([^)]*\)/g, "");
      expect([...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]), f).toEqual([]);
    }
  });
});

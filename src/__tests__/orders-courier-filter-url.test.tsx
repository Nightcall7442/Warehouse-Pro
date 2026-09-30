// @vitest-environment jsdom
/**
 * Фильтр «Курьер» в «Заказах» и вход в вечернюю сдачу пачкой.
 *
 * Что было: отбора по курьеру не было — «Контроль» → «На руках» вёл на всю
 * очередь «Ждут расчёта», и заказы вернувшегося курьера оператор искал
 * глазами, а потом закрывал по одному.
 *
 * Что проверяется — настоящая страница «Заказы» в роутере, сервер — подменой
 * tRPC, которая записывает входы:
 *   · ?status=money&courier=5 → таблица и плитки просят заказы курьера 5 в
 *     очереди «Ждут расчёта»; мусор в courier — «все курьеры»;
 *   · выбор курьера в фильтре пишет courier в адрес и сбрасывает страницу;
 *     «Все курьеры» — убирает;
 *   · в очереди «Ждут расчёта» «Принять по заявленному» — главная кнопка
 *     панели, открывает окно с отмеченными заказами; без права принимать
 *     оплату кнопки нет.
 * Ссылку из «Контроля» проверяет control-ui.test.tsx, сервер —
 * api/__tests__/real-db/orders-courier-filter.test.ts.
 *
 * Нарочная поломка (проверено): courier не идёт в lib/orders-query (narrow)
 * — падают «адрес → запрос» и «выбор курьера»; codec без проверки цифр —
 * падает «мусор»; кнопка без can("payments.accept") — падает «без права».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from "react-router";
import { LangProvider } from "@/i18n";

// В jsdom нет раскладки и нет scrollIntoView, а выпадашка размера страницы им пользуется.
Element.prototype.scrollIntoView = () => {};

const h = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: Record<string, unknown> }>,
  clientList: vi.fn(),
  exportToExcel: vi.fn(async () => {}),
  exportToPDF: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  total: 0,
  can: (_cap: string): boolean => true,
}));

vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, tenantId: 1, role: "operator", name: "Оператор" } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => (cap: string) => h.can(cap) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {}, ORDER_AFFECTED_ROUTERS: [] }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: { name: "" }, footerNote: "", invoice: {} }) }));
vi.mock("@/hooks/useCompletionFlow", () => ({ useCompletionFlow: () => ({ saving: false, handleCompletionSave: async () => true, getCompletionMode: () => undefined }) }));
vi.mock("@/lib/excel", async (orig) => ({ ...(await orig<object>()), exportToExcel: h.exportToExcel }));
vi.mock("@/lib/export", async (orig) => ({ ...(await orig<object>()), exportToPDF: h.exportToPDF }));
// Окна, доски и блоки карточки со своими запросами — не предмет проверки.
vi.mock("@/components/orders/InvoicePrintModal", () => ({ InvoicePrintModal: () => null }));
vi.mock("@/components/orders/LoadingListModal", () => ({ LoadingListModal: () => null }));
vi.mock("@/components/orders/LoadingListsModal", () => ({ LoadingListsModal: () => null }));
vi.mock("@/components/orders/QuickOrderModal", () => ({ QuickOrderModal: () => null }));
vi.mock("@/components/orders/BulkCompletionModal", () => ({ BulkCompletionModal: () => null }));
vi.mock("@/components/orders/CompletionFlowModal", () => ({ CompletionFlowModal: () => null }));
vi.mock("@/components/orders/OrderKanbanBoard", () => ({ OrderKanbanBoard: () => null }));
vi.mock("@/components/orders/OrderAgentGroups", () => ({ OrderAgentGroups: () => null }));
// Панель массовых действий — одной кнопкой «Excel по выбранным»: проверяется, с каким входом страница её выгружает.
vi.mock("@/components/orders/OrderBulkActions", () => ({
  OrderBulkActions: (p: { selectedCount: number; onAcceptClaimed?: () => void; acceptClaimedFirst?: boolean }) => p.selectedCount > 0 && p.onAcceptClaimed
    ? <button type="button" data-first={String(!!p.acceptClaimedFirst)} onClick={p.onAcceptClaimed}>bulk-accept</button>
    : null,
}));
// Окно пачки — меткой: какие заказы ему передали.
vi.mock("@/components/orders/AcceptClaimedModal", () => ({
  AcceptClaimedModal: (p: { open: boolean; orderIds: number[] }) => p.open ? <div data-testid="accept-modal">{p.orderIds.join(",")}</div> : null,
}));

/*
  tRPC — прокси: любой useQuery записывает путь и вход, любой useMutation —
  пустышка. Так видно ровно то, что страница просит у сервера.
*/
vi.mock("@/providers/trpc", () => {
  const leaf = () => new Proxy(() => {}, { get: () => leaf(), apply: () => undefined });
  const utils = new Proxy({}, {
    get: (_t, k) => k === "client" ? { order: { list: { query: h.clientList } } } : leaf(),
  });
  const order = {
    id: 11, orderNumber: "ORD-11", status: "new", total: "100000", subtotal: "100000", discount: "0",
    createdAt: "2026-09-28T09:00:00", paymentMethod: "cash", shopId: 5, agentId: 7, items: [],
    shop: { id: 5, name: "Магазин А", debt: "0" }, agent: null, courier: null, deletedAt: null,
  };
  const node = (path: string[]): unknown => new Proxy(() => {}, {
    get(_t, key: string) {
      if (path.length === 0 && key === "useUtils") return () => utils;
      if (key === "useQuery") return (input: Record<string, unknown> = {}) => {
        const p = path.join(".");
        h.calls.push({ path: p, input });
        const data = p === "order.list" ? { data: h.rows, total: h.total, page: 1, pageSize: 25 }
          : p === "order.getById" ? order
          : p === "order.stats" ? { total: 0, totalRevenue: 0, awaitingMoneyCount: 0 }
          : p === "user.list" && input.role === "courier" ? { data: [{ id: 5, name: "Курьер Ботир" }, { id: 6, name: "Курьер Азиз" }] }
          : p === "order.agentSummary" || p === "order.listFilters" || p === "order.getAdjustments" ? [] : undefined;
        return { data, isLoading: false, isLoadingError: false, refetch: () => {} };
      }
      if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
      return node([...path, key]);
    },
  });
  return { trpc: node([]) };
});

const { default: Orders } = await import("@/pages/Orders");

const lastTable = (): Record<string, unknown> => [...h.calls].reverse().find(c => c.path === "order.list" && c.input.page !== undefined && !("agentId" in c.input))!.input;
const statsInputs = () => h.calls.filter(c => c.path === "order.stats").slice(-2).map(c => c.input);
const where = () => screen.getByTestId("where").textContent;

function Probe() {
  const l = useLocation();
  const type = useNavigationType();
  return <span data-testid="where">{`${l.pathname}${l.search}|${type}`}</span>;
}
const show = (url: string) => render(
  <LangProvider>
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/orders" element={<Orders />} /></Routes>
      <Probe />
    </MemoryRouter>
  </LangProvider>,
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
  h.calls.length = 0;
  h.can = () => true;
  h.rows = [
    { id: 11, orderNumber: "ORD-11", status: "delivered", total: "100000", createdAt: "2026-09-28T09:00:00", paymentMethod: "cash", shopName: "Магазин А", agentName: "Агент", courierName: "Курьер Ботир", deletedAt: null },
    { id: 12, orderNumber: "ORD-12", status: "delivered", total: "50000", createdAt: "2026-10-01T08:00:00", paymentMethod: "cash", shopName: "Магазин Б", agentName: "Агент", courierName: "Курьер Ботир", deletedAt: null },
  ];
  h.total = 2;
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* нет хранилища */ }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("фильтр «Курьер» в адресе", () => {
  it("адрес → запрос: очередь курьера из «Контроля» — таблица и плитки", () => {
    show("/orders?status=money&courier=5");
    expect(lastTable()).toMatchObject({ awaitingMoney: true, courierId: 5 });
    expect(statsInputs().every(i => i.courierId === 5), "плитки считают не тот срез").toBe(true);
    expect(screen.getByRole("combobox", { name: "Курьер" }).textContent).toContain("Курьер Ботир");
  });

  it("мусор в courier — «все курьеры», а не отказ сервера", () => {
    for (const bad of ["abc", "0", "-3", "1.5"]) {
      show(`/orders?courier=${bad}`);
      expect(lastTable().courierId, bad).toBeUndefined();
      cleanup();
    }
  });

  it("выбор курьера пишет его в адрес и сбрасывает страницу; «Все курьеры» — убирает", () => {
    show("/orders?status=money&page=2");
    fireEvent.click(screen.getByRole("combobox", { name: "Курьер" }));
    fireEvent.click(screen.getByRole("option", { name: "Курьер Азиз" }));
    expect(where()).toBe("/orders?status=money&courier=6|REPLACE");
    expect(lastTable()).toMatchObject({ courierId: 6, page: 1 });
    fireEvent.click(screen.getByRole("combobox", { name: "Курьер" }));
    fireEvent.click(screen.getByRole("option", { name: "Все курьеры" }));
    expect(where()).toBe("/orders?status=money|REPLACE");
    expect(lastTable().courierId).toBeUndefined();
  });
});

describe("«Принять по заявленному» из панели", () => {
  it("в очереди — главная кнопка; открывает окно с отмеченными", () => {
    sessionStorage.setItem("order_selection", "[11,12]");
    show("/orders?status=money&courier=5");
    const btn = screen.getByRole("button", { name: "bulk-accept" });
    expect(btn.getAttribute("data-first")).toBe("true");
    expect(screen.queryByTestId("accept-modal")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("accept-modal").textContent).toBe("11,12");
  });

  it("вне очереди — не главная; без права принимать оплату — нет", () => {
    sessionStorage.setItem("order_selection", "[11]");
    show("/orders");
    expect(screen.getByRole("button", { name: "bulk-accept" }).getAttribute("data-first")).toBe("false");
    cleanup();
    h.can = cap => cap !== "payments.accept";
    show("/orders?status=money");
    expect(screen.queryByRole("button", { name: "bulk-accept" })).toBeNull();
  });
});

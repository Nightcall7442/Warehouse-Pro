// @vitest-environment jsdom
/**
 * «Заказы» как рабочее место: список живёт в адресе, «Назад» из карточки
 * возвращает тот же список, выгрузка идёт тем же порядком, что таблица.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * С 18.09.2026 строка открывает карточку заказа на всю страницу, а «Назад» в
 * ней делал navigate("/orders"). Вкладка, «Ждут расчёта», агенты, поиск,
 * страница, даты, чипы, вид жили в useState списка и пропадали вместе с ним:
 * после каждой карточки оператор настраивал список заново — при 60–100
 * карточках в день это 8–20 минут. Список шёл только по дате, по 25 строк.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящие страницы «Заказы» и карточка заказа внутри роутера, сервер —
 * подменой tRPC, которая записывает входы:
 *
 *   · адрес → запрос: все фильтры, страница, размер и сортировка из ссылки
 *     доходят до order.list; мусор в ссылке читается как «по умолчанию»;
 *   · действие → адрес: плитка, заголовок столбца, размер страницы пишутся в
 *     адрес и сбрасывают номер страницы;
 *   · пункт меню «Заказы» на самой странице — чистый список и пустое поле;
 *   · выгрузка — те же условия И тот же порядок, что у таблицы; «Excel по
 *     выбранным» — по номерам отмеченных, но тоже в порядке таблицы;
 *   · «Назад» из карточки: пришли из списка — шаг назад к тому же адресу
 *     (pop — прокрутку ScrollToTop не трогает); пришли не из списка — в
 *     последний список этой вкладки, а не в магазин, откуда открыли.
 *
 * Сервер по этим входам — api/__tests__/real-db/orders-sort-search.test.ts.
 *
 * Нарочная поломка (проверено, 29.09.2026):
 *   · статус снова в useState — падают «адрес → запрос», плитка, выгрузка
 *     и возврат в сохранённый список;
 *   · «Назад» в карточке снова navigate("/orders") — падают оба возврата;
 *   · openOrder без FROM_ORDERS_LIST — падает возврат из списка (уходит
 *     переходом в сохранённый, а не шагом назад);
 *   · sortBy/sortDir не идут в list (lib/orders-query) — падают «адрес →
 *     запрос», заголовки и выгрузка;
 *   · размер страницы без белого списка — падает «мусор в ссылке»;
 *   · список не запоминает себя — падает «пришли из магазина»; ?new=1 не
 *     вычищается — падает он же;
 *   · поле поиска без key — падает «пункт меню»;
 *   · стрелка шапки без ветки карточки — падает проверка шапки;
 *   · «Excel по выбранным» без сортировки экрана — падает «отмеченные в
 *     порядке таблицы» (проверка, 29.09.2026: файл шёл по дате создания).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Routes, Route, Link, useLocation, useNavigationType } from "react-router";
import { LangProvider } from "@/i18n";

// В jsdom нет раскладки и нет scrollIntoView, а выпадашка размера страницы им пользуется.
Element.prototype.scrollIntoView = () => {};

type Call = { path: string; input: Record<string, unknown> };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: Record<string, unknown> }>,
  clientList: vi.fn(),
  exportToExcel: vi.fn(async () => {}),
  exportToPDF: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  total: 0,
}));

vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, tenantId: 1, role: "operator", name: "Оператор" } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
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
  OrderBulkActions: (p: { selectedCount: number; onExportExcel: () => void }) => p.selectedCount > 0
    ? <button type="button" onClick={p.onExportExcel}>bulk-excel</button>
    : null,
}));
vi.mock("@/components/orders/OrderItemsEditor", () => ({ OrderItemsEditor: () => null }));
vi.mock("@/components/orders/OrderComments", () => ({ OrderComments: () => null }));
vi.mock("@/components/orders/OrderMoney", () => ({ MoneyBlock: () => null }));
vi.mock("@/components/orders/PromisedDelivery", () => ({ PromisedDelivery: () => null }));
vi.mock("@/components/orders/OneCExport", () => ({ OneCExport: () => null }));
vi.mock("@/components/phone/OrderPipeline", () => ({ OrderPipeline: () => null }));

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
const { default: OrderDetail } = await import("@/pages/OrderDetail");

/** Последний запрос таблицы — тот, что с номером страницы (выгрузка идёт мимо useQuery). */
const lastTable = (): Record<string, unknown> => [...h.calls].reverse().find((c: Call) => c.path === "order.list" && c.input.page !== undefined && !("agentId" in c.input))!.input;
const withoutPaging = (i: Record<string, unknown>) => { const { page, pageSize, ...rest } = i; void page; void pageSize; return rest; };
const tile = (label: string) => screen.getAllByRole("button").find(b => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(label))!;
const header = (label: string) => screen.getAllByRole("columnheader").find(th => th.textContent?.includes(label))!;
const where = () => screen.getByTestId("where").textContent;

function Probe() {
  const l = useLocation();
  const type = useNavigationType();
  return (
    <>
      <span data-testid="where">{`${l.pathname}${l.search}|${type}`}</span>
      {/* Пункт меню «Заказы» — обычный переход на /orders. */}
      <Link to="/orders">меню-заказы</Link>
    </>
  );
}

const show = (entries: string[], index = entries.length - 1) => render(
  <LangProvider>
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/shops/:id" element={<div>карточка магазина</div>} />
      </Routes>
      <Probe />
    </MemoryRouter>
  </LangProvider>,
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // 1 октября
  h.calls.length = 0;
  h.clientList.mockReset();
  h.exportToExcel.mockClear();
  h.exportToPDF.mockClear();
  h.rows = [
    { id: 11, orderNumber: "ORD-11", status: "new", total: "100000", createdAt: "2026-09-28T09:00:00", paymentMethod: "debt", shopName: "Магазин А", agentName: "Агент", deletedAt: null },
    { id: 12, orderNumber: "ORD-12", status: "new", total: "50000", createdAt: "2026-10-01T08:00:00", paymentMethod: "cash", shopName: "Магазин Б", agentName: "Агент", deletedAt: null },
  ];
  // Список длиннее самой короткой страницы — выбор размера на экране.
  h.total = 300;
  h.clientList.mockImplementation(async () => ({ data: h.rows, total: h.rows.length, page: 1, pageSize: 5000 }));
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* нет хранилища */ }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("адрес → запрос: ссылка открывает тот же список", () => {
  it("вкладка, статус, агенты, поиск, даты, чип оплаты, страница, размер и сортировка доходят до order.list", () => {
    show(["/orders?tab=archive&status=delivered&agents=3,5&search=Хумо&from=2026-09-01&to=2026-09-30&pay=debt&page=3&size=50&sort=total&dir=asc"]);
    expect(lastTable()).toMatchObject({
      page: 3, pageSize: 50, archived: true, status: "delivered", agentIds: [3, 5], search: "Хумо",
      dateFrom: "2026-09-01", dateTo: "2026-09-30", paymentMethod: "debt", sortBy: "total", sortDir: "asc",
    });
    // Экран показывает то, чем отфильтрован список.
    expect((screen.getByPlaceholderText(/Поиск заказов/) as HTMLInputElement).value).toBe("Хумо");
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]')).map(i => i.value)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(header("ИТОГО").getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByRole("combobox", { name: "Строк на странице" }).textContent).toContain("По 50");
  });

  it("очередь из «Контроля» и чип периода — из адреса; очередь без периода по умолчанию", () => {
    show(["/orders?status=money&period=today"]);
    expect(lastTable()).toMatchObject({ awaitingMoney: true, dateFrom: "2026-10-01", dateTo: "2026-10-01", pageSize: 25, page: 1 });
    cleanup();
    show(["/orders?status=money"]);
    expect(lastTable()).toMatchObject({ awaitingMoney: true });
    expect(lastTable().dateFrom).toBeUndefined();
  });

  it("мусор в ссылке — «по умолчанию», а не отказ сервера и не выгрузка на пять тысяч строк", () => {
    show(["/orders?status=bogus&size=5000&sort=id;drop&dir=up&agents=1,x,2&from=yesterday&tab=trash&page=-4"]);
    const t = lastTable();
    expect(t).toMatchObject({ page: 1, pageSize: 25, sortBy: "createdAt", sortDir: "desc", agentIds: [1, 2], archived: false });
    expect(t.status).toBeUndefined();
    expect(t.dateFrom).toBeUndefined();
  });
});

describe("действие → адрес", () => {
  it("плитка пишет статус и сбрасывает страницу; заголовок — сортировку в обе стороны", () => {
    show(["/orders?page=3&size=50"]);
    fireEvent.click(tile("Новые"));
    expect(where()).toBe("/orders?size=50&status=new|REPLACE");
    expect(lastTable()).toMatchObject({ status: "new", page: 1, pageSize: 50 });

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(lastTable()).toMatchObject({ page: 2 });
    // Первое нажатие по сумме — крупные сверху; второе — наоборот. Страница — снова первая.
    fireEvent.click(screen.getByRole("button", { name: /ИТОГО/ }));
    expect(where()).toBe("/orders?size=50&status=new&sort=total|REPLACE");
    expect(lastTable()).toMatchObject({ sortBy: "total", sortDir: "desc", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: /ИТОГО/ }));
    expect(lastTable()).toMatchObject({ sortBy: "total", sortDir: "asc" });
    expect(header("ИТОГО").getAttribute("aria-sort")).toBe("ascending");
    // Магазин — с первого нажатия по алфавиту.
    fireEvent.click(screen.getByRole("button", { name: /МАГАЗИН/ }));
    expect(lastTable()).toMatchObject({ sortBy: "shopName", sortDir: "asc" });
  });

  it("25 / 50 / 100: выбор уходит в адрес и в запрос, страница сбрасывается", () => {
    show(["/orders?page=4"]);
    fireEvent.click(screen.getByRole("combobox", { name: "Строк на странице" }));
    fireEvent.click(screen.getByRole("option", { name: "По 100" }));
    expect(where()).toBe("/orders?size=100|REPLACE");
    expect(lastTable()).toMatchObject({ page: 1, pageSize: 100 });
  });
});

describe("пункт меню «Заказы» на самой странице", () => {
  it("чистый список — и поле поиска пустое, а не со строкой, которой таблица уже не ищет", () => {
    show(["/orders?search=Хумо&status=new"]);
    expect((screen.getByPlaceholderText(/Поиск заказов/) as HTMLInputElement).value).toBe("Хумо");
    fireEvent.click(screen.getByText("меню-заказы"));
    expect(where()).toBe("/orders|PUSH");
    expect(lastTable().search).toBeUndefined();
    expect((screen.getByPlaceholderText(/Поиск заказов/) as HTMLInputElement).value).toBe("");
  });
});

describe("выгрузка — то, что на экране, и в том же порядке", () => {
  it("Excel и PDF берут фильтры и сортировку экрана", async () => {
    show(["/orders?status=money&period=today&sort=shopName&dir=asc&search=Хумо&agents=4"]);
    const table = withoutPaging(lastTable());
    expect(table).toMatchObject({ awaitingMoney: true, sortBy: "shopName", sortDir: "asc", search: "Хумо", agentIds: [4] });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Excel/ })); });
    expect(h.clientList.mock.calls[0][0]).toEqual({ ...table, page: 1, pageSize: 5000 });

    // Пересортировали таблицу — файл идёт по-новому.
    fireEvent.click(screen.getByRole("button", { name: /ИТОГО/ }));
    const resorted = withoutPaging(lastTable());
    expect(resorted).toMatchObject({ sortBy: "total", sortDir: "desc" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /PDF/ })); });
    expect(h.clientList.mock.calls[1][0]).toEqual({ ...resorted, page: 1, pageSize: 5000 });
  });

  it("«Excel по выбранным» — отмеченные в порядке таблицы, а не по дате создания", async () => {
    show(["/orders?sort=shopName&dir=asc"]);
    const rowBoxes = screen.getAllByRole("row").slice(1).map(r => r.querySelector("button")!);
    fireEvent.click(rowBoxes[0]);
    fireEvent.click(rowBoxes[1]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bulk-excel" })); });
    // По номерам отмеченных (их может не быть на этой странице) — и в том порядке, что на экране.
    expect(h.clientList).toHaveBeenLastCalledWith({ ids: [11, 12], page: 1, pageSize: 2, sortBy: "shopName", sortDir: "asc" });
    expect((h.exportToExcel.mock.calls[0] as unknown[])[3]).toBe("Выбранные заказы");
  });
});

describe("«Назад» из карточки заказа", () => {
  const LIST = "/orders?tab=archive&status=delivered&search=Хумо&page=3&size=50&sort=total&dir=asc";

  it("пришли из списка — шаг назад к тому же адресу, тем же фильтрам и странице", async () => {
    show([LIST]);
    const before = lastTable();
    fireEvent.click(screen.getByText("ORD-11"));
    expect(where()).toBe("/orders/11|PUSH");

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    // Pop, а не push: ScrollToTop прокрутку на возврате не трогает.
    await waitFor(() => expect(where()).toBe(`${LIST}|POP`));
    expect(lastTable()).toEqual(before);
    expect((screen.getByPlaceholderText(/Поиск заказов/) as HTMLInputElement).value).toBe("Хумо");
  });

  it("пришли не из списка (из магазина) — в последний список этой вкладки, а не обратно в магазин", async () => {
    show(["/orders?status=money&page=2&new=1"]);
    cleanup();
    show(["/shops/5", "/orders/11"]);
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    // Окно «Новый заказ» — разовое действие: в возврат оно не попадает.
    await waitFor(() => expect(where()).toBe("/orders?status=money&page=2|PUSH"));
    expect(lastTable()).toMatchObject({ awaitingMoney: true, page: 2 });
  });

  it("список в этой вкладке не открывали — в /orders", async () => {
    show(["/orders/11"]);
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    await waitFor(() => expect(where()).toBe("/orders|PUSH"));
  });

  it("стрелка шапки на телефоне в карточке заказа ведёт тем же путём", () => {
    // Дополнение к проверкам выше: шапка — часть Layout, поднимать его целиком здесь не к чему.
    const layout = readFileSync(join(process.cwd(), "src/components/Layout.tsx"), "utf8");
    expect(layout).toContain("isOrderCard ? backToOrders()");
    expect(layout).toMatch(/const isOrderCard = \/\^\\\/orders\\\/\\d\+\$\/\.test\(location\.pathname\)/);
  });
});

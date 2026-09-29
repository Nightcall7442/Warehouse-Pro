// @vitest-environment jsdom
/**
 * Экран «Заказы»: очереди без месяца по умолчанию, выгрузка — то, что на экране.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 *   · Поле «с» стояло на первом числе месяца, и этот период уходил в каждый
 *     запрос страницы. С 1-го числа «Активные», «Ожидает» и «Ждут расчёта»
 *     молча теряли всё, что оформили в прошлом месяце: вечерняя проверка по
 *     справке («Ожидает = 0», «Ждут расчёта = 0») давала ложный ноль.
 *   · Excel и PDF брали только два поля дат: ни вкладки, ни статуса, ни
 *     агента, ни поиска, ни чипов — таблица «Сегодня», файл — месяц.
 *     «Excel по выбранным» и вопрос о долге перед «Выполнить» искали
 *     отмеченное в том же срезе дат — отмеченное вне его пропадало.
 *   · «Эта неделя» начиналась с воскресенья, «Вчера» захватывало сегодня.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящая страница, «сегодня» = 1 октября: какие входы уходят серверу из
 * таблицы, плиток и выгрузки. Что сервер по такому входу отдаёт заказ
 * прошлого месяца — api/__tests__/real-db/orders-queues-live.test.ts.
 *
 * Нарочная поломка: верни полю «с» startOfMonth — падает первый тест; верни
 * выгрузке свои даты вместо q.list — падает тест выгрузки; getDay() в неделе
 * — падает тест чипов.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LangProvider } from "@/i18n";

type Call = { path: string; input: Record<string, unknown> };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: Record<string, unknown> }>,
  clientList: vi.fn(),
  exportToExcel: vi.fn(async () => {}),
  exportToPDF: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, tenantId: 1, role: "operator", name: "Оператор" } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {}, ORDER_AFFECTED_ROUTERS: [] }));
vi.mock("@/lib/excel", async (orig) => ({ ...(await orig<object>()), exportToExcel: h.exportToExcel }));
vi.mock("@/lib/export", async (orig) => ({ ...(await orig<object>()), exportToPDF: h.exportToPDF }));
// Окна и доски со своими запросами — не предмет проверки.
vi.mock("@/components/orders/InvoicePrintModal", () => ({ InvoicePrintModal: () => null }));
vi.mock("@/components/orders/LoadingListModal", () => ({ LoadingListModal: () => null }));
vi.mock("@/components/orders/LoadingListsModal", () => ({ LoadingListsModal: () => null }));
vi.mock("@/components/orders/QuickOrderModal", () => ({ QuickOrderModal: () => null }));
vi.mock("@/components/orders/BulkCompletionModal", () => ({ BulkCompletionModal: () => null }));
vi.mock("@/components/orders/CompletionFlowModal", () => ({ CompletionFlowModal: () => null }));
vi.mock("@/components/orders/OrderKanbanBoard", () => ({ OrderKanbanBoard: () => null }));
vi.mock("@/components/orders/OrderAgentGroups", () => ({ OrderAgentGroups: () => null }));
vi.mock("@/components/orders/OrderBulkActions", () => ({
  OrderBulkActions: (p: { selectedCount: number; onExportExcel: () => void; onComplete: () => void }) => p.selectedCount > 0 ? (
    <div>
      <button type="button" onClick={p.onExportExcel}>bulk-excel</button>
      <button type="button" onClick={p.onComplete}>bulk-complete</button>
    </div>
  ) : null,
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
  const node = (path: string[]): unknown => new Proxy(() => {}, {
    get(_t, key: string) {
      if (path.length === 0 && key === "useUtils") return () => utils;
      if (key === "useQuery") return (input: Record<string, unknown> = {}) => {
        const p = path.join(".");
        h.calls.push({ path: p, input });
        const data = p === "order.list" ? { data: h.rows, total: h.rows.length, page: 1, pageSize: 25 }
          : p === "order.stats" ? { total: 0, totalRevenue: 0, awaitingMoneyCount: 0 }
          : p === "order.agentSummary" || p === "order.listFilters" ? [] : undefined;
        return { data, isLoading: false, isLoadingError: false, refetch: () => {} };
      }
      if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
      return node([...path, key]);
    },
  });
  return { trpc: node([]) };
});

const { default: Orders } = await import("@/pages/Orders");

const lastTable = (): Record<string, unknown> => [...h.calls].reverse().find((c: Call) => c.path === "order.list" && c.input.pageSize === 25)!.input;
const lastStats = () => {
  const s = h.calls.filter((c: Call) => c.path === "order.stats");
  return s.slice(-2).map(c => c.input);
};
const withoutPaging = (i: Record<string, unknown>) => { const { page, pageSize, ...rest } = i; void page; void pageSize; return rest; };
const dateInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
const tile = (label: string) => screen.getAllByRole("button").find(b => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(label))!;

beforeEach(() => {
  // Только часы: таймеры React и testing-library остаются настоящими.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // четверг, 1 октября
  h.calls.length = 0;
  h.clientList.mockReset();
  h.exportToExcel.mockClear();
  h.exportToPDF.mockClear();
  h.rows = [
    { id: 11, orderNumber: "ORD-11", status: "pending", total: "100000", createdAt: "2026-09-28T09:00:00", paymentMethod: "debt", shopName: "Магазин А", agentName: "Агент", deletedAt: null },
    { id: 12, orderNumber: "ORD-12", status: "new", total: "50000", createdAt: "2026-10-01T08:00:00", paymentMethod: "cash", shopName: "Магазин Б", agentName: "Агент", deletedAt: null },
  ];
  h.clientList.mockImplementation(async () => ({ data: h.rows, total: h.rows.length, page: 1, pageSize: 5000 }));
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* нет хранилища */ }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = () => render(<LangProvider><MemoryRouter><Orders /></MemoryRouter></LangProvider>);

describe("1 октября: очереди и «Активные» не режутся месяцем", () => {
  it("«Активные» без дат; очереди считаются без периода, отчётные плитки — за месяц", () => {
    show();
    const t = lastTable();
    expect(t).toMatchObject({ archived: false });
    expect(t.dateFrom).toBeUndefined();
    expect(t.dateTo).toBeUndefined();
    // Поля дат пусты: на экране ровно то, что применено.
    expect(dateInputs().map(i => i.value)).toEqual(["", ""]);
    const [report, queue] = lastStats();
    expect(report).toMatchObject({ dateFrom: "2026-10-01", dateTo: "2026-10-01" });
    expect(queue.dateFrom).toBeUndefined();
    expect(queue.dateTo).toBeUndefined();
    expect(screen.getByText(/в работе/)).toBeTruthy();
  });

  it("«Ждут расчёта» и «Ожидает» — очередь без периода; ссылка из «Контроля» тоже", () => {
    show();
    fireEvent.click(tile("Ждут расчёта"));
    expect(lastTable()).toMatchObject({ awaitingMoney: true });
    expect(lastTable().dateFrom).toBeUndefined();
    fireEvent.click(tile("Ожидает"));
    expect(lastTable()).toMatchObject({ status: "pending", archived: false });
    expect(lastTable().dateFrom).toBeUndefined();
  });

  it("«Архив» — отчёт: месяц по умолчанию, и поля его показывают", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Архив" }));
    expect(lastTable()).toMatchObject({ archived: true, dateFrom: "2026-10-01", dateTo: "2026-10-01" });
    expect(dateInputs().map(i => i.value)).toEqual(["2026-10-01", "2026-10-01"]);
  });

  it("выбранные человеком даты фильтруют и таблицу, и очереди", () => {
    show();
    fireEvent.change(dateInputs()[0], { target: { value: "2026-09-15" } });
    expect(lastTable()).toMatchObject({ dateFrom: "2026-09-15", archived: false });
    const [report, queue] = lastStats();
    expect(queue).toMatchObject({ dateFrom: "2026-09-15" });
    expect(report).toMatchObject({ dateFrom: "2026-09-15" });
  });
});

describe("чипы дат", () => {
  it("«Эта неделя» — с понедельника, «Вчера» — только вчера; поля показывают применённое", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Эта неделя/ }));
    expect(lastTable()).toMatchObject({ dateFrom: "2026-09-28", dateTo: "2026-10-01" });
    expect(dateInputs()[0].value).toBe("2026-09-28");
    fireEvent.click(screen.getByRole("button", { name: /Вчера/ }));
    expect(lastTable()).toMatchObject({ dateFrom: "2026-09-30", dateTo: "2026-09-30" });
  });

  it("воскресенье — ещё та же неделя, что началась в понедельник", () => {
    vi.setSystemTime(new Date(2026, 9, 4, 18, 0)); // воскресенье
    show();
    fireEvent.click(screen.getByRole("button", { name: /Эта неделя/ }));
    expect(lastTable()).toMatchObject({ dateFrom: "2026-09-28", dateTo: "2026-10-04" });
  });
});

describe("выгрузка — то, что на экране", () => {
  it("Excel и PDF: те же условия, что у таблицы; запрос — только по нажатию", async () => {
    show();
    // Открытие страницы выгрузку не грузит.
    expect(h.clientList).not.toHaveBeenCalled();
    expect(h.calls.some(c => c.path === "order.list" && c.input.pageSize === 5000)).toBe(false);

    fireEvent.click(tile("Ждут расчёта"));
    fireEvent.click(screen.getByRole("button", { name: /Сегодня/ }));
    const table = withoutPaging(lastTable());
    expect(table).toMatchObject({ awaitingMoney: true, dateFrom: "2026-10-01", dateTo: "2026-10-01" });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Excel/ })); });
    expect(h.clientList).toHaveBeenCalledTimes(1);
    expect(h.clientList.mock.calls[0][0]).toEqual({ ...table, page: 1, pageSize: 5000 });
    expect(h.exportToExcel).toHaveBeenCalledTimes(1);
    expect((h.exportToExcel.mock.calls[0] as unknown[])[3]).toBe("Ждут расчёта · 2026-10-01 — 2026-10-01");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /PDF/ })); });
    expect(h.clientList.mock.calls[1][0]).toEqual({ ...table, page: 1, pageSize: 5000 });
    expect(h.exportToPDF).toHaveBeenCalledWith("Ждут расчёта · 2026-10-01 — 2026-10-01", expect.stringContaining("ORD-11"));
  });

  it("удалённые в бумагу не идут: итог по ним был бы выдумкой", async () => {
    h.rows = [...h.rows, { id: 13, orderNumber: "ORD-13", status: "new", total: "999", createdAt: "2026-10-01T08:00:00", deletedAt: "2026-10-01T09:00:00" }];
    show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Excel/ })); });
    const rows = (h.exportToExcel.mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>;
    expect(rows.map(r => r["Заказ №"])).toEqual(["ORD-11", "ORD-12"]);
  });

  it("«Excel по выбранным» и вопрос о долге — по номерам отмеченных, а не по срезу дат", async () => {
    show();
    const rowBoxes = screen.getAllByRole("row").slice(1).map(r => r.querySelector("button")!);
    fireEvent.click(rowBoxes[0]);
    fireEvent.click(rowBoxes[1]);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bulk-excel" })); });
    expect(h.clientList).toHaveBeenLastCalledWith({ ids: [11, 12], page: 1, pageSize: 2, sortBy: "createdAt", sortDir: "desc" });
    expect((h.exportToExcel.mock.calls[0] as unknown[])[3]).toBe("Выбранные заказы");

    h.rows = [h.rows[0]];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "bulk-complete" })); });
    expect(h.clientList).toHaveBeenLastCalledWith({ ids: [11, 12], page: 1, pageSize: 2, sortBy: "createdAt", sortDir: "desc" });
    // Долговой заказ из прошлого месяца назван в вопросе.
    await waitFor(() => expect(document.body.textContent).toContain("Из них 1 в долг"));
  });
});

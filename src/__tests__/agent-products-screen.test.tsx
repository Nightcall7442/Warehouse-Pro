// @vitest-environment jsdom
/**
 * «Что продаёт каждый агент» на вкладке «Агенты» — период, выгрузка, единицы.
 *
 * Аудит 09.10.2026 (вопрос клиента про «Агент × Товар»), экранная часть:
 *
 *  П4 — у блока были свои поля дат, заполненные один раз при открытии:
 *       «7 дней» меняло таблицу «Агенты», а блок под ней оставался за 30.
 *  П5 — Excel блока выгружал всех агентов, даже когда на экране выбран один,
 *       а доля при выбранном агенте всегда показывала «100%».
 *  П6 — «Кол-во» в шапке агента складывало штуки, килограммы и ящики.
 *  П11 — единицы печатались по-русски и на узбекском экране.
 *
 * Нарочные поломки (после checkpoint-коммита): вернуть useState(from) для
 * периода блока — падает «период»; игнорировать фильтр в выгрузке — падает
 * «выгрузка»; знаменатель доли по отфильтрованным — падает «доля»; простая
 * сумма количеств — падает «единицы»; unitShort без языка — падает «узбекский».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: unknown }>,
  lang: "ru" as "ru" | "uz",
  exported: [] as Array<{ rows: Array<Record<string, unknown>>; filename: string; title?: string }>,
  rows: [] as unknown[],
}));

vi.mock("recharts", () => {
  const Пусто = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Пусто, LineChart: Пусто, Line: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null };
});
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: h.lang }),
  useTranslate: () => (ru: string, uz: string) => (h.lang === "uz" ? uz : ru),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "ceo" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/excel", () => ({
  exportToExcel: vi.fn(async (rows: Array<Record<string, unknown>>, filename: string, _sheet?: string, title?: string) => {
    h.exported.push({ rows, filename, title });
  }),
}));

vi.mock("@/providers/trpc", () => {
  const answer = (path: string) => ({
    data: path === "analytics.agentProductSales" ? h.rows : undefined,
    isLoading: false, isFetching: false, isError: false, isLoadingError: false, error: null,
    refetch: async () => ({ data: [] }),
  });
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) {
        const p = path.slice(0, -1).join(".");
        h.calls.push({ path: p, input: args[0] });
        return answer(p);
      }
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

vi.mock("@/components/reports/OverviewTab", () => ({ OverviewTab: () => null }));
vi.mock("@/components/reports/SalesTab", () => ({ SalesTab: () => null }));
vi.mock("@/components/reports/AgentsTab", () => ({ AgentsTab: () => null }));
vi.mock("@/components/debts/DebtorsPanel", () => ({ DebtorsPanel: () => null }));
vi.mock("@/components/debts/DebtJournalPanel", () => ({ DebtJournalPanel: () => null }));
vi.mock("@/components/reports/NoOrderVisitsTab", () => ({ NoOrderVisitsTab: () => null }));
vi.mock("@/components/reports/ProfitTab", () => ({ ProfitTab: () => null }));
vi.mock("@/components/reports/AbcTab", () => ({ AbcTab: () => null }));
vi.mock("@/components/reports/SalesMapTab", () => ({ SalesMapTab: () => null }));
vi.mock("@/components/plans/PlanForecast", () => ({ PlanForecastCard: () => null }));

const { default: Reports } = await import("@/pages/Reports");

const row = (o: Partial<Record<string, unknown>>) => ({
  agentId: 1, agentName: "Азиз", productId: 1, productName: "Cola", productCode: "C-1", unit: "pcs",
  totalQty: 0, returnedQty: 0, grossRevenue: 0, salesRevenue: 0, returnedAmount: 0, totalRevenue: 0, orderCount: 1,
  ...o,
});

const ROWS = [
  row({ agentId: 1, agentName: "Азиз", productId: 1, productName: "Cola", unit: "pcs", totalQty: 120, salesRevenue: 300_000, totalRevenue: 300_000 }),
  row({ agentId: 1, agentName: "Азиз", productId: 2, productName: "Сахар", unit: "kg", totalQty: 25.5, salesRevenue: 100_000, totalRevenue: 100_000 }),
  row({ agentId: 1, agentName: "Азиз", productId: 3, productName: "Вода", unit: "box", totalQty: 10, salesRevenue: 200_000, totalRevenue: 200_000 }),
  row({ agentId: 2, agentName: "Бобур", productId: 1, productName: "Cola", unit: "pcs", totalQty: 40, returnedQty: 4, salesRevenue: 200_000, returnedAmount: 20_000, totalRevenue: 180_000 }),
  // Заказы без агента — «Не назначен»: на экране ключ «0», в данных agentId null.
  row({ agentId: null, agentName: null, productId: 4, productName: "Сок", unit: "pcs", totalQty: 7, salesRevenue: 35_000, totalRevenue: 35_000 }),
];

const page = () => render(<MemoryRouter initialEntries={["/reports?tab=agents"]}><Reports /></MemoryRouter>);
type Range = { dateFrom?: string; dateTo?: string } | undefined;
const lastInput = (path: string) => [...h.calls].reverse().find(c => c.path === path)?.input as Range;
/** Таблица «Агенты» зовёт agentPerformance дважды за отрисовку: текущий период, затем прошлый. */
const currentAgents = () => {
  const calls = h.calls.filter(c => c.path === "analytics.agentPerformance");
  return calls[calls.length - 2]?.input as Range;
};

// В jsdom нет прокрутки к элементу — её зовёт выпадающий список при открытии.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => { cleanup(); h.calls.length = 0; h.exported.length = 0; h.lang = "ru"; h.rows = []; });

describe("«Что продаёт каждый агент»", () => {
  it("период — тот же, что у таблицы «Агенты», и меняется вместе с переключателем", () => {
    h.rows = ROWS;
    page();
    const ap = lastInput("analytics.agentProductSales");
    const perf = currentAgents();
    expect(ap?.dateFrom).toBe(perf?.dateFrom);
    expect(ap?.dateTo).toBe(perf?.dateTo);
    // Своих полей дат у блока больше нет.
    expect(screen.queryByLabelText("С даты")).toBeNull();

    fireEvent.click(within(screen.getByRole("group", { name: "Период" })).getByRole("button", { name: "7 дней" }));
    const ap7 = lastInput("analytics.agentProductSales");
    expect(ap7?.dateFrom, "блок остался за прежний период").not.toBe(ap?.dateFrom);
    expect(ap7?.dateFrom).toBe(currentAgents()?.dateFrom);
  });

  it("выгрузка при выбранном агенте — только его строки, его имя в заголовке и файле", async () => {
    h.rows = ROWS;
    page();
    fireEvent.click(screen.getByRole("combobox", { name: "Агент" }));
    fireEvent.click(screen.getByRole("option", { name: "Бобур" }));
    fireEvent.click(screen.getByTestId("agent-products-export"));
    await vi.waitFor(() => expect(h.exported).toHaveLength(1));
    const file = h.exported[0];
    expect(file.rows.map(r => r["Агент"])).toEqual(["Бобур"]);
    expect(file.rows[0]["Чистыми"]).toBe(180_000);
    expect(file.filename).toContain("agent-2");
    expect(file.title).toContain("Бобур");
  });

  it("«Не назначен» — свои строки, а не пустой файл", async () => {
    // На экране ключ «0», в данных agentId null: превратить «0» в число 0 —
    // и сравнение null === 0 отбросило бы все его строки, файл вышел бы пустым.
    h.rows = ROWS;
    page();
    fireEvent.click(screen.getByRole("combobox", { name: "Агент" }));
    fireEvent.click(screen.getByRole("option", { name: "Не назначен" }));
    fireEvent.click(screen.getByTestId("agent-products-export"));
    await vi.waitFor(() => expect(h.exported).toHaveLength(1));
    expect(h.exported[0].rows.map(r => r["Товар"])).toEqual(["Сок"]);
    expect(h.exported[0].filename).toMatch(/-agent-0$/);
    expect(h.exported[0].title).toContain("Не назначен");
  });

  it("без фильтра выгружаются все агенты", async () => {
    h.rows = ROWS;
    page();
    fireEvent.click(screen.getByTestId("agent-products-export"));
    await vi.waitFor(() => expect(h.exported).toHaveLength(1));
    expect(new Set(h.exported[0].rows.map(r => r["Агент"]))).toEqual(new Set(["Азиз", "Бобур", "Не назначен"]));
    expect(h.exported[0].filename).not.toMatch(/-agent-\d/);
  });

  it("доля при выбранном агенте — от всех агентов, а не «100%»", () => {
    h.rows = ROWS;
    page();
    fireEvent.click(screen.getByRole("combobox", { name: "Агент" }));
    fireEvent.click(screen.getByRole("option", { name: "Бобур" }));
    // 180 000 из 600 000 + 180 000 + 35 000 = 815 000.
    expect(screen.getByText("(22.1%)")).toBeTruthy();
    expect(screen.queryByText("(100.0%)")).toBeNull();
  });

  it("количество в шапке агента — по единицам, а не одним числом", () => {
    h.rows = ROWS;
    page();
    const qty = screen.getAllByTestId("agent-qty-by-unit").map(e => e.textContent);
    expect(qty).toContain("120 шт · 25.5 кг · 10 ящ");
    expect(qty.join(" ")).not.toContain("155.5");
  });

  it("на узбекском — узбекские единицы и в шапке, и в ячейках таблицы", () => {
    h.lang = "uz";
    h.rows = ROWS;
    page();
    expect(screen.getAllByTestId("agent-qty-by-unit").map(e => e.textContent)).toContain("120 dona · 25.5 kg · 10 quti");
    // Ячейки — отдельно от шапки: шапка одна удовлетворяла проверку, пока
    // строки таблицы печатали «шт».
    const cells = screen.getAllByRole("cell").map(c => (c.textContent ?? "").trim());
    expect(cells).toContain("120 dona");
    expect(cells).toContain("4 dona"); // «Вернули»
    // Подстрокой, а не \b: граница слова в JS не видит кириллицу, и /\bшт\b/
    // не находит «120 шт» никогда.
    expect(cells.some(c => / (шт|кг|ящ)$/.test(c)), "русская единица в ячейке").toBe(false);
  });
});

// @vitest-environment jsdom
/**
 * «Обзор» и «Продажи» — в деньгах P&L, количества — с дробью и единицей.
 *
 * Аудит 09.10.2026, экранная часть:
 *
 *  · плитка «Выручка» и «Средний чек» брали заказы ДО возвратов
 *    (salesRevenue), а P&L — после; «Доля в выручке» у «Топ товаров» делила
 *    чистые деньги товара на грязный итог;
 *  · П10 — «.toFixed(0)» в «Топ товаров», «Сводке», печати и P&L: 2,5 кг
 *    показывались как «3», а штуки и килограммы — одним числом без подписи.
 *
 * Нарочные поломки (после checkpoint-коммита): totalsOf по salesRevenue —
 * падают «плитка» и «доля»; вернуть toFixed(0) в SalesTab — падает
 * «единицы»; unitShort без языка — падает «узбекский»; toFixed(0) в «Сводке»
 * или печати — падает «бумага»; в PnLExpenseBreakdown — падает «P&L».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const h = vi.hoisted(() => ({
  lang: "ru" as "ru" | "uz",
  excel: [] as Array<Array<Record<string, unknown>>>,
  pdf: [] as string[],
}));

vi.mock("recharts", () => {
  const Пусто = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Пусто, LineChart: Пусто, BarChart: Пусто, Line: () => null, Bar: Пусто, Cell: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  };
});
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: h.lang }),
  useTranslate: () => (ru: string, uz: string) => (h.lang === "uz" ? uz : ru),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "ceo" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/excel", () => ({
  exportToExcel: vi.fn(async (rows: Array<Record<string, unknown>>) => { h.excel.push(rows); }),
}));
vi.mock("@/lib/export", () => ({
  exportToPDF: vi.fn((_title: string, html: string) => { h.pdf.push(html); }),
  escapeHtml: (s: unknown) => String(s ?? ""),
}));

/*
  Агент заказал на 1 000, вернули на 200: P&L — 800. Товары в тех же
  деньгах: Сахар 600 + Cola 200 = 800.
*/
const DATA: Record<string, unknown> = {
  "analytics.agentPerformance": [
    { agentId: 1, agentName: "Азиз", orderCount: 2, salesRevenue: 1000, returnedAmount: 200, totalRevenue: 800, avgOrderValue: 400 },
  ],
  "analytics.topProducts": [
    { productId: 2, productName: "Сахар", productCode: "S-1", unit: "kg", totalQty: 2.5, returnedQty: 0, grossRevenue: 700, salesRevenue: 600, returnedAmount: 0, totalRevenue: 600, orderCount: 1 },
    { productId: 1, productName: "Cola", productCode: "C-1", unit: "pcs", totalQty: 15, returnedQty: 5, grossRevenue: 400, salesRevenue: 400, returnedAmount: 200, totalRevenue: 200, orderCount: 2 },
  ],
  "analytics.salesByShop": [
    { shopId: 1, shopName: "Хумо", orderCount: 2, salesRevenue: 1000, returnedAmount: 200, revenue: 800 },
  ],
};

vi.mock("@/providers/trpc", () => {
  const answer = (path: string) => ({
    data: DATA[path], isLoading: false, isFetching: false, isError: false, isLoadingError: false, error: null,
    refetch: async () => ({ data: DATA[path] }),
  });
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) return answer(path.slice(0, -1).join("."));
      void args;
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

vi.mock("@/components/reports/AgentsTab", () => ({ AgentsTab: () => null }));
vi.mock("@/components/debts/DebtorsPanel", () => ({ DebtorsPanel: () => null }));
vi.mock("@/components/debts/DebtJournalPanel", () => ({ DebtJournalPanel: () => null }));
vi.mock("@/components/reports/NoOrderVisitsTab", () => ({ NoOrderVisitsTab: () => null }));
vi.mock("@/components/reports/ProfitTab", () => ({ ProfitTab: () => null }));
vi.mock("@/components/reports/AbcTab", () => ({ AbcTab: () => null }));
vi.mock("@/components/reports/SalesMapTab", () => ({ SalesMapTab: () => null }));
vi.mock("@/components/plans/PlanForecast", () => ({ PlanForecastCard: () => null }));

const { default: Reports } = await import("@/pages/Reports");
const { PnLExpenseBreakdown } = await import("@/components/pnl/PnLExpenseBreakdown");

const page = (tab: string) => render(<MemoryRouter initialEntries={[`/reports?tab=${tab}`]}><Reports /></MemoryRouter>);
const tile = (label: RegExp) => within(screen.getByText(label).closest(".kpi-hero") as HTMLElement);
const cells = () => screen.getAllByRole("cell").map(c => (c.textContent ?? "").trim());

afterEach(() => { cleanup(); h.lang = "ru"; h.excel.length = 0; h.pdf.length = 0; });

describe("«Обзор» и «Продажи» — в деньгах P&L", () => {
  it("плитка «Выручка» — после возвратов, как P&L; средний чек — от неё", () => {
    page("overview");
    expect(tile(/^ВЫРУЧКА · /).getByText("800")).toBeTruthy();
    expect(tile(/^ВЫРУЧКА · /).queryByText("1000"), "плитка взяла заказы до возвратов").toBeNull();
    expect(tile(/^СРЕДНИЙ ЧЕК · /).getByText("400")).toBeTruthy();
  });

  it("доля в «Топ товаров» — от той же выручки: 600 из 800, а не из 1 000", () => {
    page("sales");
    expect(screen.getByText("75.0%")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
    expect(screen.queryByText("60.0%"), "знаменатель — заказы до возвратов").toBeNull();
    expect(screen.getByTestId("top-products-basis").textContent).toContain("за вычетом возвратов");
  });

  it("единицы: 2,5 кг — не «3», у Cola — «шт» и сколько вернули", () => {
    page("sales");
    const c = cells();
    expect(c).toContain("2.5 кг");
    expect(c.some(x => x.startsWith("15 шт")), "штуки без единицы").toBe(true);
    expect(c.some(x => x.includes("вернули 5 шт"))).toBe(true);
    expect(c, "округлено до целых").not.toContain("3");
  });

  it("«Обзор»: подсказка у товара — с единицей", () => {
    page("overview");
    expect(screen.getByText("2.5 кг продано")).toBeTruthy();
  });

  it("на узбекском — узбекские единицы", () => {
    h.lang = "uz";
    page("sales");
    expect(cells()).toContain("2.5 kg");
    expect(cells().some(x => x.startsWith("15 dona"))).toBe(true);
  });

  it("бумага — «Сводка» и печать — с дробью и русской единицей", async () => {
    h.lang = "uz";
    page("overview");
    fireEvent.click(screen.getByRole("button", { name: /Yig'ma/ }));
    await vi.waitFor(() => expect(h.excel).toHaveLength(1));
    const sugar = h.excel[0].find(r => r["Показатель"] === "Сахар");
    expect(sugar?.["Значение"]).toBe("2.5 кг");
    const shop = h.excel[0].find(r => r["Показатель"] === "Хумо");
    expect(Number(shop?.["Значение"]), "магазин — до возвратов").toBe(800);

    fireEvent.click(screen.getByRole("button", { name: /Chop|Печать|PDF/i }));
    await vi.waitFor(() => expect(h.pdf).toHaveLength(1));
    expect(h.pdf[0]).toContain("2.5 кг");
    expect(h.pdf[0]).toContain("15 шт");
  });

  it("P&L «На чём заработали» — 2,5 кг, а не «3»", () => {
    render(<PnLExpenseBreakdown
      cogsByProduct={[{ productName: "Сахар", unit: "kg", totalQty: "2.5", totalRevenue: "2500", totalCost: "1500" }]}
      fmt={v => String(v)} lang="ru" />);
    expect(cells()).toContain("2.5 кг");
    cleanup();
    render(<PnLExpenseBreakdown
      cogsByProduct={[{ productName: "Сахар", unit: "kg", totalQty: "2.5", totalRevenue: "2500", totalCost: "1500" }]}
      fmt={v => String(v)} lang="uz" />);
    expect(cells()).toContain("2.5 kg");
  });
});

// @vitest-environment jsdom
/**
 * «Отчёты» → «Все выгрузки»: каталог — один период и строки, а не стена карточек.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Шестнадцать одинаковых карточек, в десяти своя пара дат, под каждой
 * залитая кнопка «Excel». Владелец: «выглядит очень плохо». Группы — по
 * роутерам («Финансы», «Сотрудники» из одной карточки), долги среди
 * справочников. В шапке над каталогом висел ещё и переключатель дней
 * страницы — второй период на одном экране.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Группы по тому, за чем приходят, в своём порядке; у директора все
 *     шестнадцать выгрузок, у каждой ровно одна кнопка; полей дат в каталоге
 *     ровно два — общий период сверху.
 *  2. Период сверху доходит до каждой строки «за период» и до запроса и
 *     имени файла; выгрузки «на сегодня» так и подписаны.
 *  3. Роль: оператор не видит денег директора (P&L, себестоимость) и
 *     сотрудников, а пустых групп нет.
 *  4. Шапка: кнопка каталога нажата ровно тогда, когда каталог открыт; при
 *     открытом каталоге переключателя дней страницы, «Сводки» и «Печати» нет;
 *     в разделе со своим периодом («Без заказа») вход в каталог на месте.
 *
 * Нарочные поломки:
 *  — в ReportCard.tsx `const params: ReportParams = { from, to, ...filters }`
 *    → `{ from: "2026-01-01", to, ...filters }` (строка не берёт период
 *    сверху) — падает 2;
 *  — в Reports.tsx `const pagePeriod = !ownPeriod && tab !== "all"` →
 *    `= !ownPeriod` (два периода на экране) — падает 4.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; input: unknown }>,
  role: "ceo",
  exported: [] as Array<{ rows: unknown[]; filename: string }>,
}));

vi.mock("recharts", () => {
  const Пусто = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Пусто, LineChart: Пусто, Line: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null };
});
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: h.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn(async (rows: unknown[], filename: string) => { h.exported.push({ rows, filename }); }) }));

/*
  trpc — заглушка на любой путь: каждый вызов use*() записывается, ответ —
  «данных ещё нет». Выгрузке по товарам refetch отдаёт одну строку: по ней
  проверяется, что файл собран с периодом сверху.
*/
vi.mock("@/providers/trpc", () => {
  const idle = (path: string) => ({
    data: undefined, isLoading: false, isFetching: false, isError: false, isLoadingError: false, error: null,
    refetch: async () => ({ data: path === "analytics.topProducts" ? [{ productName: "Чай", productCode: "T1", totalQty: "3", totalRevenue: "300" }] : [] }),
  });
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) {
        const p = path.slice(0, -1).join(".");
        h.calls.push({ path: p, input: args[0] });
        return idle(p);
      }
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

// Разделы «Отчётов» — не предмет проверки: заглушки, чтобы страница не тянула их запросы.
vi.mock("@/components/reports/OverviewTab", () => ({ OverviewTab: () => <div data-testid="overview" /> }));
vi.mock("@/components/reports/SalesTab", () => ({ SalesTab: () => null }));
vi.mock("@/components/reports/AgentsTab", () => ({ AgentsTab: () => null }));
vi.mock("@/components/reports/AgentProductsTab", () => ({ AgentProductsTab: () => null }));
vi.mock("@/components/debts/DebtorsPanel", () => ({ DebtorsPanel: () => null }));
vi.mock("@/components/debts/DebtJournalPanel", () => ({ DebtJournalPanel: () => null }));
vi.mock("@/components/reports/NoOrderVisitsTab", () => ({ NoOrderVisitsTab: () => <div data-testid="noorder" /> }));
vi.mock("@/components/reports/ProfitTab", () => ({ ProfitTab: () => null }));
vi.mock("@/components/reports/AbcTab", () => ({ AbcTab: () => null }));
vi.mock("@/components/reports/SalesMapTab", () => ({ SalesMapTab: () => null }));
vi.mock("@/components/plans/PlanForecast", () => ({ PlanForecastCard: () => null }));

const { ReportsHub } = await import("@/components/reports/ReportsHub");
const { default: Reports } = await import("@/pages/Reports");

const t = (ru: string) => ru;
const hub = (role: string) => render(<MemoryRouter><ReportsHub role={role} t={t} lang="ru" /></MemoryRouter>);
const headings = () => screen.getAllByRole("heading", { level: 3 }).map(e => e.textContent);
const row = (id: string) => screen.getByTestId(`export-${id}`);

afterEach(() => { cleanup(); h.calls = []; h.exported = []; h.role = "ceo"; });

describe("каталог выгрузок", () => {
  it("1. группы по смыслу, по одной кнопке на выгрузку, период один", () => {
    const { container } = hub("ceo");
    expect(headings()).toEqual(["Продажи", "Деньги и долги", "Магазины и визиты", "Команда", "Склад и закупки"]);
    const rows = container.querySelectorAll("[data-testid^=export-]");
    expect(rows.length).toBe(16);
    for (const r of rows) expect(within(r as HTMLElement).getAllByRole("button", { name: /^Скачать Excel/ })).toHaveLength(1);
    expect(container.querySelectorAll("input[type=date]"), "дат — одна пара на весь каталог").toHaveLength(2);
    // Долги — в деньгах, а не среди справочников магазинов.
    const money = screen.getByRole("region", { name: "Деньги и долги" });
    expect(within(money).getByText("Долги магазинов")).toBeTruthy();
    expect(within(money).getByText("Журнал задолженности")).toBeTruthy();
  });

  it("2. период сверху — в каждую строку, в запрос и в имя файла", async () => {
    hub("ceo");
    fireEvent.change(screen.getByTestId("exports-from"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByTestId("exports-to"), { target: { value: "2026-09-15" } });
    expect(within(row("sales-by-product")).getByText(/01\.09 – 15\.09/)).toBeTruthy();
    expect(within(row("visits-log")).getByText(/01\.09 – 15\.09/)).toBeTruthy();
    expect(within(row("debt-report")).getByText(/на сегодня/)).toBeTruthy();
    expect(within(row("staff")).getByText(/на сегодня/)).toBeTruthy();

    fireEvent.click(within(row("sales-by-product")).getByRole("button", { name: /^Скачать Excel/ }));
    await waitFor(() => expect(h.exported).toHaveLength(1));
    expect(h.exported[0].filename).toBe("sales-by-product-2026-09-01_2026-09-15");
    expect(h.calls.filter(c => c.path === "analytics.topProducts").at(-1)?.input)
      .toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-15" });
  });

  it("3. оператору — без денег директора и без сотрудников, пустых групп нет", () => {
    const { container } = hub("operator");
    expect(screen.queryByTestId("export-pnl")).toBeNull();
    expect(screen.queryByTestId("export-cogs-by-product")).toBeNull();
    expect(screen.queryByTestId("export-staff")).toBeNull();
    for (const s of container.querySelectorAll("section")) {
      expect(s.querySelectorAll("[data-testid^=export-]").length, s.querySelector("h3")?.textContent ?? "").toBeGreaterThan(0);
    }
  });
});

describe("шапка «Отчётов» и вход в каталог", () => {
  const page = (url: string) => render(<MemoryRouter initialEntries={[url]}><Reports /></MemoryRouter>);
  const toggle = () => screen.getByRole("button", { name: /выгрузки$/ });

  it("4. каталог закрыт: кнопка не нажата, период страницы и «Сводка» на месте", () => {
    page("/reports");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().textContent).toContain("Все выгрузки");
    expect(screen.getByRole("button", { name: "30 дней" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Сводка/ })).toBeTruthy();
    expect(screen.queryByTestId("reports-hub")).toBeNull();
  });

  it("4. каталог открыт: кнопка нажата, второго периода на экране нет", () => {
    page("/reports?tab=all");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toContain("Скрыть выгрузки");
    expect(screen.getByTestId("reports-hub")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "30 дней" }), "переключатель дней страницы").toBeNull();
    expect(screen.queryByRole("button", { name: /Сводка/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Печать/ })).toBeNull();

    fireEvent.click(toggle());
    expect(screen.queryByTestId("reports-hub")).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("4. раздел со своим периодом: «Сводки» нет, вход в каталог на месте", () => {
    page("/reports?tab=noorder");
    expect(screen.getByTestId("noorder")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Сводка/ })).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle());
    expect(screen.getByTestId("reports-hub")).toBeTruthy();
  });
});

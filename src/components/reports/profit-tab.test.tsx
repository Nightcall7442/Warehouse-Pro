// @vitest-environment jsdom
/**
 * «Прибыль» на экране: фильтры и сортировка в адресе, подсветка «в минус»,
 * сверка с P&L.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Раздела не было. Здесь проверяется то, что ломается молча и чего нельзя
 * увидеть в данных сервера: что ссылку «магазины в минус по марже» можно
 * переслать (фильтр и сортировка живут в адресе), что строка в минус
 * выделена, а «сходится с P&L» не печатается, когда не сходится.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • alarm в useState вместо адреса — падает «тревога в адресе»;
 *  • убрать FLAG_BG у строки — падает «подсветка»;
 *  • печатать «сходится» без r.pnl.matches — падает «не сходится».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { MarginRow } from "@contracts/margin";

const state = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>>, data: undefined as unknown, exported: [] as unknown[][] }));

vi.mock("@/providers/trpc", () => ({
  trpc: { reports: { margin: { useQuery: (input: Record<string, unknown>) => { state.inputs.push(input); return { data: state.data, isError: false, refetch: () => {} }; } } } },
}));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: number) => `${v} сум` }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/excel", () => ({ exportToExcel: (...a: unknown[]) => { state.exported.push(a); } }));

const { ProfitTab } = await import("./ProfitTab");

const row = (over: Partial<MarginRow>): MarginRow => ({
  key: 1, name: "Товар", sub: null, revenue: 1000, cost: 600, profit: 400, marginPct: 40, revenueShare: 10,
  profitShare: 20, qty: 10, orders: 1, flag: null, reasons: [], ...over,
});

const ROWS: MarginRow[] = [
  row({ key: 1, name: "Сок", revenue: 5000, cost: 3000, profit: 2000, marginPct: 40, profitShare: 80 }),
  row({ key: 2, name: "Вода", revenue: 3000, cost: 3300, profit: -300, marginPct: -10, profitShare: -12, flag: "loss",
    reasons: [{ code: "below_cost", amount: 300 }] }),
  row({ key: 3, name: "Чай", revenue: 2000, cost: 1940, profit: 60, marginPct: 3, profitShare: 2.4, flag: "low",
    reasons: [{ code: "discount", amount: 250, pct: 11 }] }),
  row({ key: 4, name: "Акмаль", revenue: 500, cost: 260, profit: 240, marginPct: 48, profitShare: 9.6 }),
];

const report = (matches = true) => ({
  from: "x", to: "y", by: "product", rows: ROWS,
  totals: { revenue: 10_500, cost: 8_500, profit: 2_000, marginPct: 19, flagged: 2 },
  pnl: { revenue: matches ? 10_500 : 11_000, cost: 8_500, profit: matches ? 2_000 : 2_500, matches, diff: { revenue: matches ? 0 : 500, cost: 0 } },
});

function Where() { const l = useLocation(); return <div data-testid="where">{l.search}</div>; }
function mount(url = "/reports?tab=profit") {
  return render(<MemoryRouter initialEntries={[url]}><ProfitTab /><Where /></MemoryRouter>);
}
const where = () => new URLSearchParams(screen.getByTestId("where").textContent ?? "");
const names = () => screen.getAllByTestId("profit-row").map(r => within(r).getAllByRole("cell")[0].textContent ?? "");

beforeEach(() => { state.inputs = []; state.exported = []; state.data = report(); });
afterEach(cleanup);

describe("«Прибыль»: адрес, подсветка, сверка", () => {
  it("по умолчанию — товары по выручке; строки в минус и с низкой маржой подсвечены", () => {
    mount();
    expect(state.inputs.at(-1)).toMatchObject({ by: "product" });
    expect(names().map(n => n.split(" ·")[0].replace(/в минус|низкая маржа/, "").trim())).toEqual(["Сок", "Вода", "Чай", "Акмаль"]);
    const loss = screen.getAllByTestId("profit-row").find(r => r.dataset.flag === "loss")!;
    expect(loss.getAttribute("style")).toContain("var(--color-danger-subtle)");
    expect(within(loss).getByText("в минус")).toBeDefined();
    const low = screen.getAllByTestId("profit-row").find(r => r.dataset.flag === "low")!;
    expect(low.getAttribute("style")).toContain("var(--color-warning-subtle)");
    const ok = screen.getAllByTestId("profit-row").find(r => r.dataset.flag === "")!;
    expect(ok.getAttribute("style") ?? "").not.toContain("subtle");
    expect(within(loss).getByText("Продано ниже себестоимости: −300 сум")).toBeDefined();
  });

  it("тревога в адресе: чип оставляет только «в минус» и «низкую маржу»", () => {
    mount();
    fireEvent.click(screen.getByTestId("profit-alarm"));
    expect(where().get("alarm")).toBe("1");
    expect(screen.getAllByTestId("profit-row").map(r => r.dataset.flag)).toEqual(["loss", "low"]);
    fireEvent.click(screen.getByTestId("profit-alarm"));
    expect(where().get("alarm")).toBeNull();
    expect(screen.getAllByTestId("profit-row")).toHaveLength(4);
  });

  it("сортировка в адресе: по прибыли вниз, повторный щелчок — вверх", () => {
    mount();
    fireEvent.click(screen.getByTestId("profit-sort-profit"));
    expect(where().get("sort")).toBe("profit");
    expect(where().get("dir")).toBeNull(); // «вниз» — умолчание, в адрес не пишется
    expect(screen.getAllByTestId("profit-row").map(r => r.dataset.flag)).toEqual(["", "", "low", "loss"]);
    fireEvent.click(screen.getByTestId("profit-sort-profit"));
    expect(where().get("dir")).toBe("asc");
    expect(screen.getAllByTestId("profit-row")[0].dataset.flag).toBe("loss");
  });

  it("пересланная ссылка открывается тем же: разрез, тревога и сортировка из адреса", () => {
    mount("/reports?tab=profit&by=shop&alarm=1&sort=margin&dir=asc");
    expect(state.inputs.at(-1)).toMatchObject({ by: "shop" });
    // Только тревожные, по марже вверх: −10% раньше 3%.
    expect(screen.getAllByTestId("profit-row").map(r => r.dataset.flag)).toEqual(["loss", "low"]);
    expect(screen.getByRole("radio", { name: "Магазины" }).getAttribute("aria-checked")).toBe("true");
  });

  it("разрез «Агенты» пишется в адрес и уходит в запрос", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Агенты" }));
    expect(where().get("by")).toBe("agent");
    expect(state.inputs.at(-1)).toMatchObject({ by: "agent" });
  });

  it("сходится — так и сказано; не сходится — названа разница, а не «сходится»", () => {
    mount();
    const ok = screen.getByTestId("profit-reconcile");
    expect(ok.dataset.matches).toBe("1");
    expect(ok.textContent).toContain("Сходится с P&L за этот период: выручка 10500 сум, себестоимость 8500 сум.");
    expect(ok.textContent).toContain("до расходов");
    cleanup();
    state.data = report(false);
    mount();
    const bad = screen.getByTestId("profit-reconcile");
    expect(bad.dataset.matches).toBe("0");
    expect(bad.textContent).not.toContain("Сходится");
    expect(bad.textContent).toContain("больше на 500 сум");
  });

  it("Excel — по-русски и теми строками, что на экране", () => {
    mount("/reports?tab=profit&alarm=1");
    fireEvent.click(screen.getByRole("button", { name: /Excel/ }));
    const [rows, , sheet] = state.exported[0] as [Array<Record<string, unknown>>, string, string];
    expect(sheet).toBe("Прибыль");
    expect(rows.map(r => r["Товар"])).toEqual(["Вода", "Чай"]);
    expect(rows[0]).toMatchObject({ "Валовая прибыль": -300, "Тревога": "В минус" });
    expect(String(rows[1]["Причины"])).toContain("Скидка заказов");
  });
});

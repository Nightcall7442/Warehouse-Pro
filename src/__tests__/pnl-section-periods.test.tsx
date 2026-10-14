// @vitest-environment jsdom
/**
 * «Доходы и расходы»: у каждого раздела — свой календарь в шапке.
 *
 * Владелец: «На чём заработали — от … до …, вообще везде нужна такая
 * функция». Здесь закреплено:
 *   1. календарь раздела меняет запрос только этого раздела — шапка, плитки
 *      и соседние разделы остаются за период страницы;
 *   2. свой период графика — отдельный запрос P&L, а не подмена периода всей
 *      страницы;
 *   3. смена периода страницы возвращает разделы к нему, «Сбросить» в
 *      календаре раздела — тоже.
 *
 * Нарочная поломка: в PnL.tsx отдай cogsByProduct даты страницы (from/to)
 * вместо productsPeriod — упадёт 1; убери сброс по смене периода страницы в
 * useSectionPeriod (сравнение pick.page) — упадёт 3.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { openRange, pickRange } from "./pick-range";

const h = vi.hoisted(() => ({ calls: [] as Array<{ path: string; input: Record<string, unknown>; opts?: Record<string, unknown> }> }));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v), symbol: "сум" }) }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: null }) }));

const TOTALS = {
  revenue: 1000, discount: 0, orderCount: 3, cogs: 600, operatingExpenses: 100,
  purchaseExpenses: 100, payrollExpenses: 0, payoutCount: 0, arrivalCount: 1,
  grossProfit: 400, grossMarginPct: 40, netProfit: 300, netMarginPct: 30,
};

vi.mock("@/providers/trpc", () => {
  const answer = (path: string, input: Record<string, unknown>) => {
    if (path === "analytics.pnl") {
      return {
        current: TOTALS, previous: null, deltas: {}, trend: [],
        series: { granularity: "day", points: [] },
        period: { from: input.from, to: input.to }, prevPeriod: null,
      };
    }
    return undefined;
  };
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) {
        const p = path.slice(0, -1).join(".");
        const input = (args[0] ?? {}) as Record<string, unknown>;
        const opts = args[1] as Record<string, unknown> | undefined;
        h.calls.push({ path: p, input, opts });
        return {
          data: answer(p, input), isLoading: false, isFetching: false, isError: false,
          isLoadingError: false, error: null, refetch: async () => ({}),
        };
      }
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

const { default: PnL } = await import("@/pages/PnL");

/** Последний запрос этого пути — с тем, что страница отдала в этом рендере. */
const last = (path: string, pred: (c: (typeof h.calls)[number]) => boolean = () => true) =>
  [...h.calls].reverse().find(c => c.path === path && pred(c));
/** Главный запрос P&L страницы — тот, что сравнивает с прошлым периодом. */
const pagePnl = () => last("analytics.pnl", c => c.input.compareWithPrev === true)!.input;
const ownChartPnl = () => last("analytics.pnl", c => c.input.compareWithPrev === false);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00+05:00")); // 13 октября, Ташкент
  h.calls.length = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = () => render(<MemoryRouter><PnL /></MemoryRouter>);

describe("календари разделов P&L", () => {
  it("1. календарь «На чём заработали» меняет только этот раздел", () => {
    show();
    // Сначала все разделы — за период страницы, 30 дней.
    for (const id of ["pnl-chart-range", "pnl-products-range", "pnl-payments-range", "pnl-transport-range"]) {
      expect(screen.getByTestId(id).textContent, id).toBe("13.09.2026 — 13.10.2026");
      expect(screen.getByTestId(id).getAttribute("aria-pressed"), id).toBe("false");
    }

    pickRange("pnl-products-range", "2026-09-01", "2026-09-15");

    expect(last("analytics.cogsByProduct")!.input, "раздел не получил свои даты")
      .toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-15" });
    expect(screen.getByTestId("pnl-products-range").textContent).toBe("01.09.2026 — 15.09.2026");
    expect(screen.getByTestId("pnl-products-range").getAttribute("aria-pressed")).toBe("true");
    // Остальное — за период страницы, как было.
    expect(pagePnl()).toMatchObject({ from: "2026-09-13", to: "2026-10-13" });
    expect(last("analytics.pnlByPaymentMethod")!.input).toEqual({ from: "2026-09-13", to: "2026-10-13" });
    expect(screen.getByTestId("pnl-payments-range").textContent).toBe("13.09.2026 — 13.10.2026");
  });

  it("2. свой период графика — отдельный запрос, шапка страницы не трогается", () => {
    show();
    expect(ownChartPnl()?.opts?.enabled, "лишний запрос графика без своего периода").toBe(false);

    pickRange("pnl-chart-range", "2026-07-01", "2026-09-30");

    const own = ownChartPnl()!;
    expect(own.input).toEqual({ from: "2026-07-01", to: "2026-09-30", compareWithPrev: false });
    expect(own.opts?.enabled).toBe(true);
    expect(pagePnl()).toMatchObject({ from: "2026-09-13", to: "2026-10-13" });
  });

  it("3. смена периода страницы и «Сбросить» возвращают раздел к странице", () => {
    show();
    pickRange("pnl-payments-range", "2026-09-01", "2026-09-10");
    expect(last("analytics.pnlByPaymentMethod")!.input).toEqual({ from: "2026-09-01", to: "2026-09-10" });

    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    expect(screen.getByTestId("pnl-payments-range").textContent).toBe("06.10.2026 — 13.10.2026");
    expect(last("analytics.pnlByPaymentMethod")!.input).toEqual({ from: "2026-10-06", to: "2026-10-13" });

    pickRange("pnl-payments-range", "2026-10-01", "2026-10-05");
    openRange("pnl-payments-range");
    fireEvent.click(within(screen.getByTestId("pnl-payments-range-calendar")).getByRole("button", { name: "Сбросить" }));
    expect(screen.getByTestId("pnl-payments-range").textContent).toBe("06.10.2026 — 13.10.2026");
    expect(screen.getByTestId("pnl-payments-range").getAttribute("aria-pressed")).toBe("false");
    expect(last("analytics.pnlByPaymentMethod")!.input).toEqual({ from: "2026-10-06", to: "2026-10-13" });
  });
});

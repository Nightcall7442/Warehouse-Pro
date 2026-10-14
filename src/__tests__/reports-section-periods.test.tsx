// @vitest-environment jsdom
/**
 * «Отчёты»: у разделов «Обзора» и «Продаж» — свои календари.
 *
 * Закреплено:
 *   1. календарь «Топ товаров» меняет только запрос товаров; плитки сводки и
 *      таблица «Агенты» (agentPerformance страницы) остаются за период страницы;
 *   2. «Лучшие агенты» со своим периодом — отдельный запрос, а не подмена
 *      agentPerformance всей страницы;
 *   3. один источник — один календарь: «Топ товаров» на «Обзоре» и на
 *      «Продажах» показывают один и тот же свой период; смена периода страницы
 *      возвращает разделы к нему.
 *
 * Нарочная поломка: в Reports.tsx отдай topProducts даты страницы — упадёт 1;
 * отдай ownTopAgentsQ даты страницы или убери enabled — упадёт 2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { pickRange } from "./pick-range";

const h = vi.hoisted(() => ({ calls: [] as Array<{ path: string; input: Record<string, unknown>; opts?: Record<string, unknown> }> }));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "ceo" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

vi.mock("@/providers/trpc", () => {
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) {
        const p = path.slice(0, -1).join(".");
        h.calls.push({ path: p, input: (args[0] ?? {}) as Record<string, unknown>, opts: args[1] as Record<string, unknown> | undefined });
        return { data: undefined, isLoading: false, isFetching: false, isError: false, isLoadingError: false, error: null, refetch: async () => ({}) };
      }
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

/*
  Вкладки — заглушки, которые рисуют только переданные календари: проверяется
  проводка страницы (какой раздел каким периодом спрашивает), а не вёрстка
  вкладок.
*/
const Pickers = ({ pickers }: { pickers?: Record<string, ReactNode> }) => <div>{Object.values(pickers ?? {})}</div>;
vi.mock("@/components/reports/OverviewTab", () => ({ OverviewTab: Pickers }));
vi.mock("@/components/reports/SalesTab", () => ({ SalesTab: Pickers }));
vi.mock("@/components/reports/AgentsTab", () => ({ AgentsTab: () => null }));
vi.mock("@/components/reports/AgentProductsTab", () => ({ AgentProductsTab: () => null }));
vi.mock("@/components/debts/DebtorsPanel", () => ({ DebtorsPanel: () => null }));
vi.mock("@/components/debts/DebtJournalPanel", () => ({ DebtJournalPanel: () => null }));
vi.mock("@/components/reports/NoOrderVisitsTab", () => ({ NoOrderVisitsTab: () => null }));
vi.mock("@/components/reports/ProfitTab", () => ({ ProfitTab: () => null }));
vi.mock("@/components/reports/AbcTab", () => ({ AbcTab: () => null }));
vi.mock("@/components/reports/SalesMapTab", () => ({ SalesMapTab: () => null }));
vi.mock("@/components/plans/PlanForecast", () => ({ PlanForecastCard: () => null }));

const { default: Reports } = await import("@/pages/Reports");

const last = (path: string, pred: (c: (typeof h.calls)[number]) => boolean = () => true) =>
  [...h.calls].reverse().find(c => c.path === path && pred(c));
/** agentPerformance страницы — тот, что всегда включён и за текущий период. */
const pageAgents = () => last("analytics.agentPerformance", c => c.opts === undefined && c.input.dateTo === "2026-10-13")!.input;
const ownTopAgents = () => last("analytics.agentPerformance", c => c.opts?.enabled !== undefined)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00+05:00")); // 13 октября, Ташкент
  h.calls.length = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const page = (url: string) => render(<MemoryRouter initialEntries={[url]}><Reports /></MemoryRouter>);

describe("календари разделов «Отчётов»", () => {
  it("1. «Топ товаров» со своим периодом — плитки и «Агенты» за период страницы", () => {
    page("/reports");
    expect(screen.getByTestId("reports-top-products-range").textContent, "узкая панель — без года").toBe("13.09 — 13.10");

    pickRange("reports-top-products-range", "2026-09-01", "2026-09-15");

    expect(last("analytics.topProducts")!.input).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-15" });
    expect(pageAgents()).toEqual({ dateFrom: "2026-09-13", dateTo: "2026-10-13" });
    expect(last("analytics.salesByShop")!.input).toEqual({ dateFrom: "2026-09-13", dateTo: "2026-10-13" });
    expect(screen.getByTestId("reports-top-products-range").getAttribute("aria-pressed")).toBe("true");
  });

  it("2. «Лучшие агенты» со своим периодом — отдельный запрос", () => {
    page("/reports");
    expect(ownTopAgents().opts?.enabled, "лишний запрос без своего периода").toBe(false);

    pickRange("reports-top-agents-range", "2026-08-01", "2026-08-31");

    expect(ownTopAgents().input).toEqual({ dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    expect(ownTopAgents().opts?.enabled).toBe(true);
    expect(pageAgents()).toEqual({ dateFrom: "2026-09-13", dateTo: "2026-10-13" });
  });

  it("3. один источник — один календарь на двух вкладках; период страницы сбрасывает", () => {
    page("/reports");
    pickRange("reports-top-products-range", "2026-09-01", "2026-09-15");

    fireEvent.click(screen.getByRole("tab", { name: /Продажи/ }));
    expect(screen.getByTestId("reports-products-range").textContent).toBe("01.09.2026 — 15.09.2026");

    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    expect(screen.getByTestId("reports-products-range").textContent).toBe("06.10.2026 — 13.10.2026");
    expect(last("analytics.topProducts")!.input).toEqual({ dateFrom: "2026-10-06", dateTo: "2026-10-13" });
  });
});

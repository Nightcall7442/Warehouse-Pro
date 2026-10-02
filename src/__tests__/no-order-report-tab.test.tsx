// @vitest-environment jsdom
/**
 * «Отчёты» → «Без заказа»: фильтры в адресе, числа и подсказки на экране.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Отчёта о визитах без заказа не было. Вкладка «Отчётов» жила в памяти:
 * читалась из адреса один раз, и переключение в адрес не попадало.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Ссылка с ?from=…&to=…&agent=…&territory=… открывает отчёт ровно с
 *     этими фильтрами — они уходят в reports.noOrderVisits.
 *  2. Смена даты и кнопка периода пишут фильтр в адрес (а не в память).
 *  3. Итоги, причины с долями, подсказки («подряд есть остаток», «берёт у
 *     конкурента») и таблицы агентов и магазинов на экране.
 *
 * Нарочная поломка: в NoOrderVisitsTab.tsx у dateCodec `format: v => (v ===
 * fallback ? null : v)` → `format: () => null` (дата не пишется в адрес) —
 * падает 2.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

const h = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>> }));

const REPORT = {
  totals: { visits: 11, withOrder: 3, withoutOrder: 8, share: 8 / 11, unspecified: 1 },
  byReason: [
    { reason: "has_stock", count: 3, share: 3 / 8 }, { reason: "competitor", count: 2, share: 2 / 8 },
    { reason: "no_money", count: 1, share: 1 / 8 }, { reason: null, count: 1, share: 1 / 8 },
  ],
  byAgent: [{ agentId: 5, agentName: "Бобур", visits: 7, withoutOrder: 5, share: 5 / 7, topReason: "has_stock" }],
  byShop: [{ shopId: 1, shopName: "Хумо", city: "Ташкент", visits: 5, withoutOrder: 4, share: 0.8, streak: { reason: "has_stock", count: 4 }, last: { reason: "has_stock", note: null, day: "2026-09-30" } }],
  competitorShops: [{ shopId: 2, shopName: "Бета", city: null, count: 2, lastDay: "2026-09-29", agentName: "Бобур" }],
  stockStreaks: [{ shopId: 1, shopName: "Хумо", count: 4 }],
  truncated: false,
};

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn() }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    reports: { noOrderVisits: { useQuery: (input: Record<string, unknown>) => { h.inputs.push(input); return { data: REPORT, isError: false, refetch: () => {} }; } } },
    agent: { listAgents: { useQuery: () => ({ data: [{ id: 5, name: "Бобур" }] }) } },
    territory: { list: { useQuery: () => ({ data: [{ id: 9, name: "Юнусабад" }] }) } },
  },
}));

const { NoOrderVisitsTab } = await import("@/components/reports/NoOrderVisitsTab");

// Адрес — в разметку: тест читает его оттуда, а не из переменной модуля.
function Probe() { return <output data-testid="location">{useLocation().search}</output>; }
const search = () => screen.getByTestId("location").textContent ?? "";
const open = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><NoOrderVisitsTab /><Probe /></MemoryRouter>,
);

afterEach(() => { cleanup(); h.inputs = []; });

describe("отчёт «Без заказа»", () => {
  it("1. фильтры из ссылки уходят в запрос", () => {
    open("/reports?tab=noorder&from=2026-09-01&to=2026-09-30&agent=5&territory=9");
    expect(h.inputs.at(-1)).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-30", agentId: 5, territoryId: 9 });
    expect((screen.getByTestId("no-order-from") as HTMLInputElement).value).toBe("2026-09-01");
  });

  it("2. смена даты и кнопка периода — в адрес", () => {
    open("/reports?tab=noorder&from=2026-09-01&to=2026-09-30");
    fireEvent.change(screen.getByTestId("no-order-from"), { target: { value: "2026-09-10" } });
    expect(new URLSearchParams(search()).get("from")).toBe("2026-09-10");
    expect(new URLSearchParams(search()).get("tab")).toBe("noorder");
    expect(h.inputs.at(-1)).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-30" });

    fireEvent.click(screen.getByRole("button", { name: "7 дн." }));
    const p = new URLSearchParams(search());
    expect(p.get("to"), "«по сегодня» — умолчание, в адрес не пишется").toBeNull();
    expect(p.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.inputs.at(-1)!.dateFrom).toBe(p.get("from"));
  });

  it("3. итоги, причины, подсказки и таблицы на экране", () => {
    open("/reports?tab=noorder");
    const totals = screen.getByTestId("no-order-totals").textContent ?? "";
    expect(totals).toContain("73%");
    expect(totals).toContain("8 из 11");
    const reasons = screen.getAllByTestId("no-order-reason-row").map(r => r.textContent);
    expect(reasons).toEqual(["Есть остаток3 · 38%", "Берёт у конкурента2 · 25%", "Нет денег1 · 13%", "Не указана1 · 13%"]);
    expect(screen.getByTestId("no-order-stock-streak").textContent).toBe("«Хумо» — 4 визита подряд «есть остаток»: заказ, похоже, великоват для его оборота");
    expect(within(screen.getByTestId("no-order-competitors")).getByText("Бета")).toBeTruthy();
    const agentRow = within(screen.getByTestId("no-order-agents")).getAllByRole("row")[1].textContent;
    expect(agentRow).toBe("Бобур7571%Есть остаток");
    const shopRow = within(screen.getByTestId("no-order-shops")).getAllByRole("row")[1].textContent;
    expect(shopRow).toContain("4 × Есть остаток");
    expect(shopRow).toContain("30.09.2026");
  });
});

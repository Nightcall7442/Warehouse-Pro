// @vitest-environment jsdom
/**
 * «Отчёты» → «Недоставленные»: срывы и переносы из журнала попыток.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Ссылка с ?from=…&to=…&courier=… открывает отчёт ровно с этими
 *     фильтрами — они уходят в reports.failedDeliveries.
 *  2. Нажатие на курьера — фильтр в адресе; сброс — обратно ко всем.
 *  3. Причины словами (и «Не указана» для старой мобилки), перенос — днём,
 *     срыв и перенос — разными словами.
 *  4. Выгрузка — по-русски при узбекском экране: печать и Excel не
 *     переводятся.
 *
 * Нарочная поломка: в FailedDeliveriesTab замени "Причина" в выгрузке на
 * t("Причина", "Sabab") — падает 4.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

const h = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>>, lang: "ru", exported: [] as unknown[][] }));

const REPORT = {
  totals: { failed: 3, rescheduled: 1, orders: 3, delivered: 17, failShare: 0.15, unspecified: 1 },
  byReason: [{ reason: "shop_closed", count: 2, share: 2 / 3 }, { reason: null, count: 1, share: 1 / 3 }],
  byCourier: [{ courierId: 7, courierName: "Азиз", failed: 3, rescheduled: 1, delivered: 17, failShare: 0.15, topReason: "shop_closed" }],
  byShop: [{ shopId: 1, shopName: "Хумо", failed: 2, rescheduled: 0, last: { reason: "shop_closed", note: "до 14:00", day: "2026-10-20" } }],
  recent: [
    { id: 2, orderId: 41, orderNumber: "ORD-41", kind: "rescheduled", courierId: 7, courierName: "Азиз", shopId: 2, shopName: "Бета", reason: "asked_reschedule", note: null, rescheduledTo: "2026-10-23", day: "2026-10-20", at: "2026-10-20 15:10" },
    { id: 1, orderId: 40, orderNumber: "ORD-40", kind: "failed", courierId: 7, courierName: "Азиз", shopId: 1, shopName: "Хумо", reason: "shop_closed", note: "до 14:00", rescheduledTo: null, day: "2026-10-20", at: "2026-10-20 11:05" },
  ],
  truncated: false,
};

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: h.lang }), useTranslate: () => (ru: string, uz: string) => (h.lang === "uz" ? uz : ru) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn((...args: unknown[]) => { h.exported.push(args); }) }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    reports: { failedDeliveries: { useQuery: (input: Record<string, unknown>) => { h.inputs.push(input); return { data: REPORT, isError: false, refetch: () => {} }; } } },
  },
}));

const { FailedDeliveriesTab } = await import("@/components/reports/FailedDeliveriesTab");

function Probe() { return <output data-testid="location">{useLocation().search}</output>; }
const search = () => new URLSearchParams(screen.getByTestId("location").textContent ?? "");
const open = (url: string) => render(<MemoryRouter initialEntries={[url]}><FailedDeliveriesTab /><Probe /></MemoryRouter>);

afterEach(() => { cleanup(); h.inputs = []; h.exported = []; h.lang = "ru"; });

describe("отчёт «Недоставленные»", () => {
  it("1. фильтры из ссылки уходят в запрос", () => {
    open("/reports?tab=failed&from=2026-10-01&to=2026-10-20&courier=7");
    expect(h.inputs.at(-1)).toEqual({ dateFrom: "2026-10-01", dateTo: "2026-10-20", courierId: 7 });
    expect(screen.getByTestId("failed-deliveries-courier-reset").textContent).toContain("Курьер: Азиз");
  });

  it("2. курьер — нажатием на строку, сброс — ко всем", () => {
    open("/reports?tab=failed&from=2026-10-01&to=2026-10-20");
    expect(h.inputs.at(-1)?.courierId).toBeUndefined();
    fireEvent.click(screen.getAllByTestId("failed-deliveries-courier-row")[0]);
    expect(search().get("courier")).toBe("7");
    expect(h.inputs.at(-1)).toMatchObject({ courierId: 7 });
    fireEvent.click(screen.getByTestId("failed-deliveries-courier-reset"));
    expect(search().get("courier")).toBeNull();
  });

  it("3. причины словами, перенос — днём", () => {
    open("/reports?tab=failed&from=2026-10-01&to=2026-10-20");
    const reasons = screen.getAllByTestId("failed-deliveries-reason-row").map(r => r.textContent);
    expect(reasons[0]).toContain("Магазин закрыт");
    expect(reasons[1]).toContain("Не указана");
    const recent = screen.getByTestId("failed-deliveries-recent").textContent ?? "";
    expect(recent).toContain("Перенесён на 23.10.2026");
    expect(recent).toContain("Не доставлен");
    expect(recent).toContain("Магазин закрыт: до 14:00");
    expect(screen.getByTestId("failed-deliveries-totals").textContent).toContain("15% попыток");
  });

  it("4. выгрузка — по-русски и при узбекском экране", () => {
    h.lang = "uz";
    open("/reports?tab=failed&from=2026-10-01&to=2026-10-20");
    expect(screen.getByTestId("failed-deliveries-recent").textContent).toContain("Yetkazilmadi");
    fireEvent.click(screen.getByText("Excel"));
    const [rows, , sheet] = h.exported[0] as [Array<Record<string, string>>, string, string];
    expect(sheet).toBe("Недоставленные");
    expect(Object.keys(rows[0])).toEqual(["Дата", "Заказ", "Магазин", "Курьер", "Что", "Причина"]);
    expect(rows[1]["Причина"]).toBe("Магазин закрыт: до 14:00");
    expect(rows[0]["Что"]).toBe("Перенесён на 23.10.2026");
  });
});

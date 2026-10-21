// @vitest-environment jsdom
/**
 * Доска развоза: курьеры, остановки, порядок объезда.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Доска: курьеры со счётом дня; выбран тот, у кого есть остановки;
 *     остановки — в порядке маршрута.
 *  2. «Предложить порядок» берёт courier.suggestRoute выбранного курьера и
 *     переставляет список; «Сохранить» шлёт ровно показанный порядок, а без
 *     изменений не жмётся.
 *
 * Нарочная поломка: в DispatchBoard отправляй serverIds вместо shownIds —
 * падает 2.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  suggestFor: [] as number[], saved: [] as unknown[],
}));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/lib/yandex-maps", () => ({ loadYandexMaps: () => new Promise(() => {}) }));
vi.mock("@/providers/trpc", () => {
  const stop = (orderId: number, routeSeq: number | null, lat: string | null) => ({
    orderId, orderNumber: `ORD-${orderId}`, courierId: 7, status: "shipped", deliveryStatus: "assigned", routeSeq,
    plannedDeliveryDate: null, total: "1000", shopName: `Магазин ${orderId}`, shopAddress: null, lat, lng: lat ? "69.2" : null,
  });
  const BOARD = {
    day: "2026-10-21",
    couriers: [
      { id: 6, name: "Без работы", phone: null, lastPing: null, open: 0, delivered: 0, failed: 0, rescheduled: 0 },
      { id: 7, name: "Азиз", phone: null, lastPing: { lat: "41.30", lng: "69.20", at: new Date() }, open: 3, delivered: 2, failed: 1, rescheduled: 1 },
    ],
    stops: [stop(11, 1, "41.31"), stop(12, 2, "41.32"), stop(13, null, null)],
  };
  return {
    trpc: {
      courier: {
        board: { useQuery: () => ({ data: BOARD, isLoading: false }) },
        dayTrack: { useQuery: () => ({ data: { points: [], events: [] } }) },
        setRouteOrder: { useMutation: (opts?: { onSuccess?: (r: unknown) => void }) => ({ mutate: (v: { orderIds: number[] }) => { h.saved.push(v); opts?.onSuccess?.({ success: true, stops: v.orderIds.length }); }, isPending: false }) },
      },
      useUtils: () => ({
        courier: {
          board: { invalidate: async () => {} },
          suggestRoute: { fetch: async ({ courierId }: { courierId: number }) => { h.suggestFor.push(courierId); return { orderIds: [12, 11, 13], km: 4.2, noGps: 1, fromCourier: true }; } },
        },
      }),
    },
  };
});

const { DispatchBoard } = await import("./DispatchBoard");

beforeEach(() => { h.suggestFor = []; h.saved = []; });
afterEach(cleanup);

const stopNames = () => screen.getAllByTestId("dispatch-stop").map(li => li.textContent?.match(/Магазин \d+/)?.[0]);

describe("доска развоза", () => {
  it("1. курьеры со счётом дня; выбран тот, у кого есть остановки; порядок маршрута", () => {
    render(<DispatchBoard />);
    expect(screen.getByTestId("dispatch-courier-7").textContent).toContain("В машине 3 · довёз 2 · сорвано 1 · перенесено 1");
    expect(screen.getByTestId("dispatch-courier-7").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("dispatch-courier-6").textContent).toContain("Нет точки GPS за сутки");
    expect(stopNames()).toEqual(["Магазин 11", "Магазин 12", "Магазин 13"]);
    expect(screen.getAllByTestId("dispatch-stop")[2].textContent).toContain("нет GPS");
  });

  it("2. «Предложить» переставляет, «Сохранить» шлёт показанный порядок", async () => {
    render(<DispatchBoard />);
    const save = () => screen.getByTestId("dispatch-save") as HTMLButtonElement;
    expect(save().disabled, "без изменений сохранять нечего").toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId("dispatch-suggest")); });
    expect(h.suggestFor).toEqual([7]);
    expect(stopNames()).toEqual(["Магазин 12", "Магазин 11", "Магазин 13"]);
    expect(screen.getByTestId("dispatch-suggestion").textContent).toContain("Около 4.2 км");
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(h.saved).toEqual([{ courierId: 7, orderIds: [12, 11, 13] }]);
  });
});

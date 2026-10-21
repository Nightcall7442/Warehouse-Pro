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
 *  3. Другой день: доска, «Предложить» и «Сохранить» — с этим днём.
 *  4. Доска не пришла — сообщение и «Повторить», а не пустое место.
 *  5. «Ждёт офиса» помечен; без права править заказы нет «Сохранить» и
 *     «Перенести»; «Перенести» у остановки — перенос офисом.
 *
 * Нарочная поломка: в DispatchBoard отправляй serverIds вместо shownIds —
 * падает 2; верни «if (!data) return null» — падает 4.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  suggestFor: [] as unknown[], saved: [] as unknown[], boardInputs: [] as unknown[], rescheduled: [] as unknown[],
  boardError: false, canEdit: true, refetched: 0,
}));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/lib/yandex-maps", () => ({ loadYandexMaps: () => new Promise(() => {}) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => h.canEdit }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/business-time", async (orig) => ({ ...(await orig<typeof import("@/lib/business-time")>()), bizToday: () => "2026-10-21" }));
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
    stops: [stop(11, 1, "41.31"), { ...stop(12, 2, "41.32"), status: "pending" }, stop(13, null, null)],
  };
  return {
    trpc: {
      courier: {
        board: { useQuery: (input: unknown) => {
          h.boardInputs.push(input);
          return h.boardError
            ? { data: undefined, isLoading: false, error: { message: "Сервер недоступен" }, refetch: async () => { h.refetched++; } }
            : { data: input ? { ...BOARD, day: (input as { date: string }).date } : BOARD, isLoading: false, refetch: async () => {} };
        } },
        officeReschedule: { useMutation: (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({ mutate: (v: unknown) => { h.rescheduled.push(v); opts?.onSuccess?.({ success: true }, v); }, isPending: false }) },
        dayTrack: { useQuery: () => ({ data: { points: [], events: [] } }) },
        setRouteOrder: { useMutation: (opts?: { onSuccess?: (r: unknown) => void }) => ({ mutate: (v: { orderIds: number[] }) => { h.saved.push(v); opts?.onSuccess?.({ success: true, stops: v.orderIds.length }); }, isPending: false }) },
      },
      useUtils: () => ({
        courier: {
          board: { invalidate: async () => {} },
          suggestRoute: { fetch: async (input: { courierId: number }) => { h.suggestFor.push(input); return { orderIds: [11, 13, 12], km: 4.2, noGps: 1, held: 1, fromCourier: true, startAt: new Date() }; } },
        },
      }),
    },
  };
});

const { DispatchBoard } = await import("./DispatchBoard");

beforeEach(() => { h.suggestFor = []; h.saved = []; h.boardInputs = []; h.rescheduled = []; h.boardError = false; h.canEdit = true; h.refetched = 0; });
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
    expect(h.suggestFor).toEqual([{ courierId: 7 }]);
    expect(stopNames()).toEqual(["Магазин 11", "Магазин 13", "Магазин 12"]);
    const note = screen.getByTestId("dispatch-suggestion").textContent;
    expect(note).toContain("Около 4.2 км");
    expect(note).toContain("от точки курьера");
    expect(note).toContain("ждут офиса: 1, они в конце");
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(h.saved).toEqual([{ courierId: 7, orderIds: [11, 13, 12] }]);
  });

  it("3. другой день: доска, «Предложить» и «Сохранить» — с этим днём", async () => {
    render(<DispatchBoard />);
    expect(h.boardInputs.at(-1)).toBeUndefined();
    fireEvent.change(screen.getByTestId("dispatch-day"), { target: { value: "2026-10-23" } });
    expect(h.boardInputs.at(-1)).toEqual({ date: "2026-10-23" });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Развоз: Послезавтра");
    await act(async () => { fireEvent.click(screen.getByTestId("dispatch-suggest")); });
    expect(h.suggestFor).toEqual([{ courierId: 7, date: "2026-10-23" }]);
    fireEvent.click(screen.getByTestId("dispatch-save"));
    expect(h.saved).toEqual([{ courierId: 7, orderIds: [11, 13, 12], date: "2026-10-23" }]);
  });

  it("4. доска не пришла — сообщение и «Повторить»", () => {
    h.boardError = true;
    render(<DispatchBoard />);
    expect(screen.getByTestId("dispatch-error").textContent).toContain("Доска развоза не загрузилась");
    fireEvent.click(screen.getByTestId("dispatch-retry"));
    expect(h.refetched).toBe(1);
  });

  it("5. «ждёт офиса» помечен; «Перенести» — перенос офисом; без права — нет ни его, ни «Сохранить»", () => {
    const { unmount } = render(<DispatchBoard />);
    const rows = screen.getAllByTestId("dispatch-stop");
    expect(rows[1].textContent).toContain("ждёт офиса");
    expect(rows[0].textContent).not.toContain("ждёт офиса");
    fireEvent.click(screen.getAllByTestId("dispatch-reschedule")[0]);
    fireEvent.click(screen.getByTestId("reschedule-day-2026-10-22"));
    fireEvent.click(screen.getByTestId("reschedule-confirm"));
    expect(h.rescheduled).toEqual([expect.objectContaining({ orderId: 11, date: "2026-10-22" })]);
    unmount();

    h.canEdit = false;
    render(<DispatchBoard />);
    expect(screen.queryByTestId("dispatch-save")).toBeNull();
    expect(screen.queryByTestId("dispatch-reschedule")).toBeNull();
  });
});

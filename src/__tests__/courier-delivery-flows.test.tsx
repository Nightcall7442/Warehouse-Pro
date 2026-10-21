// @vitest-environment jsdom
/**
 * Курьер на /deliveries: «Не доставлено» с причиной, «Перенести» с днём,
 * подтверждение вручения после «Доставлено».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. «Не доставлено» больше не отмечает срыв одним нажатием: сперва причина.
 *     Без причины кнопка не жмётся; «Другое» — только со словами. В ручку
 *     уходят код, пояснение и ключ записи.
 *  2. «Просили привезти в другой день» предлагает перенос вместо срыва, и
 *     перенос уходит в courier.reschedule на завтра (по Ташкенту), а не в
 *     markFailed.
 *  3. Курьер не может перенести на сегодня: кнопки «Сегодня» у него нет,
 *     первая — «Завтра».
 *  4. После «Доставлено» открывается подтверждение вручения; «Сохранить»
 *     без фото, подписи и имени не жмётся; с именем — уходит saveProof.
 *  5. Есть свежая точка телефона — «Доставлено», «Не доставлено»,
 *     «Перенести» и подтверждение уходят с ней (доска развоза ставит
 *     отметку на карту); точка старше пяти минут — без координат.
 *  6. Курьер просит и перенесённые (includeLater): они — в свёрнутом
 *     «Перенесено», не в «Ожидают» и не в «Выехал по всем». На карточке —
 *     место в маршруте, день переноса, «Ждёт офиса»; офису — и курьер.
 *
 * Нарочная поломка: верни onFail={() => markFailed.mutate({ orderId })} —
 * падает 1; убери setProofFor в onSuccess у markDelivered — падает 4; убери
 * ...freshPlace() из markDelivered — падает 5; верни useQuery(undefined) или
 * фильтр «Ожидают» по всему списку — падает 6.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { bizToday } from "@/lib/business-time";
import { addDays } from "@/components/delivery/plan-days";
import { rememberFix, forgetFix, FIX_MAX_AGE_MS } from "@/lib/last-fix";

const calls = vi.hoisted(() => ({
  markFailed: [] as unknown[], reschedule: [] as unknown[], markDelivered: [] as unknown[], saveProof: [] as unknown[],
  markOutForDelivery: [] as unknown[], listInput: [] as unknown[],
}));
/** Что отдаёт список и кто смотрит — тест 6 подменяет. */
const state = vi.hoisted(() => ({ rows: null as unknown[] | null, role: "courier" }));

vi.mock("@/providers/trpc", () => {
  const mutation = (name: keyof typeof calls, result: unknown = { success: true }) =>
    (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({
      mutate: (v: unknown) => { calls[name].push(v); opts?.onSuccess?.(result, v); },
      mutateAsync: async (v: unknown) => { calls[name].push(v); return result; },
      isPending: false,
      variables: undefined,
    });
  const delivery = (id: number, deliveryStatus: string) => ({ id, orderNumber: `ORD-${id}`, shopName: "Магазин «Ромашка»", shopAddress: null, shopCity: null, total: "1000", deliveryStatus, shopGpsLat: null, shopGpsLng: null });
  return {
    trpc: {
      courier: {
        listMyDeliveries: { useQuery: (input: unknown) => {
          calls.listInput.push(input);
          return { data: state.rows ?? [delivery(1, "assigned"), delivery(3, "out_for_delivery")], isLoading: false, isLoadingError: false, refetch: () => {} };
        } },
        markOutForDelivery: { useMutation: mutation("markOutForDelivery") },
        markDelivered: { useMutation: mutation("markDelivered") },
        markFailed: { useMutation: mutation("markFailed") },
        reschedule: { useMutation: mutation("reschedule") },
        saveProof: { useMutation: mutation("saveProof", { success: true, photoCount: 0, hasSignature: false, recipientName: "Дилшод" }) },
      },
      kpi: { courierKpi: { useQuery: () => ({ data: undefined }) } },
    },
  };
});
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 5, role: state.role, name: "Курьер" } }) }));
// Офису страница рисует доску развоза — здесь она не нужна.
vi.mock("@/components/delivery/DispatchBoard", () => ({ DispatchBoard: () => null }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { default: CourierDeliveries } = await import("@/pages/CourierDeliveries");

beforeEach(() => {
  for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = [];
  state.rows = null;
  state.role = "courier";
  forgetFix();
});
afterEach(cleanup);

const confirmFail = () => screen.getByTestId("fail-reason-confirm") as HTMLButtonElement;

describe("курьер: срыв, перенос, подтверждение", () => {
  it("1. «Не доставлено» — сперва причина; «Другое» — только со словами", () => {
    render(<CourierDeliveries />);
    fireEvent.click(screen.getByTestId("courier-fail"));
    expect(screen.getByTestId("fail-reason-dialog")).toBeTruthy();
    expect(calls.markFailed, "срыв без причины одним нажатием").toHaveLength(0);
    expect(confirmFail().disabled).toBe(true);

    fireEvent.click(screen.getByTestId("fail-reason-other"));
    expect(confirmFail().disabled, "«Другое» без слов").toBe(true);
    expect(screen.getByTestId("fail-reason-hint").textContent).toContain("Другое");

    fireEvent.change(screen.getByTestId("delivery-note"), { target: { value: "  шлагбаум закрыт  " } });
    expect(confirmFail().disabled).toBe(false);
    fireEvent.click(confirmFail());
    expect(calls.markFailed).toHaveLength(1);
    const sent = calls.markFailed[0] as { orderId: number; reasonCode: string; note: string; idempotencyKey: string };
    expect(sent).toMatchObject({ orderId: 3, reasonCode: "other", note: "шлагбаум закрыт" });
    expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByTestId("fail-reason-dialog"), "окно закрылось после ответа").toBeNull();
  });

  it("2. «Просили в другой день» — перенос на завтра вместо срыва", () => {
    render(<CourierDeliveries />);
    fireEvent.click(screen.getByTestId("courier-fail"));
    fireEvent.click(screen.getByTestId("fail-reason-asked_reschedule"));
    fireEvent.click(screen.getByTestId("fail-to-reschedule"));
    expect(screen.queryByTestId("fail-reason-dialog")).toBeNull();
    expect(screen.getByTestId("reschedule-dialog")).toBeTruthy();

    fireEvent.click(screen.getByTestId("reschedule-confirm"));
    expect(calls.markFailed, "перенос — не срыв").toHaveLength(0);
    expect(calls.reschedule).toHaveLength(1);
    expect(calls.reschedule[0]).toMatchObject({ orderId: 3, date: addDays(bizToday(), 1), reasonCode: "asked_reschedule" });
  });

  it("3. курьер переносит с завтра: «Сегодня» ему не предлагается, дальше двух недель — тоже", () => {
    render(<CourierDeliveries />);
    // Перенос прямо из «Ожидают» — до выезда.
    fireEvent.click(screen.getAllByTestId("courier-reschedule")[0]);
    const today = bizToday();
    expect(screen.queryByTestId(`reschedule-day-${today}`)).toBeNull();
    expect(screen.getByTestId(`reschedule-day-${addDays(today, 1)}`).textContent).toBe("Завтра");
    const input = screen.getByTestId("reschedule-date") as HTMLInputElement;
    expect(input.min).toBe(addDays(today, 1));
    expect(input.max).toBe(addDays(today, 14));
    fireEvent.change(input, { target: { value: addDays(today, 15) } });
    expect((screen.getByTestId("reschedule-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("4. после «Доставлено» — подтверждение; пустое не сохраняется, имя — уходит", async () => {
    render(<CourierDeliveries />);
    fireEvent.click(screen.getByText("Доставлено"));
    expect(calls.markDelivered).toHaveLength(1);
    expect(screen.getByTestId("proof-sheet").textContent).toContain("ORD-3");
    const save = screen.getByTestId("proof-save") as HTMLButtonElement;
    expect(save.disabled, "нечего сохранять").toBe(true);
    const camera = screen.getByTestId("proof-photo-input") as HTMLInputElement;
    expect(camera.accept).toBe("image/*");
    expect(camera.getAttribute("capture")).toBe("environment");

    fireEvent.change(screen.getByTestId("proof-recipient"), { target: { value: "Дилшод" } });
    await act(async () => { fireEvent.click(screen.getByTestId("proof-save")); });
    expect(calls.saveProof).toEqual([{ orderId: 3, recipientName: "Дилшод" }]);
    expect(screen.queryByTestId("proof-sheet")).toBeNull();
  });

  it("5. свежая точка — в каждой отметке; старше пяти минут — без координат", async () => {
    const now = Date.now();
    rememberFix({ coords: { latitude: 41.311081, longitude: 69.279737 }, timestamp: now - 60_000 });
    const place = { lat: "41.31108100", lng: "69.27973700" };
    render(<CourierDeliveries />);

    fireEvent.click(screen.getByText("Доставлено"));
    expect(calls.markDelivered[0]).toMatchObject({ orderId: 3, ...place });
    fireEvent.change(screen.getByTestId("proof-recipient"), { target: { value: "Дилшод" } });
    await act(async () => { fireEvent.click(screen.getByTestId("proof-save")); });
    expect(calls.saveProof[0]).toMatchObject({ orderId: 3, ...place });

    fireEvent.click(screen.getByTestId("courier-fail"));
    fireEvent.click(screen.getByTestId("fail-reason-shop_closed"));
    fireEvent.click(confirmFail());
    expect(calls.markFailed[0]).toMatchObject({ orderId: 3, reasonCode: "shop_closed", ...place });

    fireEvent.click(screen.getAllByTestId("courier-reschedule")[0]);
    fireEvent.click(screen.getByTestId("reschedule-confirm"));
    expect(calls.reschedule[0]).toMatchObject({ orderId: 3, ...place });

    cleanup();
    rememberFix({ coords: { latitude: 41.3, longitude: 69.2 }, timestamp: now - FIX_MAX_AGE_MS - 1000 });
    render(<CourierDeliveries />);
    fireEvent.click(screen.getByText("Доставлено"));
    expect(calls.markDelivered[1], "старая точка показала бы отметку не там").not.toHaveProperty("lat");
    expect(calls.markDelivered[1]).not.toHaveProperty("lng");
  });

  it("6. перенесённые — свёрнуто и отдельно; на карточке — №, день, «Ждёт офиса»", () => {
    const later = addDays(bizToday(), 2);
    const row = (id: number, extra: Record<string, unknown>) => ({
      id, orderNumber: `ORD-${id}`, shopName: `Магазин ${id}`, shopAddress: null, shopCity: null, total: "1000",
      status: "shipped", deliveryStatus: "assigned", shopGpsLat: null, shopGpsLng: null,
      plannedDeliveryDate: null, routeSeq: null, courierName: null, ...extra,
    });
    state.rows = [
      row(1, { routeSeq: 2 }),
      row(2, { routeSeq: 1, status: "pending" }),
      row(4, { plannedDeliveryDate: later }),
    ];
    render(<CourierDeliveries />);
    expect(calls.listInput[0], "курьер просит и перенесённые").toEqual({ includeLater: true });

    // «Выехал по всем» — по двум сегодняшним, без перенесённого.
    expect(screen.getByTestId("courier-take-all").textContent).toContain("(2)");
    fireEvent.click(screen.getByTestId("courier-take-all"));
    expect(calls.markOutForDelivery).toEqual([{ orderId: 1 }, { orderId: 2 }]);

    expect(screen.getAllByTestId("delivery-route-seq").map(e => e.textContent)).toEqual(["№2", "№1"]);
    expect(screen.getAllByTestId("delivery-held")).toHaveLength(1);
    expect(screen.queryByTestId("delivery-courier"), "курьеру своё имя не нужно").toBeNull();

    // Свёрнуто: перенесённого не видно, пока не раскрыли.
    expect(screen.getByTestId("deliveries-later-toggle").textContent).toContain("Перенесено (1)");
    expect(screen.queryByTestId("deliveries-later-card")).toBeNull();
    expect(screen.queryByText("ORD-4")).toBeNull();
    fireEvent.click(screen.getByTestId("deliveries-later-toggle"));
    const card = screen.getByTestId("deliveries-later-card");
    expect(card.textContent).toContain("ORD-4");
    expect(card.querySelector("[data-testid=delivery-planned]")?.textContent).toBe(`на ${later.slice(8, 10)}.${later.slice(5, 7)}`);

    // Офису — чей заказ; список он берёт без includeLater.
    cleanup();
    calls.listInput = [];
    state.role = "director";
    state.rows = [row(1, { courierName: "Азиз" })];
    render(<CourierDeliveries />);
    expect(calls.listInput[0]).toBeUndefined();
    expect(screen.getByTestId("delivery-courier").textContent).toBe("Азиз");
  });
});

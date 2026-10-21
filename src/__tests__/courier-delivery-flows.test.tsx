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
 *
 * Нарочная поломка: верни onFail={() => markFailed.mutate({ orderId })} —
 * падает 1; убери setProofFor в onSuccess у markDelivered — падает 4.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { bizToday } from "@/lib/business-time";
import { addDays } from "@/components/delivery/plan-days";

const calls = vi.hoisted(() => ({
  markFailed: [] as unknown[], reschedule: [] as unknown[], markDelivered: [] as unknown[], saveProof: [] as unknown[],
}));

vi.mock("@/providers/trpc", () => {
  const mutation = (name: keyof typeof calls, result: unknown = { success: true }) =>
    (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({
      mutate: (v: unknown) => { calls[name].push(v); opts?.onSuccess?.(result, v); },
      mutateAsync: async (v: unknown) => { calls[name].push(v); return result; },
      isPending: false,
      variables: undefined,
    });
  const noop = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
  const delivery = (id: number, deliveryStatus: string) => ({ id, orderNumber: `ORD-${id}`, shopName: "Магазин «Ромашка»", shopAddress: null, shopCity: null, total: "1000", deliveryStatus, shopGpsLat: null, shopGpsLng: null });
  return {
    trpc: {
      courier: {
        listMyDeliveries: { useQuery: () => ({ data: [delivery(1, "assigned"), delivery(3, "out_for_delivery")], isLoading: false, isLoadingError: false, refetch: () => {} }) },
        markOutForDelivery: { useMutation: noop },
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
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 5, role: "courier", name: "Курьер" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { default: CourierDeliveries } = await import("@/pages/CourierDeliveries");

beforeEach(() => { for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = []; });
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
});

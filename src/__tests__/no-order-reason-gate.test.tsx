// @vitest-environment jsdom
/**
 * Визит без заказа не закрывается без причины — на экранах агента.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * «Готово» у визита ставило «посещён» сразу, и директор не знал, почему
 * заказа нет. Ручка причину теперь принимает (необязательно — старая мобилка
 * её не шлёт), а экран агента без неё визит без заказа не закрывает.
 *
 * ── Что проверяется (PhonePlan — PWA, DesktopAgentPlans — большой экран) ────
 *
 *  1. Визит без заказа: «Готово» открывает выбор причины, ручка не зовётся;
 *     «Закрыть визит» заперта, пока причина не выбрана; после выбора — одна
 *     отметка с причиной.
 *  2. «Другое» требует текст: без него кнопка заперта и есть подсказка; с
 *     текстом уходит обрезанный текст.
 *  3. Был заказ (hasOrder) — причину не спрашивают, отметка сразу.
 *  4. Снимок у визита без заказа: сначала причина, потом камера; снимок
 *     уходит вместе с причиной.
 *  5. «Оформить заказ» из окна ведёт в новый заказ этого магазина.
 *  6. Большой экран — тот же вопрос на «Отметить».
 *  7. Закрытый без заказа визит показывает, с какой причиной.
 *
 * Нарочная поломка: в components/visits/useNoOrderGate.tsx заменить
 * `if (plan.hasOrder) { proceed(); return; }` на `proceed(); return;` —
 * падают 1, 2, 4, 6; убрать `problem === null` из `ready` в NoOrderReason.tsx —
 * падает 2.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  role: "agent",
  plans: [] as Array<Record<string, unknown>>,
  updates: [] as unknown[],
  photoCalls: [] as unknown[],
  navigated: [] as string[],
  phone: true,
}));

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({ agent: { getPlans: { invalidate: nothing } }, salesTarget: { myQuota: { invalidate: nothing } } }),
      agent: {
        getPlans: { useQuery: () => ({ data: state.plans, isLoading: false, isError: false, refetch: nothing }) },
        updatePlanStatus: { useMutation: () => ({ mutate: (v: unknown) => state.updates.push(v), isPending: false, variables: undefined }) },
        saveVisitPhoto: { useMutation: () => ({ mutate: (v: unknown) => state.photoCalls.push(v), isPending: false }) },
      },
      salesTarget: { myQuota: { useQuery: () => ({ data: undefined, isLoading: false }) } },
      kpi: {
        agentKpi: { useQuery: () => ({ data: undefined, isLoading: false }) },
        salary: { useQuery: () => ({ data: undefined }) },
      },
    },
  };
});
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: state.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.phone }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/compress-image", () => ({ compressImage: vi.fn(async () => "data:image/jpeg;base64,SNAP") }));

const { PhonePlan } = await import("@/components/phone/PhonePlan");
const AgentPlans = (await import("@/pages/AgentPlans")).default;

const plan = (over: Record<string, unknown> = {}) => ({
  id: 7, shopId: 3, status: "planned", shopName: "Хумо", shopAddress: "Юнусабад, 4",
  shopDebt: "0.00", notes: null, planDate: new Date(), hasOrder: false, noOrderReason: null, noOrderNote: null, ...over,
});
const dialog = () => screen.getByTestId("no-order-dialog");
const confirmBtn = () => screen.getByTestId("no-order-confirm") as HTMLButtonElement;

beforeEach(() => {
  state.role = "agent";
  state.plans = [plan()];
  state.updates = [];
  state.photoCalls = [];
  state.navigated = [];
  state.phone = true;
});
afterEach(cleanup);

describe("PWA: визит без заказа — только с причиной", () => {
  it("1. «Готово» спрашивает причину; без неё не закрыть; с ней — одна отметка", () => {
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(dialog()).toBeTruthy();
    expect(state.updates, "визит закрылся, не спросив причину").toEqual([]);
    expect(confirmBtn().disabled).toBe(true);
    expect(screen.getByTestId("no-order-hint").textContent).toMatch(/Выберите причину/);
    fireEvent.click(confirmBtn());
    expect(state.updates).toEqual([]);

    fireEvent.click(within(dialog()).getByRole("radio", { name: "Нет денег" }));
    expect(confirmBtn().disabled).toBe(false);
    fireEvent.click(confirmBtn());
    expect(state.updates).toEqual([{ planId: 7, status: "visited", noOrderReason: "no_money" }]);
    expect(screen.queryByTestId("no-order-dialog")).toBeNull();
  });

  it("2. «Другое» требует текст; уходит обрезанным", () => {
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Другое" }));
    expect(confirmBtn().disabled, "«Другое» без текста закрывает визит").toBe(true);
    expect(screen.getByTestId("no-order-hint").textContent).toMatch(/напишите коротко/);
    fireEvent.change(screen.getByTestId("no-order-note"), { target: { value: "   " } });
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("no-order-note"), { target: { value: "  ремонт фасада " } });
    expect(confirmBtn().disabled).toBe(false);
    fireEvent.click(confirmBtn());
    expect(state.updates).toEqual([{ planId: 7, status: "visited", noOrderReason: "other", noOrderNote: "ремонт фасада" }]);
  });

  it("3. был заказ — причину не спрашивают", () => {
    state.plans = [plan({ hasOrder: true })];
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(screen.queryByTestId("no-order-dialog")).toBeNull();
    expect(state.updates).toEqual([{ planId: 7, status: "visited" }]);
  });

  it("4. снимок без заказа: причина, потом камера; снимок уходит с причиной", async () => {
    render(<PhonePlan />);
    const input = screen.getByTestId("visit-photo-input") as HTMLInputElement;
    const clicked = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Отметить с фото" }));
    expect(clicked, "камера открылась раньше причины").not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Есть остаток" }));
    fireEvent.click(confirmBtn());
    expect(clicked).toHaveBeenCalledTimes(1);
    Object.defineProperty(input, "files", { value: [new File(["x"], "shop.jpg", { type: "image/jpeg" })], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(state.photoCalls).toEqual([{ planId: 7, photoUrl: "data:image/jpeg;base64,SNAP", noOrderReason: "has_stock" }]));
    expect(state.updates).toEqual([]);
  });

  it("5. «Оформить заказ» из окна — в новый заказ этого магазина, визит не закрыт", () => {
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Оформить заказ" }));
    expect(state.navigated).toEqual(["/orders/new?shopId=3"]);
    expect(state.updates).toEqual([]);
  });

  it("7. закрытый без заказа визит показывает причину", () => {
    state.plans = [plan({ status: "visited", noOrderReason: "other", noOrderNote: "ремонт" })];
    render(<PhonePlan />);
    expect(screen.getByTestId("phone-plan-no-order").textContent).toBe("Без заказа: Другое: ремонт");
  });
});

describe("большой экран: тот же вопрос на «Отметить»", () => {
  it("6. «Отметить» у визита без заказа спрашивает причину", () => {
    state.phone = false;
    render(<AgentPlans />);
    fireEvent.click(screen.getByRole("button", { name: "Отметить" }));
    expect(state.updates).toEqual([]);
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Берёт у конкурента" }));
    fireEvent.click(confirmBtn());
    expect(state.updates).toEqual([{ planId: 7, status: "visited", noOrderReason: "competitor" }]);
  });
});

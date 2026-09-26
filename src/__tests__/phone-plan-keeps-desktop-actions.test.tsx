// @vitest-environment jsdom
/**
 * «План» на телефоне умеет то же, что страница большого экрана.
 *
 * На телефоне (<768px) /agent/plans рисует PhonePlan — экран мобилки v8. При
 * переносе он потерял четыре вещи, которые большой экран держал:
 *
 *   · отметку визита со снимком (agent.saveVisitPhoto с проверкой на подлог);
 *   · заметку супервайзера к визиту (plan.notes);
 *   · «Заказ» прямо из визита;
 *   · переход по дням — запрос был прибит к сегодня.
 *
 * Агент в поле работает с телефона, то есть на телефоне всего этого не было
 * ни у кого. Здесь экран поднимается с поддельными ручками и проверяется то,
 * что видит и нажимает человек.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · убрать кнопку снимка из карточки визита — «снимок»;
 *   · убрать строку с p.notes — «заметка»;
 *   · убрать кнопку «Заказ» — «заказ из визита»;
 *   · вернуть запрос к { date: сегодня } — «переход по дням».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { format, addDays, subDays } from "date-fns";

const state = vi.hoisted(() => ({
  role: "agent",
  plans: [] as Array<Record<string, unknown>>,
  dates: [] as string[],
  photoCalls: [] as unknown[],
  navigated: [] as string[],
}));

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({ agent: { getPlans: { invalidate: nothing } }, salesTarget: { myQuota: { invalidate: nothing } } }),
      agent: {
        getPlans: {
          useQuery: (input: { date: string }) => {
            state.dates.push(input.date);
            return { data: state.plans, isLoading: false, isError: false, refetch: nothing };
          },
        },
        updatePlanStatus: { useMutation: () => ({ mutate: nothing, isPending: false, variables: undefined }) },
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
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: state.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/compress-image", () => ({ compressImage: vi.fn(async () => "data:image/jpeg;base64,SNAP") }));

const { PhonePlan } = await import("@/components/phone/PhonePlan");

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

beforeEach(() => {
  state.role = "agent";
  state.dates = [];
  state.photoCalls = [];
  state.navigated = [];
  state.plans = [{
    id: 7, shopId: 3, status: "planned", shopName: "Хумо", shopAddress: "Юнусабад, 4",
    shopDebt: "0.00", notes: "Спросить про возврат", planDate: new Date(),
  }];
});
afterEach(cleanup);

describe("PhonePlan: вернулось то, что было у большого экрана", () => {
  it("снимок: камера у визита → выбор файла → saveVisitPhoto именно этого плана", async () => {
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Отметить с фото" }));

    const input = screen.getByTestId("visit-photo-input") as HTMLInputElement;
    expect(input.getAttribute("capture"), "камера телефона не открывается сразу").toBe("environment");
    Object.defineProperty(input, "files", { value: [new File(["x"], "shop.jpg", { type: "image/jpeg" })], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(state.photoCalls).toEqual([{ planId: 7, photoUrl: "data:image/jpeg;base64,SNAP" }]));
  });

  it("заметка супервайзера к визиту видна агенту", () => {
    render(<PhonePlan />);
    expect(screen.getByTestId("phone-plan-note").textContent).toBe("«Спросить про возврат»");
  });

  it("заказ из визита ведёт в новый заказ этого магазина", () => {
    render(<PhonePlan />);
    fireEvent.click(screen.getByRole("button", { name: "Заказ" }));
    expect(state.navigated).toEqual(["/orders/new?shopId=3"]);
  });

  it("переход по дням: вчера, завтра и обратно к сегодня", () => {
    const today = new Date();
    render(<PhonePlan />);
    expect(state.dates.at(-1)).toBe(ymd(today));

    fireEvent.click(screen.getByRole("button", { name: "Предыдущий день" }));
    expect(state.dates.at(-1), "план вчерашнего дня не открыть").toBe(ymd(subDays(today, 1)));
    expect(screen.getByText("Визиты дня")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Следующий день" }));
    fireEvent.click(screen.getByRole("button", { name: "Следующий день" }));
    expect(state.dates.at(-1)).toBe(ymd(addDays(today, 1)));

    // Середина строки дня возвращает к сегодня.
    fireEvent.click(within(screen.getByTestId("phone-plan-day")).getAllByRole("button")[1]);
    expect(state.dates.at(-1)).toBe(ymd(today));
    expect(screen.getByText("Визиты на сегодня")).toBeTruthy();
  });

  it("мерчендайзер: ни снимка, ни заказа — «Готово» ведёт на отчёт о визите", () => {
    state.role = "merchandiser";
    render(<PhonePlan />);
    expect(screen.queryByRole("button", { name: "Отметить с фото" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Заказ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(state.navigated[0]).toMatch(/^\/agent\/visit\/7\?shopId=3&/);
  });
});

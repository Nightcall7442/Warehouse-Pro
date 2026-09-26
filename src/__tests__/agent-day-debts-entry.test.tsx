// @vitest-environment jsdom
/**
 * «Мой день» агента: вход в «Мои долги» есть всегда, и число на нём — то же,
 * что в списке за ним.
 *
 * Карточка долгов показывалась только при kpis.shopsDebt > 0, а shopsDebt —
 * долг магазинов, ЗАКРЕПЛЁННЫХ за агентом: закрепления у большинства
 * арендаторов нет, значит почти всегда ноль, и карточки не было. Страница
 * /agent/debts при этом считает по заказам агента (orders.agent_id). На
 * планшете и ноутбуке другого входа в «Мои долги» нет — ни в меню агента, ни
 * в профиле (он с этим пунктом только на телефоне), — и «Принять оплату»
 * оставалась недоступной.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · вернуть условие `debt > 0 &&` вокруг карточки — «есть и при нуле»;
 *   · вернуть число из kpis.shopsDebt — «число по заказам агента»;
 *   · рисовать `fmt(debt ?? 0)` без оглядки на ответ — «сбой связи».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const state = vi.hoisted(() => ({
  shopsDebt: "0.00",
  debts: { data: [] as Array<{ remaining: string }> | undefined, isError: false },
  navigated: [] as string[],
  role: "agent",
  debtsEnabled: [] as Array<boolean | undefined>,
}));

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({ agent: { getPlans: { invalidate: nothing } } }),
      dashboard: {
        agentDashboard: { useQuery: () => ({ data: { shopsDebt: state.shopsDebt, todayRevenue: 0, todayOrders: 0 }, isError: false, isLoading: false }) },
        revenueTrend: { useQuery: () => ({ data: [] }) },
      },
      agent: {
        getPlans: { useQuery: () => ({ data: [], isLoading: false, isLoadingError: false, refetch: nothing }) },
        updatePlanStatus: { useMutation: () => ({ mutate: nothing, isPending: false }) },
        myDebts: { useQuery: (_i: unknown, o?: { enabled?: boolean }) => { state.debtsEnabled.push(o?.enabled); return o?.enabled === false ? { data: undefined, isError: false } : state.debts; } },
      },
      order: { myOrders: { useQuery: () => ({ data: { data: [] }, isLoading: false, isError: false }) } },
    },
  };
});
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: state.role, name: "Агент" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));

const { default: AgentDashboard } = await import("@/pages/AgentDashboard");

beforeEach(() => {
  state.shopsDebt = "0.00";
  state.debts = { data: [], isError: false };
  state.navigated = [];
  state.role = "agent";
  state.debtsEnabled = [];
});
afterEach(cleanup);

describe("«Мой день»: вход в «Мои долги»", () => {
  it("есть и при нуле — и ведёт на /agent/debts", () => {
    render(<AgentDashboard />);
    const entry = screen.getByTestId("agent-debts-entry");
    expect(entry.textContent).toContain("Долгов нет");
    fireEvent.click(entry);
    expect(state.navigated).toEqual(["/agent/debts"]);
  });

  it("число — по заказам агента (как в списке), а не по закреплённым магазинам", () => {
    state.shopsDebt = "0.00";
    state.debts = { data: [{ remaining: "150000.00" }, { remaining: "50000.00" }], isError: false };
    render(<AgentDashboard />);
    expect(screen.getByTestId("agent-debts-entry").textContent).toContain("200000 сум");
    cleanup();

    // Обратный случай: у закреплённых магазинов долг есть, по заказам агента — нет.
    state.shopsDebt = "999000.00";
    state.debts = { data: [], isError: false };
    render(<AgentDashboard />);
    const text = screen.getByTestId("agent-debts-entry").textContent ?? "";
    expect(text).toContain("Долгов нет");
    expect(text, "на входе число другого основания, чем в списке").not.toContain("999000");
  });

  it("сбой связи не рисуется нулём", () => {
    state.debts = { data: undefined, isError: true };
    render(<AgentDashboard />);
    const text = screen.getByTestId("agent-debts-entry").textContent ?? "";
    expect(text).toContain("Кому идти собирать деньги");
    expect(text).not.toContain("сум");
    expect(text).not.toContain("Долгов нет");
    // И не красным: красный говорит «есть долги», а этого мы не знаем.
    expect(screen.getByTestId("agent-debts-entry").innerHTML, "сбой нарисован как долг").not.toContain("danger");
  });

  it("мерчендайзер денег не собирает — ни карточки, ни запроса долгов", () => {
    state.role = "merchandiser";
    state.debts = { data: [{ remaining: "150000.00" }], isError: false };
    render(<AgentDashboard />);
    expect(screen.queryByTestId("agent-debts-entry")).toBeNull();
    expect(state.debtsEnabled.length).toBeGreaterThan(0);
    expect(state.debtsEnabled.every(e => e === false), "долги мерчендайзера всё равно запрошены").toBe(true);
  });
});

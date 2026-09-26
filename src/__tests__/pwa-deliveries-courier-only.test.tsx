// @vitest-environment jsdom
/**
 * /deliveries у директора и оператора — без курьерских «Итогов месяца» и без
 * «Выехал по всем».
 *
 * Роут пускает ceo и operator, и им сервер отдаёт все доставки организации.
 * Итоги месяца звали kpi.courierKpi без courierId — сервер подставлял самого
 * смотрящего, и директор видел под чужими доставками «Довезено 0, Сорвано 0»
 * как итоги курьеров. «Выехал по всем» слал N вызовов markOutForDelivery, и
 * каждый падал: сервер пускает только назначенного курьера.
 *
 * Нарочная поломка: убери `isCourier &&` у MonthTotals или у кнопки
 * courier-take-all в CourierDeliveries.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const state = vi.hoisted(() => ({ role: "courier", kpiCalls: 0 }));

vi.mock("@/providers/trpc", () => {
  const mutation = () => ({ mutate: () => {}, isPending: false, variables: undefined });
  const delivery = (id: number, deliveryStatus = "assigned") => ({ id, orderNumber: `ORD-${id}`, shopName: "Магазин", shopAddress: null, shopCity: null, total: "1000", deliveryStatus, shopGpsLat: null, shopGpsLng: null });
  return {
    trpc: {
      courier: {
        listMyDeliveries: { useQuery: () => ({ data: [delivery(1), delivery(2), delivery(3, "out_for_delivery")], isLoading: false, isLoadingError: false, refetch: () => {} }) },
        markOutForDelivery: { useMutation: mutation },
        markDelivered: { useMutation: mutation },
        markFailed: { useMutation: mutation },
      },
      kpi: { courierKpi: { useQuery: () => { state.kpiCalls++; return { data: { delivered: 0, failed: 0, successRate: 0, workDays: 0 } }; } } },
    },
  };
});
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 5, role: state.role, name: "Смотрящий" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { default: CourierDeliveries } = await import("@/pages/CourierDeliveries");

beforeEach(() => { state.role = "courier"; state.kpiCalls = 0; });
afterEach(cleanup);

describe("/deliveries: курьерское — только курьеру", () => {
  it("курьер видит итоги месяца и «Выехал по всем»", () => {
    render(<CourierDeliveries />);
    expect(screen.getByTestId("courier-month-totals")).toBeTruthy();
    expect(screen.getByTestId("courier-take-all").textContent).toContain("Выехал по всем (2)");
    expect(screen.getAllByText("Взять в доставку")).toHaveLength(2);
    expect(screen.getByText("Доставлено")).toBeTruthy();
    expect(screen.getByText("Не доставлено")).toBeTruthy();
  });

  for (const role of ["ceo", "operator"]) {
    it(`${role}: ни своих нулей под видом итогов, ни кнопки, которую сервер отклонит`, () => {
      state.role = role;
      render(<CourierDeliveries />);
      // Список доставок при этом на месте — прячется только курьерское:
      // сервер отметит доставку лишь от назначенного курьера.
      expect(screen.getAllByText("ORD-1")).toHaveLength(1);
      expect(screen.getByText("ORD-3")).toBeTruthy();
      expect(screen.queryByText("Взять в доставку"), "кнопка, которую сервер отклонит").toBeNull();
      expect(screen.queryByText("Доставлено")).toBeNull();
      expect(screen.queryByText("Не доставлено")).toBeNull();
      expect(screen.queryByTestId("courier-month-totals")).toBeNull();
      expect(state.kpiCalls, "courierKpi спрошен за директора").toBe(0);
      expect(screen.queryByTestId("courier-take-all")).toBeNull();
    });
  }
});

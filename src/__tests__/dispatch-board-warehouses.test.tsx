// @vitest-environment jsdom
/**
 * Доска развоза и склады заказов (ADR 0012).
 *
 * Погрузочный лист собирают с одного склада, а курьеру заказы назначают и
 * по одному — в машине могут оказаться заказы основного склада и филиала.
 * Доска говорит об этом: у курьера — «грузиться в нескольких местах», у
 * остановок — имя склада. Пока склад один, склад не называется вовсе:
 * организации без точек продаж доска не меняется.
 *
 * Нарочная поломка: в DispatchBoard считай multiWarehouse всегда false —
 * остановки филиала потеряют имя склада, тест упадёт.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  board: null as unknown,
}));

vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/yandex-maps", () => ({ loadYandexMaps: () => new Promise(() => {}) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    courier: {
      board: { useQuery: () => ({ data: state.board, isLoading: false, error: null, refetch: async () => {} }) },
      dayTrack: { useQuery: () => ({ data: { points: [], events: [] } }) },
      setRouteOrder: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      officeReschedule: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      courier: { board: { invalidate: async () => {} }, suggestRoute: { fetch: async () => ({}) } },
    }),
  },
}));

const { DispatchBoard } = await import("@/components/delivery/DispatchBoard");

const courier = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Курьер ${id}`, phone: null, lastPing: null, open: 2, held: 0, delivered: 0, failed: 0, rescheduled: 0, warehouses: 1, ...over,
});
const stop = (orderId: number, courierId: number, warehouseId: number, warehouseName: string) => ({
  orderId, orderNumber: `№${orderId}`, courierId, status: "processing", deliveryStatus: "assigned", routeSeq: null,
  plannedDeliveryDate: null, total: "1000.00", shopName: `Магазин ${orderId}`, shopAddress: null, lat: null, lng: null,
  warehouseId, warehouseName,
});

describe("доска развоза: склады заказов в машине", () => {
  beforeEach(() => cleanup());

  it("заказы двух складов у курьера — предупреждение в его строке и склад у каждой остановки", () => {
    state.board = {
      day: "2026-10-21",
      couriers: [courier(7, { warehouses: 2 })],
      stops: [stop(1, 7, 10, "Основной"), stop(2, 7, 11, "Филиал")],
    };
    render(<DispatchBoard />);
    expect(screen.getByTestId("dispatch-courier-warehouses-7").textContent).toContain("Заказы с 2 складов");
    const rows = screen.getAllByTestId("dispatch-stop");
    expect(rows.map(r => within(r).getByTestId("dispatch-stop-warehouse").textContent)).toEqual(["Склад: Основной", "Склад: Филиал"]);
  });

  it("один склад — ни предупреждения, ни имени склада у остановок", () => {
    state.board = {
      day: "2026-10-21",
      couriers: [courier(7)],
      stops: [stop(1, 7, 10, "Основной"), stop(2, 7, 10, "Основной")],
    };
    render(<DispatchBoard />);
    expect(screen.queryByTestId("dispatch-courier-warehouses-7")).toBeNull();
    expect(screen.getAllByTestId("dispatch-stop")).toHaveLength(2);
    expect(screen.queryByTestId("dispatch-stop-warehouse")).toBeNull();
  });
});

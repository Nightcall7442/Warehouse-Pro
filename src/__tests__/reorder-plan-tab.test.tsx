// @vitest-environment jsdom
/**
 * «Дозаказ» на складе: группы по поставщику и черновики заказов одной кнопкой.
 *
 *   · группа — будущий заказ; «без поставщика» — последней, поставщика ей
 *     выбирают здесь же, не выбран — её строки в заказ не идут;
 *   · отмечено то, что нужно заказать; уже едущее (заказать 0) — нет;
 *   · количество правится, уходит до сотых;
 *   · один заказ — открывается он, несколько — список заказов поставщикам;
 *   · без права вести поставщиков — ни кнопки, ни полей.
 *
 * Нарочная поломка: в ReorderPlan отметь по умолчанию все строки
 * (pickedOf → true) — тест «уже едущее не отмечено» упадёт.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { groupBySupplier, orderQuantity } from "@/lib/reorder-groups";

Element.prototype.scrollIntoView = () => {};

const state = vi.hoisted(() => ({
  canManage: true,
  created: [] as unknown[],
  result: { orders: [{ id: 31, number: "PO-31", supplierId: 5, supplierName: "Завод", lines: 2 }, { id: 32, number: "PO-32", supplierId: 6, supplierName: "Мельница", lines: 1 }] },
  invalidated: [] as string[],
}));

vi.mock("@/hooks/useCan", () => ({ useCan: () => (perm: string) => (perm === "suppliers.manage" ? state.canManage : true) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    supplier: { list: { useQuery: () => ({ data: [{ id: 5, name: "Завод" }, { id: 7, name: "Новый завод" }] }) } },
    purchaseOrder: {
      createFromSuggestions: {
        useMutation: (opts: { onSuccess: (r: unknown) => void }) => ({
          mutate: (input: unknown) => { state.created.push(input); opts.onSuccess(state.result); },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      purchaseOrder: { list: { invalidate: async () => { state.invalidated.push("purchaseOrder.list"); } } },
      warehouse: { reorderSuggestions: { invalidate: async () => { state.invalidated.push("warehouse.reorderSuggestions"); } } },
    }),
  },
}));

const { ReorderPlan } = await import("@/components/warehouse/ReorderPlan");

type Row = Parameters<typeof ReorderPlan>[0]["rows"][number];
const row = (productId: number, over: Partial<Row>): Row => ({
  productId, productName: `Товар ${productId}`, productCode: `P-${productId}`, unit: "pcs", packSize: null,
  currentStock: "6.000", available: "6.000", reorderPoint: "20.00", reorderMax: null,
  unitPrice: "100.00", costPrice: "75.00", avgDailySales: "1.0", daysUntilStockout: 6,
  target: 40, inbound: 0, suggestedQty: 34, suggestedCost: 2550,
  supplierId: 5, supplierName: "Завод", supplierSource: "default", warehouseId: 1,
  ...over,
} as Row);

const ROWS: Row[] = [
  row(1, {}),
  row(2, { supplierId: null, supplierName: null, supplierSource: null, suggestedQty: 3 }),
  row(3, { supplierId: 6, supplierName: "Мельница", supplierSource: "last", unit: "kg", suggestedQty: 8.75 }),
  // Уже едет столько, что заказывать нечего.
  row(4, { inbound: 40, suggestedQty: 0 }),
];

function Where() { return <div data-testid="where">{useLocation().pathname + useLocation().search}</div>; }

function open(rows = ROWS) {
  return render(
    <MemoryRouter initialEntries={["/warehouse?tab=reorder"]}>
      <Routes>
        <Route path="/warehouse" element={<ReorderPlan rows={rows} warehouseId={2} lang="ru" />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.canManage = true;
  state.created = [];
  state.invalidated = [];
  state.result = { orders: [{ id: 31, number: "PO-31", supplierId: 5, supplierName: "Завод", lines: 2 }, { id: 32, number: "PO-32", supplierId: 6, supplierName: "Мельница", lines: 1 }] };
});

describe("группы по поставщику", () => {
  it("поставщики по имени, «без поставщика» — последней; внутри — порядок сервера", () => {
    const groups = groupBySupplier(ROWS);
    expect(groups.map(g => [g.key, g.supplierName])).toEqual([["5", "Завод"], ["6", "Мельница"], ["none", null]]);
    expect(groups[0].rows.map(r => r.productId)).toEqual([1, 4]);
  });

  it("количество — до сотых; пусто, ноль и не число — ничего", () => {
    expect(orderQuantity("8.756")).toBe("8.76");
    expect(orderQuantity("12,5")).toBe("12.5");
    expect(orderQuantity("0")).toBeNull();
    expect(orderQuantity("")).toBeNull();
    expect(orderQuantity("abc")).toBeNull();
  });
});

describe("вкладка «Дозаказ»", () => {
  it("уже едущее не отмечено и показывает «в пути»; нужное — отмечено", () => {
    open();
    expect((screen.getByTestId("reorder-pick-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("reorder-pick-4") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("reorder-inbound-4").textContent).toBe("40");
    expect(screen.getByTestId("reorder-row-3").textContent).toContain("по последнему приходу");
  });

  it("черновики: по группе на поставщика, с правкой количества; без поставщика — не идёт, пока его не выбрали", async () => {
    open();
    expect(screen.getByTestId("reorder-orphans-hint")).toBeTruthy();
    fireEvent.change(screen.getByTestId("reorder-qty-1"), { target: { value: "36" } });
    act(() => { fireEvent.click(screen.getByTestId("reorder-create-orders")); });
    expect(state.created[0]).toEqual({
      warehouseId: 2,
      groups: [
        { supplierId: 5, items: [{ productId: 1, quantity: "36" }] },
        { supplierId: 6, items: [{ productId: 3, quantity: "8.75" }] },
      ],
    });
    // Несколько заказов — список заказов поставщикам; «Дозаказ» перечитан.
    expect(screen.getByTestId("where").textContent).toBe("/arrivals?tab=orders");
    expect(state.invalidated).toEqual(["purchaseOrder.list", "warehouse.reorderSuggestions"]);
  });

  it("поставщик для группы «без поставщика» выбран — её строки идут к нему; один заказ — открывается он", () => {
    state.result = { orders: [{ id: 31, number: "PO-31", supplierId: 7, supplierName: "Новый завод", lines: 1 }] };
    open();
    act(() => { fireEvent.click(screen.getByRole("combobox", { name: "Поставщик для этих товаров" })); });
    act(() => { fireEvent.click(screen.getByRole("option", { name: "Новый завод" })); });
    // Остальные сняты — в заказ уходит только эта группа.
    fireEvent.click(screen.getByTestId("reorder-pick-1"));
    fireEvent.click(screen.getByTestId("reorder-pick-3"));
    act(() => { fireEvent.click(screen.getByTestId("reorder-create-orders")); });
    expect(state.created[0]).toEqual({ warehouseId: 2, groups: [{ supplierId: 7, items: [{ productId: 2, quantity: "3" }] }] });
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/31");
  });

  it("ничего не отмечено — кнопка выключена", () => {
    open([row(4, { inbound: 40, suggestedQty: 0 })]);
    expect((screen.getByTestId("reorder-create-orders") as HTMLButtonElement).disabled).toBe(true);
  });

  it("без права вести поставщиков — ни кнопки, ни полей количества", () => {
    state.canManage = false;
    open();
    expect(screen.queryByTestId("reorder-create-orders")).toBeNull();
    expect(screen.queryByTestId("reorder-qty-1")).toBeNull();
    expect(screen.getByTestId("reorder-row-1").textContent).toContain("+34");
  });
});

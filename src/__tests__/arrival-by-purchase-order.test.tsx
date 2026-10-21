// @vitest-environment jsdom
/**
 * Приход, заведённый по заказу поставщику, — в документе и в списке.
 *
 *   · документ называет заказ ссылкой и ведёт обратно на него; поставщик в
 *     шапке — поставщик заказа (поставки до проведения нет, ADR 0013);
 *   · заказ в долларах при сумовой организации — предупреждение: цену строки
 *     сервер пересчитает по заказу, правка здесь не сохранится;
 *   · блок «Долг поставщику» не пропадает молча, а говорит, когда долг
 *     появится и с каким сроком; у проведённого без поставки — что долга нет;
 *   · в списке под номером прихода — номер заказа.
 *
 * Нарочная поломка: убери `order={linkedOrder}` у SupplierDebtSection —
 * падает тест блока долга; убери fallback на linkedOrder.supplierName —
 * падает тест шапки.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { LangProvider } from "@/i18n";

const api = vi.hoisted(() => ({ details: {} as Record<number, unknown>, currency: "UZS" }));

vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10 } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: api.currency }) }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: {} }) }));
vi.mock("@/lib/documents", () => ({ printArrivalReceipt: vi.fn(), printLabels: vi.fn() }));
vi.mock("@/components/BarcodeScanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/PremiumSelect", () => ({ PremiumSelect: () => null }));
vi.mock("@/providers/trpc", () => {
  const mutation = () => () => ({ mutateAsync: async () => ({}), mutate: () => {}, isPending: false });
  return {
    trpc: {
      useUtils: () => ({
        arrival: { list: { invalidate: async () => {} }, getById: { invalidate: async () => {} } },
        supplier: { getSupplyByArrival: { invalidate: async () => {} }, list: { invalidate: async () => {} } },
      }),
      product: { list: { useQuery: () => ({ data: { data: [] } }) } },
      supplier: {
        list: { useQuery: () => ({ data: [] }) },
        // Приход по заказу: поставки до проведения нет.
        getSupplyByArrival: { useQuery: () => ({ data: null, isLoading: false }) },
        pay: { useMutation: mutation() },
      },
      arrival: {
        getById: { useQuery: ({ id }: { id: number }) => ({ data: api.details[id], isLoading: !api.details[id], isError: false }) },
        create: { useMutation: mutation() },
        update: { useMutation: mutation() },
        setItems: { useMutation: mutation() },
        delete: { useMutation: mutation() },
      },
    },
  };
});

const { default: ArrivalEditor } = await import("@/pages/ArrivalEditor");

const OPENED = new Date("2026-10-20T08:00:00Z");
const doc = (id: number, over: Record<string, unknown> = {}) => ({
  id, arrivalNumber: `ARR-${id}`, status: "unloading", truckId: null, driverName: null, driverPhone: null,
  fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "0.00", arrivalDate: new Date("2026-10-20"),
  notes: null, createdAt: OPENED, updatedAt: OPENED, purchaseOrderId: 3, warehouseId: 1,
  items: [{
    id: 1, productId: 1, productName: "Мука", productCode: "M-1", quantity: 0, expectedQuantity: 10, condition: "", notes: "",
    barcode: null, costPrice: "80.00", sellingPrice: "100.00", batchNumber: null, expiresAt: null,
    unit: "pcs", unitWeight: null, packSize: null, packLabel: null,
  }],
  purchaseOrder: { id: 3, number: "PO-3", status: "approved", currency: "UZS", paymentTermsDays: 15, supplierId: 5, supplierName: "Завод" },
  ...over,
});

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

function open(path: string) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/arrivals/:id" element={<ArrivalEditor />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </LangProvider>,
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  api.currency = "UZS";
  api.details = { 5: doc(5) };
});

describe("приход по заказу поставщику", () => {
  it("документ называет заказ и ведёт на него; поставщик — из заказа", async () => {
    open("/arrivals/5");
    const link = screen.getByTestId("arrival-order-link");
    expect(link.textContent).toBe("по заказу PO-3");
    expect(link.parentElement?.textContent).toContain("Завод");
    fireEvent.click(link);
    await act(async () => {});
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/3");
  });

  it("долларовый заказ при сумовой организации — предупреждение о цене строк", () => {
    api.details = { 5: doc(5, { purchaseOrder: { ...doc(5).purchaseOrder, currency: "USD" } }) };
    open("/arrivals/5");
    expect(screen.getByTestId("arrival-order-currency").textContent).toContain("PO-3 в USD");
    cleanup();

    api.details = { 5: doc(5) };
    open("/arrivals/5");
    expect(screen.queryByTestId("arrival-order-currency")).toBeNull();
  });

  it("долг: говорит, когда появится и с каким сроком; проведённый без поставки — долга нет", () => {
    open("/arrivals/5");
    const block = screen.getByTestId("supplier-debt-by-order");
    expect(block.textContent).toContain("Завод");
    expect(block.textContent).toContain("По заказу PO-3");
    expect(block.textContent).toContain("Долг появится, когда приход проведут");
    expect(block.textContent).toContain("через 15 дн.");
    cleanup();

    api.details = { 5: doc(5, { status: "completed" }) };
    open("/arrivals/5");
    expect(screen.getByTestId("supplier-debt-by-order").textContent).toContain("Долга по приходу нет");
  });

  it("приход без заказа и без поставки — ни ссылки, ни блока долга", () => {
    api.details = { 5: doc(5, { purchaseOrderId: null, purchaseOrder: null }) };
    open("/arrivals/5");
    expect(screen.queryByTestId("arrival-order-link")).toBeNull();
    expect(screen.queryByTestId("supplier-debt-by-order")).toBeNull();
  });
});

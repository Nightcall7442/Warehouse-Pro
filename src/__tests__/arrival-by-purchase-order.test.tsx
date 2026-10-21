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

const api = vi.hoisted(() => ({ details: {} as Record<number, unknown>, currency: "UZS", invalidated: [] as string[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/toast", () => ({ notify: toast }));
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
      useUtils: () => {
        const spy = (name: string) => ({ invalidate: async () => { api.invalidated.push(name); } });
        return {
          arrival: { list: spy("arrival.list"), getById: spy("arrival.getById") },
          supplier: { getSupplyByArrival: spy("supplier.getSupplyByArrival"), list: spy("supplier.list") },
          purchaseOrder: { getById: spy("purchaseOrder.getById"), list: spy("purchaseOrder.list") },
        };
      },
      product: { list: { useQuery: () => ({ data: { data: [
        { id: 1, name: "Мука", code: "M-1", barcode: "111", status: "active" },
        { id: 2, name: "Сахар", code: "S-1", barcode: "222", status: "active" },
      ] } }) } },
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
  purchaseOrder: { id: 3, number: "PO-3", status: "approved", currency: "UZS", paymentTermsDays: 15, supplierId: 5, supplierName: "Завод", productIds: [1] },
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
  api.invalidated = [];
  toast.error.mockClear();
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
    // Себестоимость считает сервер — поля для правки нет, а не правка, которая молча пропадёт.
    expect(screen.queryByTestId("arrival-cell-costPrice-0")).toBeNull();
    cleanup();

    api.details = { 5: doc(5) };
    open("/arrivals/5");
    expect(screen.queryByTestId("arrival-order-currency")).toBeNull();
    expect(screen.getByTestId("arrival-cell-costPrice-0")).toBeTruthy();
  });

  it("сканер по приходу из заказа берёт только заказанное и говорит, куда деть остальное", () => {
    open("/arrivals/5");
    const wedge = screen.getByTestId("arrival-wedge");
    fireEvent.change(wedge, { target: { value: "222" } });
    fireEvent.keyDown(wedge, { key: "Enter" });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("«Сахар» нет в заказе PO-3"));
    expect(screen.queryByText("Сахар")).toBeNull();

    fireEvent.change(wedge, { target: { value: "111" } });
    fireEvent.keyDown(wedge, { key: "Enter" });
    expect((screen.getByTestId("arrival-cell-quantity-0") as HTMLInputElement).value).toBe("1");
  });

  it("проведение перечитывает долг по приходу и заказ — блок не врёт «долга нет»", async () => {
    api.details = { 5: doc(5, { items: [{ ...doc(5).items[0], quantity: 10 }] }) };
    open("/arrivals/5");
    fireEvent.click(screen.getByTestId("arrival-complete"));
    fireEvent.click(await screen.findByText("Завершить", { selector: "button" }));
    await act(async () => {});
    expect(api.invalidated).toEqual(expect.arrayContaining(["supplier.getSupplyByArrival", "purchaseOrder.getById", "arrival.getById"]));
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

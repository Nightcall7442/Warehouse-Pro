// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Экран заказа поставщику: какие кнопки у кого и куда ведёт «Принять».
 *
 * Согласует и возвращает только директор (purchaseOrder.approve/reject —
 * adminQuery): оператор, увидевший «Согласовать», получил бы отказ. «Принять
 * товар» заводит приход и сразу открывает его — разгружают уже там.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const calls = vi.hoisted(() => ({
  receive: vi.fn(), approve: vi.fn(), submit: vi.fn(), update: vi.fn(), create: vi.fn(),
  reject: vi.fn(), cancel: vi.fn(),
}));
const state = vi.hoisted(() => ({ role: "operator", status: "approved" as string }));

const trpcStub = vi.hoisted(() => {
  const query = (data: () => unknown) => () => ({ data: data(), isLoading: false, isLoadingError: false, isError: false, refetch: vi.fn() });
  // onSuccess зовётся сразу: сеть здесь не проверяется, проверяется, куда экран ведёт дальше.
  const mutation = (spy: (input: unknown) => void, result: unknown = {}) =>
    (opts?: { onSuccess?: (r: unknown) => void }) => ({
      mutate: (input: unknown) => { spy(input); opts?.onSuccess?.(result); },
      isPending: false,
    });
  const order = () => ({
    id: 9, number: "PO-9", status: state.status, supplierId: 5, supplierName: "Завод", supplierPhone: null,
    warehouseId: 1, warehouseName: "Основной", currency: "UZS", rateToUzs: null, paymentTermsDays: 10,
    expectedDate: "2026-10-25", source: "manual", notes: null, rejectNote: null,
    createdBy: 1, submittedAt: null, approvedBy: null, approvedAt: null, closedAt: null,
    createdAt: new Date("2026-10-20T10:00:00Z"), updatedAt: new Date("2026-10-20T10:00:00Z"),
    createdByName: "Оператор", approvedByName: null, expectedPaymentDate: "2026-11-04",
    items: [{ id: 1, productId: 3, quantity: 10, unitPrice: 80, receivedQty: 4, note: null, productName: "Мука", productCode: "M-1",
      barcode: null, unit: "pcs", packSize: null, packLabel: null, remaining: 6, over: 0, inTransit: 0 }],
    arrivals: [{ id: 40, arrivalNumber: "ARR-40", status: "completed", arrivalDate: "2026-10-21" }],
    total: 800,
  });
  return {
    purchaseOrder: {
      getById: { useQuery: query(order) },
      list: { useQuery: query(() => ({ data: [], total: 0, page: 1, pageSize: 25, summary: { pendingApproval: 0, open: 0, plannedUzs: 0, plannedUsd: 0 } })) },
      create: { useMutation: mutation(calls.create, { id: 9, number: "PO-9" }) },
      update: { useMutation: mutation(calls.update) },
      submit: { useMutation: mutation(calls.submit) },
      approve: { useMutation: mutation(calls.approve) },
      reject: { useMutation: mutation(calls.reject) },
      cancel: { useMutation: mutation(calls.cancel) },
      receive: { useMutation: mutation(calls.receive, { arrivalId: 41, arrivalNumber: "ARR-41" }) },
    },
    supplier: { list: { useQuery: query(() => [{ id: 5, name: "Завод" }]) } },
    warehouseMulti: { list: { useQuery: query(() => [{ id: 1, name: "Основной", isDefault: true, status: "active" }]) } },
    product: { list: { useQuery: query(() => ({ data: [{ id: 3, name: "Мука", code: "M-1", unit: "pcs", costPrice: "75.00" }] })) } },
    auth: { me: { useQuery: query(() => ({ id: 1, name: "Кто-то", role: state.role })) } },
    useUtils: () => ({ purchaseOrder: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
  };
});

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
// Окно выбора товаров печатает цены валютой организации.
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const { default: PurchaseOrderEditor } = await import("@/pages/PurchaseOrderEditor");

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/purchase-orders/:id" element={<PurchaseOrderEditor />} />
          <Route path="/arrivals/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </LangProvider>,
  );
}

beforeEach(() => { for (const f of Object.values(calls)) f.mockClear(); });

describe("заказ поставщику на экране", () => {
  it("оператор: согласованный заказ принимает — и попадает в заведённый приход", () => {
    state.role = "operator"; state.status = "approved";
    renderAt("/purchase-orders/9");
    expect(screen.queryByTestId("po-approve")).toBeNull();
    expect(screen.queryByTestId("po-reject")).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId("po-receive")); });
    expect(calls.receive).toHaveBeenCalledWith({ id: 9 });
    expect(screen.getByTestId("where").textContent).toBe("/arrivals/41");
  });

  it("строки показывают принятое и остаток; приход по заказу — ссылкой", () => {
    state.role = "operator"; state.status = "partially_received";
    renderAt("/purchase-orders/9");
    const line = screen.getByTestId("po-line-3");
    expect(line.textContent).toContain("Мука");
    expect(line.textContent).toContain("4");
    expect(line.textContent).toContain("6");
    expect(screen.getByTestId("po-arrival-40").textContent).toContain("ARR-40");
    // Частично принятый не отменяют — закрывают с недовозом.
    expect(screen.getByTestId("po-cancel").textContent).toContain("Закрыть с недовозом");
  });

  it("директор: заказ на согласовании согласует или возвращает с замечанием", () => {
    state.role = "ceo"; state.status = "pending_approval";
    renderAt("/purchase-orders/9");
    act(() => { fireEvent.click(screen.getByTestId("po-approve")); });
    expect(calls.approve).toHaveBeenCalledWith({ id: 9 });

    act(() => { fireEvent.click(screen.getByTestId("po-reject")); });
    fireEvent.change(screen.getByTestId("po-reject-text"), { target: { value: "Цена выше договорной" } });
    act(() => { fireEvent.click(screen.getByTestId("po-reject-send")); });
    expect(calls.reject).toHaveBeenCalledWith({ id: 9, note: "Цена выше договорной" });
  });

  it("новый заказ: поставщик, товары с ценой прошлой закупки — и открывается заведённый", () => {
    state.role = "operator";
    renderAt("/purchase-orders/new");
    expect((screen.getByTestId("po-save") as HTMLButtonElement).disabled).toBe(true);

    act(() => { fireEvent.click(screen.getByRole("combobox", { name: "Поставщик" })); });
    act(() => { fireEvent.click(screen.getByRole("option", { name: "Завод" })); });
    act(() => { fireEvent.click(screen.getByTestId("po-add-lines")); });
    act(() => { fireEvent.click(screen.getByTestId("picker-item-3")); });
    act(() => { fireEvent.click(screen.getByTestId("picker-add")); });
    // Количество не вписано — сохранять нечего.
    expect((screen.getByTestId("po-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Количество"), { target: { value: "10" } });
    act(() => { fireEvent.click(screen.getByTestId("po-save")); });

    expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: 5, currency: "UZS", paymentTermsDays: undefined,
      items: [{ productId: 3, quantity: "10", unitPrice: "75" }],
    }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("PO-9");
  });

  it("правка строки отдаёт заказ целиком с версией документа", () => {
    state.role = "operator"; state.status = "draft";
    renderAt("/purchase-orders/9");
    // Пока правка не сохранена, отправлять директору нечего.
    fireEvent.change(screen.getByLabelText("Количество"), { target: { value: "12" } });
    expect(screen.queryByTestId("po-submit")).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId("po-save")); });
    expect(calls.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 9, supplierId: 5, currency: "UZS", updatedAt: new Date("2026-10-20T10:00:00Z"),
      items: [{ productId: 3, quantity: "12", unitPrice: "80" }],
    }));
  });
});

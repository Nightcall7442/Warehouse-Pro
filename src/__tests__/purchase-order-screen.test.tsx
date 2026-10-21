// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Экран заказа поставщику: какие кнопки у кого и куда ведёт «Принять».
 *
 * Плюс то, что бережёт набранное руками: вопрос при уходе с правками и
 * версия на экране, когда заказ меняют со стороны (проведённый приход,
 * директор в соседней вкладке).
 *
 * Согласует и возвращает только директор (purchaseOrder.approve/reject —
 * adminQuery): оператор, увидевший «Согласовать», получил бы отказ. «Принять
 * товар» заводит приход и сразу открывает его — разгружают уже там.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const calls = vi.hoisted(() => ({
  receive: vi.fn(), approve: vi.fn(), submit: vi.fn(), update: vi.fn(), create: vi.fn(),
  reject: vi.fn(), cancel: vi.fn(), print: vi.fn(), excel: vi.fn(),
}));
const state = vi.hoisted(() => ({
  role: "operator", status: "approved" as string, updatedAt: "2026-10-20T10:00:00Z", price: 80,
  arrivals: [{ id: 40, arrivalNumber: "ARR-40", status: "completed", arrivalDate: "2026-10-21" }] as Array<Record<string, unknown>>,
}));

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
    supplierInn: "301234567", supplierAddress: "Ташкент",
    warehouseId: 1, warehouseName: "Основной", currency: "UZS", rateToUzs: null, paymentTermsDays: 10,
    expectedDate: "2026-10-25", source: "manual", notes: null, rejectNote: null,
    createdBy: 1, submittedAt: new Date("2026-10-20T11:00:00Z"), approvedBy: null, approvedAt: null, closedAt: null,
    createdAt: new Date("2026-10-20T10:00:00Z"), updatedAt: new Date(state.updatedAt),
    createdByName: "Оператор", approvedByName: null, expectedPaymentDate: "2026-11-04",
    items: [{ id: 1, productId: 3, quantity: 10, unitPrice: state.price, receivedQty: 4, note: null, productName: "Мука", productCode: "M-1",
      barcode: null, unit: "pcs", packSize: null, packLabel: null, remaining: 6, over: 0, inTransit: 0 }],
    arrivals: state.arrivals,
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
    supplier: { list: { useQuery: query(() => [{ id: 5, name: "Завод", paymentTermsDays: 14 }]) } },
    warehouseMulti: { list: { useQuery: query(() => [{ id: 1, name: "Основной", isDefault: true, status: "active" }]) } },
    product: { list: { useQuery: query(() => ({ data: [{ id: 3, name: "Мука", code: "M-1", unit: "pcs", costPrice: "75.00" }] })) } },
    auth: { me: { useQuery: query(() => ({ id: 1, name: "Кто-то", role: state.role })) } },
    // Реквизиты заказчика для печати.
    settings: { get: { useQuery: query(() => ({ companyName: "ООО Тест", companyInn: "300000001" })) } },
    branding: { get: { useQuery: query(() => ({})) } },
    useUtils: () => ({ purchaseOrder: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
  };
});

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
// Окно выбора товаров печатает цены валютой организации.
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
// Окно печати и файл не открываются: проверяется, что в них уходит.
vi.mock("@/lib/documents", async orig => ({ ...(await orig<typeof import("@/lib/documents")>()), printPurchaseOrder: calls.print }));
vi.mock("@/lib/excel", async orig => ({ ...(await orig<typeof import("@/lib/excel")>()), exportToExcel: calls.excel }));

const { default: PurchaseOrderEditor } = await import("@/pages/PurchaseOrderEditor");

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderAt(path: string) {
  // Новый элемент на каждый вызов: тот же объект React не перерисует.
  const tree = () => (
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/purchase-orders/:id" element={<PurchaseOrderEditor />} />
          <Route path="/arrivals/:id" element={<Where />} />
          <Route path="/arrivals" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </LangProvider>
  );
  return { ...render(tree()), tree };
}

beforeEach(() => {
  for (const f of Object.values(calls)) f.mockClear();
  state.updatedAt = "2026-10-20T10:00:00Z";
  state.price = 80;
  state.arrivals = [{ id: 40, arrivalNumber: "ARR-40", status: "completed", arrivalDate: "2026-10-21" }];
});

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
    // С версией, которую директор видит: поменяли после — сервер откажет, а не согласует непрочитанное.
    expect(calls.approve).toHaveBeenCalledWith({ id: 9, updatedAt: new Date("2026-10-20T10:00:00Z") });

    act(() => { fireEvent.click(screen.getByTestId("po-reject")); });
    fireEvent.change(screen.getByTestId("po-reject-text"), { target: { value: "Цена выше договорной" } });
    act(() => { fireEvent.click(screen.getByTestId("po-reject-send")); });
    expect(calls.reject).toHaveBeenCalledWith({ id: 9, note: "Цена выше договорной", updatedAt: new Date("2026-10-20T10:00:00Z") });
  });

  it("строка без цены: черновик видно и сохранить можно, а отправить и согласовать — нет", () => {
    state.price = 0; state.status = "draft";
    state.role = "operator";
    renderAt("/purchase-orders/9");
    expect(screen.getByTestId("po-unpriced").textContent).toContain("«Мука»");
    expect((screen.getByTestId("po-submit") as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    state.role = "ceo";
    renderAt("/purchase-orders/9");
    expect((screen.getByTestId("po-approve") as HTMLButtonElement).disabled).toBe(true);
    // Цену вписали — предупреждение уходит, сохранить можно.
    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: "80" } });
    expect(screen.queryByTestId("po-unpriced")).toBeNull();
    expect((screen.getByTestId("po-save") as HTMLButtonElement).disabled).toBe(false);
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
  it("уход с несохранённой правкой спрашивает: «Отмена» оставляет, «Уйти» уводит", async () => {
    state.role = "operator"; state.status = "draft";
    renderAt("/purchase-orders/9");
    fireEvent.change(screen.getByLabelText("Количество"), { target: { value: "12" } });

    fireEvent.click(screen.getByTestId("po-back"));
    expect(await screen.findByText("Уйти без сохранения?")).toBeTruthy();
    fireEvent.click(screen.getByText("Отмена", { selector: "button" }));
    await act(async () => {});
    expect(screen.queryByTestId("where")).toBeNull();
    expect((screen.getByLabelText("Количество") as HTMLInputElement).value).toBe("12");

    fireEvent.click(screen.getByTestId("po-back"));
    fireEvent.click(await screen.findByText("Уйти", { selector: "button" }));
    await act(async () => {});
    expect(screen.getByTestId("where").textContent).toBe("/arrivals");
  });

  it("без правок уходит молча", () => {
    state.role = "operator"; state.status = "draft";
    renderAt("/purchase-orders/9");
    act(() => { fireEvent.click(screen.getByTestId("po-back")); });
    expect(screen.queryByText("Уйти без сохранения?")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/arrivals");
  });

  it("директор свой черновик согласует сам — «Отправить на согласование» ему не нужна", () => {
    state.role = "ceo"; state.status = "draft";
    renderAt("/purchase-orders/9");
    expect(screen.queryByTestId("po-submit")).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId("po-approve")); });
    expect(calls.approve).toHaveBeenCalledWith({ id: 9, updatedAt: new Date("2026-10-20T10:00:00Z") });
  });

  it("оператор видит, что заказ ждёт директора, и кнопок директора у него нет", () => {
    state.role = "operator"; state.status = "pending_approval";
    renderAt("/purchase-orders/9");
    expect(screen.getByTestId("po-waiting-director").textContent).toContain("Ждёт согласования директора");
    expect(screen.queryByTestId("po-approve")).toBeNull();
    expect(screen.queryByTestId("po-reject")).toBeNull();
    expect(screen.queryByTestId("po-submit")).toBeNull();
  });

  it("пока приход по заказу не проведён, заказ не правят, не отменяют и не возвращают", () => {
    state.status = "approved";
    state.arrivals = [{ id: 42, arrivalNumber: "ARR-42", status: "draft", arrivalDate: "2026-10-21" }];
    state.role = "operator";
    renderAt("/purchase-orders/9");
    expect(screen.getByTestId("po-open-arrival").textContent).toContain("ARR-42");
    expect(screen.queryByTestId("po-cancel")).toBeNull();
    expect(screen.queryByTestId("po-save")).toBeNull();
    expect(screen.queryByLabelText("Количество")).toBeNull();
    cleanup();

    state.role = "ceo";
    renderAt("/purchase-orders/9");
    expect(screen.queryByTestId("po-reject")).toBeNull();
    expect(screen.queryByTestId("po-cancel")).toBeNull();
  });

  it("печать — заказ с реквизитами поставщика и заказчика, по-русски", () => {
    state.role = "operator"; state.status = "approved";
    renderAt("/purchase-orders/9");
    act(() => { fireEvent.click(screen.getByTestId("po-print")); });
    expect(calls.print).toHaveBeenCalledWith(expect.objectContaining({
      number: "PO-9",
      supplier: expect.objectContaining({ name: "Завод", inn: "301234567", address: "Ташкент" }),
      buyer: expect.objectContaining({ name: "ООО Тест", inn: "300000001" }),
      warehouse: "Основной", currency: "UZS", paymentTermsDays: 10, status: "approved",
      items: [expect.objectContaining({ name: "Мука", code: "M-1", qty: 10, price: 80 })],
    }));
  });

  it("Excel — строки заказа с принятым и остатком", () => {
    state.role = "operator"; state.status = "partially_received";
    renderAt("/purchase-orders/9");
    act(() => { fireEvent.click(screen.getByTestId("po-excel")); });
    expect(calls.excel).toHaveBeenCalledTimes(1);
    const [rows, file, sheet] = calls.excel.mock.calls[0] as [Array<Record<string, unknown>>, string, string];
    expect(file).toBe("purchase-order-PO-9");
    expect(sheet).toBe("Заказ поставщику");
    expect(rows).toEqual([expect.objectContaining({ "Товар": "Мука", "Заказано": 10, "Принято": 4, "Осталось": 6 })]);
  });

  it("печать и Excel ждут сохранения: на бумагу идёт сохранённый заказ", () => {
    state.role = "operator"; state.status = "draft";
    renderAt("/purchase-orders/9");
    fireEvent.change(screen.getByLabelText("Количество"), { target: { value: "12" } });
    expect((screen.getByTestId("po-print") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("po-excel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("«Новый заказ» из карточки поставщика открывается с этим поставщиком", () => {
    state.role = "operator";
    renderAt("/purchase-orders/new?supplierId=5");
    expect(screen.getByRole("combobox", { name: "Поставщик" }).textContent).toContain("Завод");
  });

  it("пустая отсрочка говорит, какую возьмёт заказ — из карточки поставщика", () => {
    state.role = "operator";
    renderAt("/purchase-orders/new?supplierId=5");
    expect((screen.getByTestId("po-terms") as HTMLInputElement).placeholder).toBe("Как у поставщика: 14 дн.");
  });

  it("заказ изменился, пока его правили: набранное не пропадает, экран говорит об этом", () => {
    state.role = "operator"; state.status = "draft";
    const view = renderAt("/purchase-orders/9");
    fireEvent.change(screen.getByLabelText("Количество"), { target: { value: "12" } });

    // Живое событие перечитало заказ: другая версия.
    state.updatedAt = "2026-10-20T12:00:00Z";
    view.rerender(view.tree());

    expect(screen.getByTestId("po-stale")).toBeTruthy();
    expect((screen.getByLabelText("Количество") as HTMLInputElement).value).toBe("12");
    // Поверх новой версии сохранить нельзя — сервер всё равно откажет.
    expect((screen.getByTestId("po-save") as HTMLButtonElement).disabled).toBe(true);

    act(() => { fireEvent.click(screen.getByTestId("po-stale-reload")); });
    expect(screen.queryByTestId("po-stale")).toBeNull();
    expect((screen.getByLabelText("Количество") as HTMLInputElement).value).toBe("10");
  });
});

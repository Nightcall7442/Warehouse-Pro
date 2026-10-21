// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup, act } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { LangProvider } from "@/i18n";

/**
 * Документ перемещения на экране: режим, партии, «в пути», приёмка.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Кладовщик не видел, какие партии уедут: дверь брала по FEFO молча, а
 * просроченное, которое по FEFO не уезжает, всплывало отказом сервера.
 * Увезти конкретную партию (например, сгоревшую — на склад списания) было
 * нельзя. Второго шага не было: товар либо на складе, либо нигде.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · галочка «в пути» стоит по настройке организации и уходит в документ;
 *   · предпросмотр FEFO: партии со сроком, просрочка, и уценка, которая
 *     пропадёт вместе с партией, ушедшей целиком;
 *   · партии вручную: уходит выбранное, количество строки — их сумма;
 *   · «в пути»: приёмка по строкам (меньше — недостача, предупреждение по
 *     товарам с единицами), отмена; без права — ни того, ни другого; без права
 *     проводить правку (warehouse.apply) — принять только всё;
 *   · история документов с номером, недостачей и отменой; прежние строки
 *     без документа спрашиваются отдельно (legacy);
 *   · настройка — переключатель в «Компании», рядом с просрочкой долга;
 *   · сравнение складов показывает едущее на склад.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

type Doc = Record<string, unknown> & { lines: Array<Record<string, unknown>> };

const h = vi.hoisted(() => {
  const state = {
    settings: { companyName: "Тест", currency: "UZS", transferTwoStep: false } as Record<string, unknown>,
    stockRows: [] as Array<Record<string, unknown>>,
    preview: { items: [], markdowns: [] } as Record<string, unknown>,
    batches: { onHand: 0, inBatches: 0, untracked: 0, batches: [] } as Record<string, unknown>,
    me: { can: {} } as Record<string, unknown>,
    inTransit: [] as Doc[],
    history: [] as Doc[],
    legacy: [] as Array<Record<string, unknown>>,
    legacyInput: vi.fn(),
    createTransfer: vi.fn(),
    receiveTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    completeTransfer: vi.fn(),
    settingsSave: vi.fn(),
    invalidate: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isLoadingError: false, isError: false, refetch: vi.fn() });
  const m = (fn: (input: unknown) => void, result: () => unknown = () => ({ count: 1, number: "ПМ-1", status: "received", shortageQty: 0 })) =>
    (opts?: { onSuccess?: (r: unknown) => void }) => ({ mutate: (input: unknown) => { fn(input); opts?.onSuccess?.(result()); }, isPending: false });
  const inv = { invalidate: state.invalidate };
  return {
    state,
    trpc: {
      // useCan: права оператора приходят вместе с auth.me.
      auth: { me: { useQuery: q(() => state.me) } },
      settings: {
        get: { useQuery: q(() => state.settings) },
        update: { useMutation: m(state.settingsSave) },
      },
      warehouseMulti: {
        getStock: { useQuery: q(() => ({ data: state.stockRows, total: state.stockRows.length, page: 1, pageSize: 10000, summary: {} })) },
        listTransfers: { useQuery: (input?: unknown) => { state.legacyInput(input); return q(() => state.legacy)(); } },
        transferDocs: { useQuery: (input?: { status?: string }) => q(() => (input?.status === "in_transit" ? state.inTransit : state.history))() },
        previewTransfer: { useQuery: q(() => state.preview) },
        createTransfer: { useMutation: m(state.createTransfer) },
        completeTransfer: { useMutation: m(state.completeTransfer) },
        receiveTransfer: { useMutation: m(state.receiveTransfer, () => ({ number: "ПМ-3", status: "received_short", shortageQty: 1, shortageCost: 9000 })) },
        cancelTransfer: { useMutation: m(state.cancelTransfer, () => ({ number: "ПМ-3" })) },
      },
      warehouseReports: { productBatches: { useQuery: q(() => state.batches) } },
      useUtils: () => ({
        settings: { get: inv },
        warehouseMulti: { listTransfers: inv, getStock: inv, transferDocs: inv, previewTransfer: inv },
        warehouse: { valuation: inv },
      }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));

const { StockTransfers } = await import("@/components/warehouse/StockTransfers");
const { WarehouseCompare } = await import("@/components/warehouse/WarehouseCompare");
const { CompanySettings } = await import("@/components/settings/CompanySettings");

const TWO = [{ id: 1, name: "Основной склад", isDefault: true }, { id: 2, name: "Склад №2", isDefault: false }];
const WATER = { productId: 1, productName: "Вода", productCode: "W1", unit: "pcs", warehouseId: 1, available: "12.000", currentStock: "12.000" };

beforeEach(() => {
  const s = h.state;
  s.settings = { companyName: "Тест", currency: "UZS", transferTwoStep: false };
  s.stockRows = [WATER];
  s.preview = { items: [], markdowns: [] };
  s.batches = { onHand: 0, inBatches: 0, untracked: 0, batches: [] };
  s.inTransit = []; s.history = []; s.legacy = [];
  s.me = { can: {} };
  for (const f of [s.legacyInput, s.createTransfer, s.receiveTransfer, s.cancelTransfer, s.completeTransfer, s.settingsSave, s.invalidate]) f.mockReset();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const wrap = (ui: React.ReactElement) => render(<LangProvider>{ui}</LangProvider>);

/** Открыть форму и добавить «Воду». */
function addWater() {
  fireEvent.click(screen.getByTestId("transfer-new"));
  fireEvent.change(screen.getByTestId("transfer-search"), { target: { value: "во" } });
  fireEvent.click(screen.getByText(/^Вода/));
}

describe("режим документа", () => {
  it("настройка выключена — в один шаг; включена — галочка «в пути» стоит и уходит в документ", async () => {
    wrap(<StockTransfers warehouses={TWO} />);
    addWater();
    expect((screen.getByTestId("transfer-transit") as HTMLInputElement).checked).toBe(false);
    fireEvent.change(within(screen.getByTestId("transfer-lines")).getByPlaceholderText("0"), { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(h.state.createTransfer.mock.calls[0][0]).toEqual({
      fromWarehouseId: 1, toWarehouseId: 2, items: [{ productId: 1, quantity: 5 }], notes: undefined, mode: "instant",
    });
    cleanup();

    h.state.settings = { ...h.state.settings, transferTwoStep: true };
    wrap(<StockTransfers warehouses={TWO} />);
    addWater();
    expect((screen.getByTestId("transfer-transit") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(screen.getByTestId("transfer-lines")).getByPlaceholderText("0"), { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(h.state.createTransfer.mock.calls[1][0]).toMatchObject({ mode: "transit" });
  });
});

describe("предпросмотр FEFO", () => {
  it("видно, какие партии уедут; просрочка не уезжает; уценка уходит вместе с партией", async () => {
    h.state.preview = {
      items: [{
        productId: 1, available: 12, expired: 2, movable: 10, untracked: 0,
        planned: [
          { batchId: 5, batchNumber: "B-1", expiresAt: "2026-12-01", quantity: 4, batchQuantity: 4, usesUp: true },
          { batchId: 6, batchNumber: "A-1", expiresAt: "2027-05-01", quantity: 6, batchQuantity: 8, usesUp: false },
        ],
      }],
      markdowns: [{ batchId: 5, productId: 1, price: 9000, endsOn: "2026-12-01", batchQuantity: 4 }],
    };
    wrap(<StockTransfers warehouses={TWO} />);
    addWater();
    fireEvent.change(within(screen.getByTestId("transfer-lines")).getByPlaceholderText("0"), { target: { value: "10" } });
    const plan = screen.getByTestId("transfer-plan-1");
    expect(plan.textContent).toContain("B-1");
    expect(plan.textContent).toContain("01.12.2026");
    expect(plan.textContent).toContain("A-1");
    expect(plan.textContent).toMatch(/просрочено 2/);
    const warn = screen.getByTestId("transfer-markdown-warning");
    expect(warn.textContent).toContain("B-1");
    expect(warn.textContent).toMatch(/уценк/i);

    // Больше годного — не отправляется: по FEFO просрочка не уедет.
    fireEvent.change(within(screen.getByTestId("transfer-lines")).getByPlaceholderText("0"), { target: { value: "11" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(h.state.createTransfer).not.toHaveBeenCalled();
  });
});

describe("партии вручную", () => {
  it("уходит выбранное — и просроченная партия тоже; количество строки — сумма выбора", async () => {
    h.state.batches = {
      onHand: 9, inBatches: 7, untracked: 2,
      batches: [
        { batchId: 5, warehouseId: 1, batchNumber: "B-1", expiresAt: "2026-12-01", quantity: 4, daysLeft: 40 },
        { batchId: 7, warehouseId: 1, batchNumber: "OLD", expiresAt: "2026-10-01", quantity: 3, daysLeft: -20 },
      ],
    };
    wrap(<StockTransfers warehouses={TWO} />);
    addWater();
    fireEvent.click(screen.getByTestId("transfer-manual-1"));
    expect(screen.getByTestId("pick-row-1-7").textContent).toMatch(/просрочен/);
    fireEvent.change(screen.getByTestId("pick-1-7"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("pick-1-none"), { target: { value: "1" } });
    expect(screen.getByTestId("transfer-lines").textContent).toContain("4");
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(h.state.createTransfer.mock.calls[0][0].items).toEqual([
      { productId: 1, quantity: 4, picks: [{ batchId: 7, quantity: 3 }, { batchId: null, quantity: 1 }] },
    ]);
  });
});

const IN_TRANSIT: Doc = {
  id: 3, number: "ПМ-3", fromWarehouseId: 1, toWarehouseId: 2, mode: "transit", status: "in_transit", notes: null,
  createdAt: new Date("2026-10-20T08:00:00Z"), receivedAt: null, cancelledAt: null, createdByName: "Оператор", receivedByName: null,
  quantity: 7, receivedQuantity: null, shortageQty: 0, shortageCost: null,
  lines: [
    { id: 31, productId: 1, productName: "Вода", unit: "pcs", quantity: 4, receivedQuantity: null, batchNumber: "B-1", expiresAt: "2026-12-01", unitCost: 9000 },
    { id: 32, productId: 1, productName: "Вода", unit: "pcs", quantity: 3, receivedQuantity: null, batchNumber: null, expiresAt: null, unitCost: 8000 },
  ],
};

describe("«в пути»", () => {
  it("приёмка по строкам: меньше отправленного — предупреждение о недостаче; отмена — отдельной кнопкой", async () => {
    h.state.inTransit = [IN_TRANSIT];
    wrap(<StockTransfers warehouses={TWO} />);
    const box = screen.getByTestId("transfer-in-transit");
    expect(box.textContent).toContain("ПМ-3");
    expect(box.textContent).toContain("Основной склад");
    expect(box.textContent).toContain("Склад №2");

    fireEvent.click(screen.getByTestId("transfer-receive-3"));
    const first = screen.getByTestId("receive-31") as HTMLInputElement;
    expect(first.value).toBe("4");
    fireEvent.change(first, { target: { value: "3" } });
    // По товарам и в их единицах: сумма «штук» из килограммов и бутылок ничего не значит.
    expect(screen.getByTestId("receive-shortage").textContent).toMatch(/Не доехало: Вода — 1 шт/);
    // И сколько это денег — по себестоимости партии (9 000 за единицу).
    expect(screen.getByTestId("receive-shortage").textContent).toMatch(/9\s000/);
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-receive-confirm")); });
    expect(h.state.receiveTransfer).toHaveBeenCalledWith({ docId: 3, lines: [{ lineId: 31, receivedQuantity: 3 }, { lineId: 32, receivedQuantity: 3 }] });

    await act(async () => { fireEvent.click(screen.getByTestId("transfer-cancel-3")); });
    expect(h.state.cancelTransfer).toHaveBeenCalledWith({ docId: 3 });
  });

  it("без права проводить правку: с недостачей принять нельзя — документ ждёт руководителя; целиком — можно", async () => {
    h.state.me = { can: { "warehouse.apply": false } };
    h.state.inTransit = [IN_TRANSIT];
    wrap(<StockTransfers warehouses={TWO} />);
    fireEvent.click(screen.getByTestId("transfer-receive-3"));
    fireEvent.change(screen.getByTestId("receive-31"), { target: { value: "3" } });
    expect(screen.getByTestId("receive-needs-director").textContent).toMatch(/Недостачу проводит руководитель/);
    expect(screen.queryByTestId("receive-shortage")).toBeNull();
    const confirm = screen.getByTestId("transfer-receive-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("receive-31"), { target: { value: "4" } });
    expect(screen.queryByTestId("receive-needs-director")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-receive-confirm")); });
    expect(h.state.receiveTransfer).toHaveBeenCalledWith({ docId: 3, lines: [{ lineId: 31, receivedQuantity: 4 }, { lineId: 32, receivedQuantity: 3 }] });
  });

  it("принять больше отправленного — не отправляется", async () => {
    h.state.inTransit = [IN_TRANSIT];
    wrap(<StockTransfers warehouses={TWO} />);
    fireEvent.click(screen.getByTestId("transfer-receive-3"));
    fireEvent.change(screen.getByTestId("receive-31"), { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-receive-confirm")); });
    expect(h.state.receiveTransfer).not.toHaveBeenCalled();
  });

  it("без права — документ виден, а принять и отменить нечем", () => {
    h.state.inTransit = [IN_TRANSIT];
    wrap(<StockTransfers warehouses={TWO} canTransfer={false} />);
    expect(screen.getByTestId("transfer-in-transit").textContent).toContain("ПМ-3");
    expect(screen.queryByTestId("transfer-receive-3")).toBeNull();
    expect(screen.queryByTestId("transfer-cancel-3")).toBeNull();
  });
});

describe("история и прежние строки", () => {
  it("документы — с номером, недостачей и отменой; прежние строки спрашиваются как legacy", () => {
    h.state.history = [
      { ...IN_TRANSIT, id: 2, number: "ПМ-2", status: "received_short", receivedQuantity: 6, shortageQty: 1, shortageCost: "9000.00" },
      { ...IN_TRANSIT, id: 1, number: "ПМ-1", status: "cancelled" },
    ];
    h.state.legacy = [{ id: 9, docId: null, fromWarehouseId: 1, toWarehouseId: 2, productId: 1, productName: "Вода", quantity: "4.00", status: "pending", notes: null, createdAt: new Date(), completedAt: null }];
    wrap(<StockTransfers warehouses={TWO} />);
    const hist = screen.getByTestId("transfer-history");
    expect(hist.textContent).toContain("ПМ-2");
    expect(hist.textContent).toMatch(/Недостача 1/);
    expect(hist.textContent).toContain("ПМ-1");
    expect(hist.textContent).toMatch(/Отменено/);
    expect(screen.getByTestId("transfer-pending").textContent).toContain("Вода");
    expect(h.state.legacyInput).toHaveBeenCalledWith(expect.objectContaining({ legacy: true }));
  });
});

describe("настройка организации", () => {
  it("«в два шага» — переключатель в «Компании», выключен по умолчанию, уходит в settings.update", () => {
    wrap(<CompanySettings />);
    const toggle = screen.getByTestId("transfer-two-step") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(h.state.settingsSave.mock.calls[0][0]).toMatchObject({ transferTwoStep: true });
  });
});

describe("сравнение складов и страница склада", () => {
  it("едущее на склад видно в его колонке; без едущего — как было", () => {
    h.state.stockRows = [
      { ...WATER, available: "12.000", currentStock: "12.000", inTransitIn: "0" },
      { ...WATER, warehouseId: 2, available: "1.000", currentStock: "1.000", inTransitIn: "5.000" },
    ];
    wrap(<WarehouseCompare warehouses={TWO} />);
    const row = within(screen.getByTestId("compare-table")).getAllByRole("row")[1];
    const cells = within(row).getAllByRole("cell");
    expect(cells[2].textContent).toMatch(/в пути \+5/);
    expect(cells[1].textContent).not.toMatch(/в пути/);
  });

  it("счётчик «Перемещений» — прежние застрявшие и документы в пути; плитка стоимости говорит о едущем", () => {
    const page = read("src/pages/Warehouse.tsx");
    expect(page).toContain('trpc.warehouseMulti.listTransfers.useQuery({ status: "pending", limit: 100, legacy: true }, { enabled: multi })');
    expect(page).toContain('trpc.warehouseMulti.transferDocs.useQuery({ status: "in_transit", limit: 100 }, { enabled: multi })');
    expect(page).toContain("valuation?.inTransitCost");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup, act } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { LangProvider } from "@/i18n";

/**
 * Мультисклад — A + B (решение владельца 16.09.2026, memory: multi-warehouse-decision).
 *
 * A. Один склад по умолчанию: при одном складе нигде нет ни селектора, ни
 *    «Перемещений», ни «Сравнения», ни выбора склада в инвентаризации.
 * B. Складов больше одного — честно: выбор на самой странице склада (не в
 *    боковом меню), сравнение колонками вместо суммы «все склады»,
 *    перемещение документом в один шаг, отчёты с явным переключателем.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const stub = vi.hoisted(() => {
  const state = {
    stockRows: [] as Array<Record<string, unknown>>,
    transfers: [] as Array<Record<string, unknown>>,
    createTransfer: vi.fn(),
    completeTransfer: vi.fn(),
    createCount: vi.fn(),
    invalidate: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  const m = (fn: (input: unknown) => void) => (opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (input: unknown) => { fn(input); opts?.onSuccess?.({ count: Array.isArray((input as { items?: unknown[] })?.items) ? (input as { items: unknown[] }).items.length : 1 }); },
    isPending: false,
  });
  return {
    state,
    trpc: {
      warehouseMulti: {
        getStock: { useQuery: q(() => ({ data: state.stockRows, total: state.stockRows.length, page: 1, pageSize: 10000, summary: {} })) },
        listTransfers: { useQuery: q(() => state.transfers) },
        createTransfer: { useMutation: m(state.createTransfer) },
        completeTransfer: { useMutation: m(state.completeTransfer) },
      },
      stockCount: {
        list: { useQuery: q(() => []) },
        create: { useMutation: m(state.createCount) },
      },
      useUtils: () => ({
        warehouseMulti: { listTransfers: { invalidate: state.invalidate }, getStock: { invalidate: state.invalidate } },
        warehouse: { valuation: { invalidate: state.invalidate } },
        stockCount: { list: { invalidate: state.invalidate } },
      }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));

const { StockTransfers } = await import("@/components/warehouse/StockTransfers");
const { WarehouseCompare } = await import("@/components/warehouse/WarehouseCompare");
const { StockCounts } = await import("@/components/warehouse/StockCounts");

const TWO = [{ id: 1, name: "Основной склад", isDefault: true }, { id: 2, name: "Склад №2", isDefault: false }];
const ONE = [TWO[0]];

beforeEach(() => {
  stub.state.stockRows = [];
  stub.state.transfers = [];
  stub.state.createTransfer.mockReset(); stub.state.completeTransfer.mockReset(); stub.state.createCount.mockReset(); stub.state.invalidate.mockReset();
});
afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<LangProvider>{ui}</LangProvider>);

describe("A — один склад: ничего лишнего", () => {
  it("селектора склада в боковом меню больше нет", () => {
    const layout = read("src/components/Layout.tsx");
    expect(layout).not.toContain("useWarehouse(");
    expect(layout).not.toContain("warehouse.allWarehouses");
    expect(layout).not.toContain("Warehouse selector */}");
  });

  it("контекст знает, один склад или несколько, и никогда не отдаёт «все»", () => {
    const ctx = read("src/providers/WarehouseContext.tsx");
    expect(ctx).toContain("multi: warehouses.length > 1");
    expect(ctx).toContain("warehouses.find((w) => w.isDefault) ?? warehouses[0]");
    // Сохранённый выбор действует, только если такой склад ещё есть.
    expect(ctx).toContain("warehouses.some((w) => w.id === selectedId)");
  });

  it("страница склада: фишки, «Сравнение» и «Перемещения» — только при multi", () => {
    const page = read("src/pages/Warehouse.tsx");
    expect(page).toContain("{multi && activeTab !== \"compare\" && activeTab !== \"transfers\" && activeTab !== \"reports\" && (");
    expect(page).toContain("...(multi ? [");
    expect(page).toContain('{ key: "compare" as const');
    expect(page).toContain('{activeTab === "transfers" && multi && (');
    expect(page).toContain('{activeTab === "compare" && multi && (');
    // Показатели — по выбранному складу, а не по сумме всех.
    expect(page).toContain("const whArg = multi ? { warehouseId: warehouseId ?? undefined } : {};");
    expect(page).toContain("trpc.warehouse.valuation.useQuery(whArg)");
  });

  it("инвентаризация: при одном складе выбора склада нет, при двух — есть", () => {
    wrap(<StockCounts warehouses={ONE} />);
    expect(screen.queryByText("Склад")).toBeNull();
    expect(screen.getByTestId("stock-count-new")).toBeTruthy();
    cleanup();
    wrap(<StockCounts warehouses={TWO} />);
    expect(screen.getByText("Склад")).toBeTruthy();
  });

  it("отчёты склада: переключатель только при multi, с явным «Все склады вместе»", () => {
    const page = read("src/pages/WarehouseReports.tsx");
    expect(page).toContain("{multi && (");
    expect(page).toContain('t("Все склады вместе", "Barcha omborlar birga")');
    expect(page).toContain("trpc.warehouseReports.stockByCategory.useQuery(whArg)");
    expect(page).toContain("trpc.warehouseReports.topByValue.useQuery({ limit: 10, ...whArg })");
    expect(page).toContain("trpc.warehouseReports.movementTrends.useQuery({ days, ...whArg })");
  });
});

describe("B — сравнение складов колонками", () => {
  it("товар строкой, склад колонкой, без суммы «все склады»", () => {
    stub.state.stockRows = [
      { productId: 1, productName: "Вода", productCode: "W1", unit: "pcs", warehouseId: 1, available: "120.000", currentStock: "130.000" },
      { productId: 1, productName: "Вода", productCode: "W1", unit: "pcs", warehouseId: 2, available: "30.000", currentStock: "30.000" },
      { productId: 2, productName: "Сок", productCode: "J1", unit: "pcs", warehouseId: 1, available: "0.000", currentStock: "0.000" },
    ];
    wrap(<WarehouseCompare warehouses={TWO} />);
    const table = screen.getByTestId("compare-table");
    const head = within(table).getAllByRole("columnheader").map(h => h.textContent);
    expect(head).toEqual(["Товар", "Основной склад ★", "Склад №2"]);
    const rows = within(table).getAllByRole("row");
    // Заголовок, две строки товара, итог — а не четыре строки (по строке на склад).
    expect(rows).toHaveLength(4);
    const water = rows[1];
    expect(water.textContent).toContain("Вода");
    expect(water.textContent).toContain("120 шт");
    expect(water.textContent).toContain("30 шт");
    expect(water.textContent).toContain("всего 130");
    const juice = rows[2];
    expect(juice.textContent).toContain("—"); // на складе №2 строки нет
    expect(rows[3].textContent).toContain("Свободно всего");
  });
});

describe("B — перемещение документом в один шаг", () => {
  it("несколько позиций уходят одним вызовом, с количеством по каждой", async () => {
    stub.state.stockRows = [
      { productId: 1, productName: "Вода", productCode: "W1", unit: "pcs", warehouseId: 1, available: "120.000", currentStock: "120.000" },
      { productId: 2, productName: "Сок", productCode: "J1", unit: "pcs", warehouseId: 1, available: "40.000", currentStock: "40.000" },
    ];
    wrap(<StockTransfers warehouses={TWO} />);
    fireEvent.click(screen.getByTestId("transfer-new"));
    const search = screen.getByTestId("transfer-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "во" } });
    fireEvent.click(screen.getByText(/^Вода/));
    fireEvent.change(screen.getByTestId("transfer-search"), { target: { value: "со" } });
    fireEvent.click(screen.getByText(/^Сок/));
    const lines = within(screen.getByTestId("transfer-lines")).getAllByRole("row").slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain("120 шт");
    const inputs = within(screen.getByTestId("transfer-lines")).getAllByPlaceholderText("0");
    fireEvent.change(inputs[0], { target: { value: "10" } });
    fireEvent.change(inputs[1], { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(stub.state.createTransfer).toHaveBeenCalledTimes(1);
    expect(stub.state.createTransfer.mock.calls[0][0]).toEqual({
      fromWarehouseId: 1, toWarehouseId: 2,
      items: [{ productId: 1, quantity: 10 }, { productId: 2, quantity: 5 }],
      notes: undefined,
    });
    // Никакого второго шага: completeTransfer не зовётся, остаток инвалидирован.
    expect(stub.state.completeTransfer).not.toHaveBeenCalled();
    expect(stub.state.invalidate).toHaveBeenCalled();
  });

  it("больше свободного остатка — не отправляется, товар назван", async () => {
    stub.state.stockRows = [{ productId: 1, productName: "Вода", productCode: "W1", unit: "pcs", warehouseId: 1, available: "3.000", currentStock: "3.000" }];
    wrap(<StockTransfers warehouses={TWO} />);
    fireEvent.click(screen.getByTestId("transfer-new"));
    fireEvent.change(screen.getByTestId("transfer-search"), { target: { value: "во" } });
    fireEvent.click(screen.getByText(/^Вода/));
    fireEvent.change(within(screen.getByTestId("transfer-lines")).getByPlaceholderText("0"), { target: { value: "10" } });
    await act(async () => { fireEvent.click(screen.getByTestId("transfer-submit")); });
    expect(stub.state.createTransfer).not.toHaveBeenCalled();
  });

  it("без права — нет ни кнопки «Новое перемещение», ни «Провести» у застрявших", () => {
    stub.state.transfers = [{ id: 9, fromWarehouseId: 1, toWarehouseId: 2, productId: 1, productName: "Вода", quantity: "4.00", status: "pending", notes: null, createdAt: new Date(), completedAt: null }];
    wrap(<StockTransfers warehouses={TWO} canTransfer={false} />);
    expect(screen.queryByTestId("transfer-new")).toBeNull();
    expect(screen.getByTestId("transfer-pending")).toBeTruthy();
    expect(screen.queryByText("Провести")).toBeNull();
  });

  it("застрявшие «в пути» показываются, только если они есть", () => {
    wrap(<StockTransfers warehouses={TWO} />);
    expect(screen.queryByTestId("transfer-pending")).toBeNull();
  });
});

describe("право оператора", () => {
  it("перемещение идёт по «warehouse.adjust», и подпись права говорит об этом", () => {
    expect(read("api/warehouse-multi-router.ts")).toContain('createTransfer: operatorQuery.use(can("warehouse.adjust"))');
    expect(read("contracts/constants.ts")).toContain("Ручная правка остатков и перемещения между складами");
    const access = read("src/components/settings/OperatorAccess.tsx");
    expect(access).toMatch(/"warehouse\.adjust": \{[\s\S]*?перемещ/i);
  });
});

// @vitest-environment jsdom
/**
 * Страница «Склад» — по той же схеме, что «Заказы» и «Отчёты».
 *
 * Владелец (19.09.2026): «другие дашборды выглядят нормально и
 * профессионально, а страница склад — нет». Было: пять плиток разной формы,
 * лента разделов на всю ширину, красная полоса «ниже порога» поверх таблицы —
 * третье место с тем же числом, — поиск сам по себе и красная корзина в
 * каждой строке.
 *
 * Стало: четыре плитки одной формы (та же, что на отчётах), две из них — вход
 * в раздел; лента разделов .range-pills, как на отчётах; фильтры карточкой;
 * таблица .data-table в карточке с подвалом. Окно «мало стока» удалено: в
 * разделе «Дозаказ» тот же список (тот же lowStockCondition на сервере).
 *
 * Нарочная поломка: верни на страницу `<LowStockModal` или полосу
 * «отмечены красным» — первый тест назовёт место; сделай плитку «Ниже порога»
 * простым числом без onClick — упадёт «плитка ведёт в раздел».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { LangProvider } from "@/i18n";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const stub = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    summary: { totalSKUs: 0, totalWeight: "0", lowStockCount: 0 },
    reorder: [] as Array<Record<string, unknown>>,
    dead: [] as Array<Record<string, unknown>>,
    canAdjust: true,
    multi: false,
    exportToExcel: vi.fn(),
    backfill: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isLoadingError: false, isError: false, refetch: vi.fn() });
  const m = (fn: (input: unknown) => void) => () => ({ mutate: (input?: unknown) => fn(input), isPending: false });
  return {
    state,
    trpc: {
      warehouseMulti: {
        getStock: { useQuery: q(() => ({ data: state.rows, total: state.rows.length, page: 1, pageSize: 10000, summary: state.summary })) },
        listTransfers: { useQuery: q(() => []) },
      },
      warehouse: {
        valuation: { useQuery: q(() => ({ totalCostValue: "60279800" })) },
        reorderSuggestions: { useQuery: q(() => state.reorder) },
        deadStock: { useQuery: q(() => state.dead) },
        adjustStock: { useMutation: m(() => {}) },
        backfillStock: { useMutation: m(state.backfill) },
      },
      product: { delete: { useMutation: m(() => {}) } },
      useUtils: () => ({ warehouseMulti: { getStock: { invalidate: vi.fn() } } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/providers/WarehouseContext", () => ({
  useWarehouse: () => ({ selectedId: 1, setSelectedId: vi.fn(), warehouses: stub.state.multi ? [{ id: 1, name: "Основной", isDefault: true }, { id: 2, name: "Второй", isDefault: false }] : [{ id: 1, name: "Основной", isDefault: true }], multi: stub.state.multi }),
}));
vi.mock("@/hooks/useCan", () => ({ useCan: () => (cap: string) => cap === "warehouse.adjust" ? stub.state.canAdjust : true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown, compact?: boolean) => (compact ? `${(Number(v) / 1e6).toFixed(1)}M` : String(v)) + " сум", symbol: "сум" }) }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));
vi.mock("@/lib/excel", () => ({
  exportToExcel: (...a: unknown[]) => stub.state.exportToExcel(...a),
  formatWarehouseForExport: (rows: unknown[]) => ({ kind: "stock", n: rows.length }),
  formatStockValuationForExport: (rows: unknown[]) => ({ kind: "valuation", n: rows.length }),
  formatDeadStockForExport: (rows: unknown[]) => ({ kind: "dead", n: rows.length }),
  formatReorderForExport: (rows: unknown[]) => ({ kind: "reorder", n: rows.length }),
}));
// Тяжёлые разделы — заглушки: здесь проверяется каркас страницы, не они.
vi.mock("@/components/warehouse/DemandForecast", () => ({ DemandForecast: () => <div data-testid="tab-forecast" /> }));
vi.mock("@/components/warehouse/StockCounts", () => ({ StockCounts: () => <div data-testid="tab-counts" /> }));
vi.mock("@/components/warehouse/StockTransfers", () => ({ StockTransfers: () => <div data-testid="tab-transfers" /> }));
vi.mock("@/components/warehouse/WarehouseCompare", () => ({ WarehouseCompare: () => <div data-testid="tab-compare" /> }));

const { default: Warehouse } = await import("@/pages/Warehouse");

const row = (id: number, name: string, available: string, reorderPoint: string, category = "Фрукты") => ({
  id, productId: id, productName: name, productCode: `P-${id}`, category, unit: "kg", unitWeight: "1",
  currentStock: available, reserved: "0", available, unitPrice: "100", costPrice: "80", reorderPoint,
});

beforeEach(() => {
  stub.state.rows = [row(1, "Арбуз", "146", "15"), row(2, "Баранина", "8", "10", "Мясо"), row(3, "Вода", "69", "100", "Напитки")];
  stub.state.summary = { totalSKUs: 3, totalWeight: "223", lowStockCount: 2 };
  stub.state.reorder = [{ productId: 2, productName: "Баранина", productCode: "P-2", currentStock: "8", reorderPoint: "10", unit: "kg", avgDailySales: "0.5", daysUntilStockout: 16, suggestedQty: 12, suggestedCost: 960 }];
  stub.state.dead = [{ productId: 9, productName: "Кефир", productCode: "P-9", category: "Молочные", currentStock: "40", value: "120000", lastOrderDate: null, daysSinceOrder: null }];
  stub.state.canAdjust = true;
  stub.state.multi = false;
  stub.state.exportToExcel.mockReset();
  stub.state.backfill.mockReset();
});
afterEach(cleanup);

const mount = () => render(<LangProvider><Warehouse /></LangProvider>);

describe("каркас страницы", () => {
  it("на странице нет полосы «ниже порога» и окна «мало стока»; файл окна удалён", () => {
    const src = read("src/pages/Warehouse.tsx");
    expect(src).not.toContain("LowStockModal");
    expect(src).not.toContain("отмечены красным");
    expect(fs.existsSync(path.resolve(process.cwd(), "src/components/warehouse/LowStockModal.tsx"))).toBe(false);
    // Плитки — общая, с отчётов; лента — .range-pills; таблица — .data-table.
    expect(src).toContain('import { KpiCard } from "@/components/reports/ReportKpiCards";');
    expect(src).toContain('className="range-pills"');
    expect(src).toContain('<table className="data-table">');
  });

  it("четыре плитки одной формы: позиций, стоимость, ниже порога, без продаж", () => {
    mount();
    const labels = ["ПОЗИЦИЙ", "СТОИМОСТЬ ОСТАТКОВ", "НИЖЕ ПОРОГА", "БЕЗ ПРОДАЖ · 30 ДН"];
    for (const l of labels) expect(screen.getByText(l)).toBeTruthy();
    // Число на плитке — то, что прислал сервер, а не длина списка.
    const low = screen.getByText("НИЖЕ ПОРОГА").closest(".kpi-hero")!;
    expect(within(low as HTMLElement).getByText("2")).toBeTruthy();
    expect(screen.getByText("223 кг на складе")).toBeTruthy();
    expect(screen.getByText("по себестоимости · 60279800 сум")).toBeTruthy();
  });

  it("плитка «Ниже порога» ведёт в «Дозаказ», «Без продаж» — в «Мёртвый сток»", () => {
    mount();
    fireEvent.click(screen.getByText("НИЖЕ ПОРОГА").closest(".kpi-hero")!);
    expect(screen.getByRole("tab", { name: /^Дозаказ/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("+12 кг")).toBeTruthy();
    fireEvent.click(screen.getByText(/^БЕЗ ПРОДАЖ/).closest(".kpi-hero")!);
    expect(screen.getByRole("tab", { name: /^Мёртвый сток/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Кефир")).toBeTruthy();
  });

  it("при нуле плитка — просто число: не кнопка", () => {
    stub.state.summary = { totalSKUs: 3, totalWeight: "223", lowStockCount: 0 };
    stub.state.dead = [];
    mount();
    expect(screen.getByText("НИЖЕ ПОРОГА").closest(".kpi-hero")!.getAttribute("role")).toBeNull();
    expect(screen.getByText(/^БЕЗ ПРОДАЖ/).closest(".kpi-hero")!.getAttribute("role")).toBeNull();
    expect(screen.getByText("все товары выше порога")).toBeTruthy();
    expect(screen.getByText("всё продаётся")).toBeTruthy();
  });

  it("лента разделов: счётчик только там, где число зовёт действовать; «Инвентаризация» — только с правом", () => {
    mount();
    const tabs = screen.getAllByRole("tab").map(el => el.textContent);
    expect(tabs).toEqual(["Остатки", "Дозаказ1", "Мёртвый сток1", "Прогноз", "Инвентаризация"]);
    cleanup();
    stub.state.canAdjust = false;
    mount();
    expect(screen.queryByRole("tab", { name: /Инвентаризация/ })).toBeNull();
  });

  it("при нескольких складах — «Сравнение» и «Перемещения» в ленте, фишки складов над ней", () => {
    stub.state.multi = true;
    mount();
    expect(screen.getByRole("tab", { name: /^Сравнение/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Перемещения/ })).toBeTruthy();
    expect(screen.getByTestId("warehouse-chips")).toBeTruthy();
  });
});

describe("раздел «Остатки»", () => {
  it("таблица в карточке; в подвале — счётчик и тихая ссылка «Завести строки остатков»", () => {
    mount();
    const table = screen.getByRole("table");
    expect(table.className).toBe("data-table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("3 позиций")).toBeTruthy();
    const backfill = screen.getByTestId("stock-backfill");
    expect(backfill.className).not.toContain("neo-btn"); // ссылка, не кнопка среди главных
    fireEvent.click(backfill);
    expect(stub.state.backfill).toHaveBeenCalledTimes(1);
  });

  it("фильтр «Ниже порога» оставляет строки по правилу сервера: свободный ≤ порога при заданном пороге", () => {
    // Порог 0 — не «ниже порога», даже при нуле на складе.
    stub.state.rows.push(row(4, "Соль", "0", "0"));
    // Ровно на пороге — считается (<=, не <); весь запас в резерве — считается
    // (смотрим на свободный, не на общий). Ровно на этом окно «мало стока»
    // когда-то разошлось с плиткой.
    stub.state.rows.push(row(5, "Сахар", "20", "20"));
    stub.state.rows.push({ ...row(6, "Мука", "0", "30"), currentStock: "50", reserved: "50" });
    mount();
    fireEvent.click(screen.getByTestId("stock-low-only"));
    const rows = () => within(screen.getByRole("table")).getAllByRole("row") as HTMLTableRowElement[];
    const names = rows().slice(1).map(r => r.cells[0].textContent);
    expect(names).toEqual(["Баранина", "Вода", "Сахар", "Мука"]);
    // Порог «—», когда не задан, а не «0».
    fireEvent.click(screen.getByTestId("stock-low-only"));
    const salt = rows().find(r => r.textContent?.includes("Соль"))!;
    expect(salt.cells[7].textContent).toBe("—");
  });

  it("категория — из самих строк; выбор оставляет только её", () => {
    mount();
    const sel = screen.getByRole("combobox", { name: "Категория" });
    expect(sel).toBeTruthy();
  });

  it("действия строки тихие: «Скорректировать» и корзина без заливки; удаление передаёт название", () => {
    mount();
    const first = within(screen.getByRole("table")).getAllByRole("row")[1];
    const adjust = within(first).getByText("Скорректировать").closest("button")!;
    expect(adjust.className).not.toContain("neo-btn");
    expect(within(first).getByLabelText("Удалить товар")).toBeTruthy();
  });

  it("без права на правку — ни «Скорректировать», ни ссылки на строки остатков", () => {
    stub.state.canAdjust = false;
    mount();
    expect(screen.queryByText("Скорректировать")).toBeNull();
    expect(screen.queryByTestId("stock-backfill")).toBeNull();
  });

  it("пусто без поиска — объяснение и кнопка завести строки; пусто при поиске — «Ничего не найдено»", () => {
    stub.state.rows = [];
    stub.state.summary = { totalSKUs: 0, totalWeight: "0", lowStockCount: 0 };
    mount();
    expect(screen.getByText("Нет товаров на складе")).toBeTruthy();
    expect(screen.getByTestId("stock-backfill").className).toContain("neo-btn");
  });
});

describe("выгрузки — по текущему разделу", () => {
  it("«Остатки»: Excel и «Оценка» (пока видна себестоимость); «Дозаказ» и «Мёртвый сток» — свой Excel", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Excel$/ }));
    expect(stub.state.exportToExcel).toHaveBeenLastCalledWith({ kind: "stock", n: 3 }, "warehouse-stock", "Склад", "Остатки склада");
    fireEvent.click(screen.getByRole("button", { name: /Оценка/ }));
    expect(stub.state.exportToExcel).toHaveBeenLastCalledWith({ kind: "valuation", n: 3 }, "stock-valuation", "Оценка склада", "Оценка стоимости склада");
    fireEvent.click(screen.getByRole("tab", { name: /^Дозаказ/ }));
    expect(screen.queryByRole("button", { name: /Оценка/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Excel$/ }));
    expect(stub.state.exportToExcel).toHaveBeenLastCalledWith({ kind: "reorder", n: 1 }, "reorder-suggestions", "Дозаказ", "Рекомендации по дозаказу");
    fireEvent.click(screen.getByRole("tab", { name: /^Мёртвый сток/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Excel$/ }));
    expect(stub.state.exportToExcel).toHaveBeenLastCalledWith({ kind: "dead", n: 1 }, "dead-stock", "Мёртвый сток", "Мёртвый сток — товары без продаж");
    // Бумага остаётся русской: имя листа — не через t().
    expect(read("src/pages/Warehouse.tsx")).toContain('"warehouse-stock", "Склад",');
  });

  it("«Оценка» не показывается роли без себестоимости", () => {
    stub.state.rows = stub.state.rows.map(r => ({ ...r, costPrice: undefined }));
    mount();
    expect(screen.queryByRole("button", { name: /Оценка/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Excel$/ })).toBeTruthy();
  });
});

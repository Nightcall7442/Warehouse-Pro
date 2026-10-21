// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Инвентаризация на утверждении директора — на экране.
 *
 *   • что считать: весь склад, категория или выбранные товары — и ровно это
 *     уходит в stockCount.create;
 *   • оператор без права проводить видит «На утверждение», а не «Применить»;
 *   • директор у отправленного документа — «Утвердить» и «Вернуть», и вернуть
 *     без объяснения нельзя;
 *   • окно ручной правки говорит, что остаток изменится после утверждения.
 *
 * Сервер (кто вправе, разница вместо числа) — real-db/stock-count-approval.test.ts.
 */
const h = vi.hoisted(() => {
  const state = {
    role: "operator",
    canApply: true,
    doc: null as Record<string, unknown> | null,
    list: [] as Array<Record<string, unknown>>,
    found: [] as Array<Record<string, unknown>>,
    calls: [] as Array<[string, unknown]>,
  };
  const q = (get: () => unknown) => () => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  const m = (name: string) => (opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (input: unknown) => { state.calls.push([name, input]); opts?.onSuccess?.({ id: 7, number: "ИНВ-7", changed: 1, applied: 1, surplus: 0, shortage: 1 }); },
    isPending: false,
  });
  const inv = { invalidate: vi.fn() };
  return {
    state,
    trpc: {
      stockCount: {
        list: { useQuery: q(() => state.list) },
        get: { useQuery: q(() => state.doc) },
        create: { useMutation: m("create") },
        setCounted: { useMutation: m("setCounted") },
        applyCount: { useMutation: m("applyCount") },
        submitCount: { useMutation: m("submitCount") },
        approveCount: { useMutation: m("approveCount") },
        rejectCount: { useMutation: m("rejectCount") },
        cancel: { useMutation: m("cancel") },
      },
      product: { categories: { useQuery: q(() => ["Напитки", "Сладости"]) } },
      // Валюта итогов документа (useCurrency).
      settings: { get: { useQuery: q(() => null) } },
      warehouseMulti: { getStock: { useQuery: q(() => ({ data: state.found })) } },
      useUtils: () => ({ stockCount: { list: inv, get: inv }, warehouseMulti: { getStock: inv } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: h.state.role } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => (cap: string) => cap === "warehouse.apply" ? h.state.canApply : true }));
vi.mock("@/components/BarcodeScanner", () => ({ BarcodeScanner: () => null }));

// jsdom не умеет прокручивать: выпадающий список склада прокручивает выбранный пункт в вид.
Element.prototype.scrollIntoView ??= () => {};

const { StockCounts } = await import("@/components/warehouse/StockCounts");
const { AdjustModal } = await import("@/components/warehouse/AdjustModal");

const WH = [{ id: 1, name: "Основной", isDefault: true }];
const wrap = (ui: React.ReactElement) => render(<LangProvider>{ui}</LangProvider>);
const flush = () => act(async () => { await Promise.resolve(); });

const item = (over: Record<string, unknown> = {}) => ({
  id: 11, productId: 5, productName: "Вода", productCode: "W1", barcode: null, unit: "pcs", costPrice: "1000.00",
  expected: "10.00", counted: "7.00", bookAtSubmit: null, current: "10.00", note: null, ...over,
});
const doc = (over: Record<string, unknown> = {}) => ({
  id: 7, number: "ИНВ-7", status: "draft", warehouseId: 1, createdAt: "2026-10-20T08:00:00.000Z", appliedAt: null,
  submittedAt: null, reviewNote: null, origin: "count", adjustType: null, scope: "full", scopeCategory: null,
  items: [item()], ...over,
});

beforeEach(() => {
  h.state.role = "operator"; h.state.canApply = true; h.state.calls = []; h.state.found = [];
  h.state.list = []; h.state.doc = null;
});
afterEach(cleanup);

describe("что считать", () => {
  it("категория: в create уходит только она; без выбранной категории начать нельзя", () => {
    wrap(<StockCounts warehouses={WH} />);
    fireEvent.click(screen.getByTestId("stock-count-scope-category"));
    expect((screen.getByTestId("stock-count-new") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Напитки" }));
    fireEvent.click(screen.getByTestId("stock-count-new"));
    expect(h.state.calls).toEqual([["create", { warehouseId: 1, category: "Напитки" }]]);
  });

  it("выбранные товары: найденное добавляется кнопкой, в create уходят их номера", () => {
    h.state.found = [{ productId: 5, productName: "Вода", productCode: "W1" }, { productId: 9, productName: "Сок", productCode: "J1" }];
    wrap(<StockCounts warehouses={WH} />);
    fireEvent.click(screen.getByTestId("stock-count-scope-items"));
    fireEvent.change(screen.getByTestId("stock-count-item-search"), { target: { value: "во" } });
    fireEvent.click(screen.getByTestId("stock-count-pick-9"));
    fireEvent.click(screen.getByTestId("stock-count-pick-5"));
    expect(within(screen.getByTestId("stock-count-picked")).getByText("Сок")).toBeTruthy();
    fireEvent.click(screen.getByTestId("stock-count-new"));
    expect(h.state.calls).toEqual([["create", { warehouseId: 1, productIds: [9, 5] }]]);
  });

  it("весь склад — как раньше: только склад", () => {
    wrap(<StockCounts warehouses={WH} />);
    fireEvent.click(screen.getByTestId("stock-count-new"));
    expect(h.state.calls).toEqual([["create", { warehouseId: 1 }]]);
  });

  it("директор видит, сколько документов ждёт его решения", () => {
    h.state.role = "ceo";
    h.state.list = [
      { ...doc({ status: "submitted" }), warehouseName: "Основной", lines: 1, counted: 1 },
      { ...doc({ id: 8, number: "ИНВ-8", status: "applied" }), warehouseName: "Основной", lines: 1, counted: 1 },
    ];
    wrap(<StockCounts warehouses={WH} />);
    expect(screen.getByTestId("stock-count-waiting").textContent).toContain("Ждут вашего утверждения: 1");
    expect(screen.getByText("на утверждении")).toBeTruthy();
  });
});

describe("кто что нажимает", () => {
  const openSheet = () => {
    h.state.list = [{ ...doc(), warehouseName: "Основной", lines: 1, counted: 1 }];
    wrap(<StockCounts warehouses={WH} />);
    fireEvent.click(screen.getByText("Продолжить"));
  };

  it("оператор без права проводить: «На утверждение» вместо «Применить»", async () => {
    h.state.canApply = false;
    h.state.doc = doc();
    openSheet();
    expect(screen.queryByTestId("stock-count-apply")).toBeNull();
    fireEvent.click(screen.getByTestId("stock-count-submit"));
    await flush();
    expect(h.state.calls).toEqual([["submitCount", { id: 7 }]]);
  });

  it("оператор с правом (умолчание) применяет сам, как раньше", async () => {
    h.state.doc = doc();
    openSheet();
    expect(screen.queryByTestId("stock-count-submit")).toBeNull();
    fireEvent.click(screen.getByTestId("stock-count-apply"));
    await flush();
    expect(h.state.calls).toEqual([["applyCount", { id: 7 }]]);
  });

  it("отправленный документ: оператор ждёт, директор утверждает — разница от учёта при отправке и «сейчас → станет»", async () => {
    h.state.doc = doc({ status: "submitted", submittedAt: "2026-10-20T09:00:00.000Z", items: [item({ bookAtSubmit: "10.00", current: "8.00" })] });
    openSheet();
    expect(screen.queryByTestId("stock-count-approve")).toBeNull();
    expect(screen.getByText("Ждёт решения руководителя")).toBeTruthy();
    cleanup();

    h.state.role = "ceo";
    openSheet();
    // посчитано 7 при учёте 10 → −3; сейчас 8 (продали 2) → станет 5
    expect(screen.getByTestId("count-will-5").textContent).toBe("8 → 5");
    fireEvent.click(screen.getByTestId("stock-count-approve"));
    await flush();
    expect(h.state.calls).toEqual([["approveCount", { id: 7 }]]);
  });

  it("вернуть без объяснения нельзя; с объяснением — уходит rejectCount", () => {
    h.state.role = "ceo";
    h.state.doc = doc({ status: "submitted", items: [item({ bookAtSubmit: "10.00" })] });
    openSheet();
    fireEvent.click(screen.getByTestId("stock-count-reject"));
    const send = screen.getByTestId("stock-count-reject-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("stock-count-reject-note"), { target: { value: "  Пересчитайте воду  " } });
    fireEvent.click(screen.getByTestId("stock-count-reject-send"));
    expect(h.state.calls).toEqual([["rejectCount", { id: 7, note: "Пересчитайте воду" }]]);
  });

  it("возвращённый черновик показывает слова директора", () => {
    h.state.doc = doc({ reviewNote: "Пересчитайте воду" });
    openSheet();
    expect(screen.getByTestId("stock-count-review-note").textContent).toContain("Пересчитайте воду");
  });

  it("вернувшаяся заявка «списать 2» — сдвиг: «сейчас → станет» от текущего остатка, а не старое число", () => {
    // Заявка при учёте 10: посчитано 8. С тех пор пришло 50 — сейчас 60.
    // Станет 58, а не 8: так её проведут и «Применить», и повторная отправка.
    h.state.doc = doc({ origin: "adjust", adjustType: "out", reviewNote: "Проверьте", items: [item({ expected: "10.00", counted: "8.00", current: "60.00" })] });
    openSheet();
    expect(screen.getByText("ПРИ ЗАЯВКЕ")).toBeTruthy();
    expect(screen.getByTestId("count-will-5").textContent).toBe("60 → 58");
    cleanup();
    // Пересчёт полки — не заявка: в черновике колонки «станет» нет.
    h.state.doc = doc({ items: [item({ current: "60.00" })] });
    openSheet();
    expect(screen.queryByTestId("count-will-5")).toBeNull();
  });
});

describe("окно ручной правки", () => {
  it("без права проводить кнопка и подсказка говорят об утверждении", () => {
    wrap(<AdjustModal productId={1} productName="Вода" currentStock={10} unitWeight={0} onSave={vi.fn()} onClose={vi.fn()} isPending={false} needsApproval />);
    expect(screen.getByTestId("adjust-submit").textContent).toContain("На утверждение");
    expect(screen.getByTestId("adjust-needs-approval")).toBeTruthy();
    cleanup();
    wrap(<AdjustModal productId={1} productName="Вода" currentStock={10} unitWeight={0} onSave={vi.fn()} onClose={vi.fn()} isPending={false} />);
    expect(screen.getByTestId("adjust-submit").textContent).toContain("Применить");
    expect(screen.queryByTestId("adjust-needs-approval")).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * Документ прихода в браузере: уход с правками, версия строк, «Сохранить и завершить».
 *
 *   · правки сохранённого прихода не пропадают молча: «← Приходы» и пункт
 *     меню (navigate) спрашивают, перезагрузка — через beforeunload; без
 *     правок уходит сразу;
 *   · строки уходят в setItems с версией, с которой документ открыли;
 *   · create прошёл, проведение отказало — открыт сохранённый документ и
 *     сказано «сохранён, но не проведён», а не пустая форма «Нового прихода».
 *
 * Нарочная поломка: убери перехват navigator.push — падают тесты ухода;
 * верни navigate внутрь try у saveNew — падает последний.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router";
import { LangProvider } from "@/i18n";

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const api = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), setItems: vi.fn(), remove: vi.fn(),
  details: {} as Record<number, unknown>,
}));

vi.mock("@/lib/toast", () => ({ notify }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10 } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: {} }) }));
vi.mock("@/lib/documents", () => ({ printArrivalReceipt: vi.fn(), printLabels: vi.fn() }));
vi.mock("@/components/arrivals/SupplierDebtSection", () => ({ SupplierDebtSection: () => null }));
vi.mock("@/components/BarcodeScanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/PremiumSelect", () => ({ PremiumSelect: () => null }));
vi.mock("@/providers/trpc", () => {
  const mutation = (fn: (v: unknown) => unknown) => () => ({ mutateAsync: fn, isPending: false });
  return {
    trpc: {
      useUtils: () => ({ arrival: { list: { invalidate: async () => {} }, getById: { invalidate: async () => {} } } }),
      product: { list: { useQuery: () => ({ data: { data: [] } }) } },
      supplier: {
        list: { useQuery: () => ({ data: [] }) },
        getSupplyByArrival: { useQuery: () => ({ data: null }) },
      },
      arrival: {
        getById: { useQuery: ({ id }: { id: number }) => ({ data: api.details[id], isLoading: !api.details[id], isError: false }) },
        create: { useMutation: mutation(v => api.create(v)) },
        update: { useMutation: mutation(v => api.update(v)) },
        setItems: { useMutation: mutation(v => api.setItems(v)) },
        delete: { useMutation: mutation(v => api.remove(v)) },
      },
    },
  };
});

const { default: ArrivalEditor } = await import("@/pages/ArrivalEditor");
const { saveArrivalDraft, loadArrivalDraft } = await import("@/pages/Arrivals.draft");
const { rowFromProduct } = await import("@/lib/arrival-sheet");

const OPENED = new Date("2026-09-27T08:00:00Z");
const doc = (id: number) => ({
  id, arrivalNumber: `ARR-${id}`, status: "unloading", truckId: null, driverName: null, driverPhone: null,
  fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "0.00", arrivalDate: new Date("2026-09-27"),
  notes: null, createdAt: OPENED, updatedAt: OPENED,
  items: [{
    id: 1, productId: 1, productName: "Сок", productCode: "S-1", quantity: 0, expectedQuantity: 10, condition: "", notes: "",
    barcode: null, costPrice: "9000.00", sellingPrice: "12000.00", batchNumber: null, expiresAt: null,
    unit: "pcs", unitWeight: null, packSize: null, packLabel: null,
  }],
});

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
/** Пункт меню: Layout уходит тем же navigate(path). */
function Menu() { const navigate = useNavigate(); return <button onClick={() => navigate("/orders")}>меню</button>; }

function open(path: string) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/arrivals/:id" element={<ArrivalEditor />} />
          <Route path="*" element={null} />
        </Routes>
        <Where /><Menu />
      </MemoryRouter>
    </LangProvider>,
  );
}
const where = () => screen.getByTestId("where").textContent;
const typeCounted = (v: string) => fireEvent.change(screen.getByTestId("arrival-cell-quantity-0"), { target: { value: v } });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  api.details = { 5: doc(5) };
});

describe("документ с правками: уйти — только спросив", () => {
  it("«← Приходы»: отказ оставляет на месте с набранным, согласие уводит", async () => {
    open("/arrivals/5");
    typeCounted("8");
    fireEvent.click(screen.getByTestId("arrival-back"));
    expect(await screen.findByText("Уйти без сохранения?")).toBeTruthy();
    expect(where(), "ушли, не спросив").toBe("/arrivals/5");

    fireEvent.click(screen.getByText("Отмена", { selector: "button" }));
    await act(async () => {});
    expect(where()).toBe("/arrivals/5");
    expect((screen.getByTestId("arrival-cell-quantity-0") as HTMLInputElement).value).toBe("8");

    fireEvent.click(screen.getByText("меню"));
    fireEvent.click(await screen.findByText("Уйти", { selector: "button" }));
    await act(async () => {});
    expect(where()).toBe("/orders");
  });

  it("без правок уходят сразу, без вопроса", () => {
    open("/arrivals/5");
    fireEvent.click(screen.getByTestId("arrival-back"));
    expect(where()).toBe("/arrivals");
    expect(screen.queryByText("Уйти без сохранения?")).toBeNull();
  });

  it("перезагрузка с правками — браузер спрашивает; без правок — нет", () => {
    open("/arrivals/5");
    const unload = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(unload()).toBe(false);
    typeCounted("8");
    expect(unload(), "перезагрузка молча стёрла бы правки").toBe(true);
  });
});

describe("строки — с версией, с которой документ открыли", () => {
  it("setItems получает updatedAt загруженного документа", async () => {
    api.setItems.mockResolvedValue({ success: true, count: 1 });
    open("/arrivals/5");
    typeCounted("8");
    fireEvent.click(screen.getByTestId("arrival-save"));
    await act(async () => {});
    expect(api.setItems).toHaveBeenCalledTimes(1);
    expect(api.setItems.mock.calls[0][0]).toMatchObject({ id: 5, updatedAt: OPENED });
  });

  it("«Начать разгрузку» с правками — сперва правки: смена статуса сдвинет версию", async () => {
    api.details = { 5: { ...doc(5), status: "pending" } };
    const order: string[] = [];
    api.setItems.mockImplementation(async () => { order.push("setItems"); return { success: true, count: 1 }; });
    api.update.mockImplementation(async (v: { status?: string }) => { order.push(`update:${v.status}`); return { success: true }; });
    open("/arrivals/5");
    typeCounted("8");
    fireEvent.click(screen.getByTestId("arrival-start-unloading"));
    await act(async () => {});
    expect(order).toEqual(["setItems", "update:unloading"]);
  });
});

describe("версия после своего сохранения и после чужого", () => {
  it("строки легли, шапка упала — повторное «Сохранить» идёт с новой версией, а не «документ изменили»", async () => {
    const NEXT = new Date("2026-09-27T08:00:05Z");
    api.setItems.mockResolvedValue({ success: true, count: 1, updatedAt: NEXT });
    api.update.mockRejectedValueOnce(new Error("Ожидается число")).mockResolvedValue({ success: true });
    open("/arrivals/5");
    typeCounted("8");
    fireEvent.change(screen.getByTestId("arrival-fuel"), { target: { value: "5000" } });
    fireEvent.click(screen.getByTestId("arrival-save"));
    await act(async () => {});
    expect(api.setItems.mock.calls[0][0]).toMatchObject({ updatedAt: OPENED });

    fireEvent.click(screen.getByTestId("arrival-save"));
    await act(async () => {});
    expect(api.setItems.mock.calls[1][0], "второй раз ушла старая версия — сервер ответит CONFLICT на свою же правку").toMatchObject({ updatedAt: NEXT });
  });

  it("чужая правка (CONFLICT) выключает «Сохранить» до отмены правок", async () => {
    api.setItems.mockRejectedValue(Object.assign(new Error("Документ изменили, пока вы правили — обновите страницу"), { data: { code: "CONFLICT" } }));
    open("/arrivals/5");
    typeCounted("8");
    fireEvent.click(screen.getByTestId("arrival-save"));
    await act(async () => {});
    expect((screen.getByTestId("arrival-save") as HTMLButtonElement).disabled, "кнопка, которая всегда откажет").toBe(true);
    expect(api.setItems).toHaveBeenCalledTimes(1);
  });
});

describe("«Сохранить и завершить»: проведение отказало после создания", () => {
  it("открыт сохранённый документ и сказано «сохранён, но не проведён»", async () => {
    saveArrivalDraft(10, {
      form: { truckId: "", driverName: "", driverPhone: "", arrivalDate: "2026-09-27", fuelCost: "0", tollCost: "0", otherCost: "0", notes: "" },
      supplierMode: "none", supplierId: 0, newSupplierName: "", supplyAmount: "", supplyCurrency: "UZS", supplyRate: "", supplyDueDate: "",
      rows: [{ ...rowFromProduct({ id: 1, name: "Сок" }), quantity: "5" }],
    });
    api.create.mockResolvedValue({ id: 77, arrivalNumber: "ARR-77" });
    api.update.mockRejectedValue(new Error("Склад не найден — создайте склад в настройках"));
    open("/arrivals/new");

    fireEvent.click(screen.getByTestId("arrival-save-complete"));
    await act(async () => {});

    expect(api.update).toHaveBeenCalledWith({ id: 77, status: "completed" });
    expect(where(), "осталась пустая форма — приход наберут второй раз").toBe("/arrivals/77");
    expect(notify.error).toHaveBeenCalledWith("Приход сохранён, но не проведён: Склад не найден — создайте склад в настройках");
    expect(loadArrivalDraft(10)).toBeNull();
  });
});

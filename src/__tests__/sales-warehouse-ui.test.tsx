// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { catalogScope, sellableWarehouses } from "@/lib/sales-warehouse";

/**
 * Продажи с нескольких складов (ADR 0012) — экраны директора.
 *
 *   · «Настройки → Склады»: склад, кроме основного, отмечается точкой
 *     продаж одной кнопкой (warehouseMulti.update isSalesPoint);
 *   · «Пользователи»: сотруднику, который продаёт, назначают точку продаж;
 *     «Основной» снимает назначение (null), курьеру выбирать нечего;
 *   · выбор склада в заказе — только среди складов, с которых продают, и
 *     только когда их больше одного;
 *   · каталог мастера спрашивает тем же доводом, что уйдёт в заказ.
 *
 * Нарочная поломка:
 *   · в WarehouseSettings шли isSalesPoint без «!» — падает «отметить и снять»;
 *   · в UserRow отдай Number(v) вместо null для «Основного» — падает
 *     «Основной снимает назначение»;
 *   · в sellableWarehouses убери проверку статуса — падает «отключённый не
 *     продаёт».
 */

Element.prototype.scrollIntoView = () => {};

type Wh = { id: number; name: string; isDefault: boolean; isSalesPoint: boolean; status: string; address: string | null; city: string | null };
const h = vi.hoisted(() => ({
  warehouses: [] as Wh[],
  updates: [] as unknown[],
}));

vi.mock("@/providers/trpc", () => {
  const query = (data: () => unknown) => () => ({ data: data(), isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    trpc: {
      warehouseMulti: {
        list: { useQuery: query(() => h.warehouses) },
        create: { useMutation: mutation },
        setDefault: { useMutation: mutation },
        update: { useMutation: () => ({ mutate: (v: unknown) => { h.updates.push(v); }, isPending: false }) },
      },
      settings: {
        get: { useQuery: query(() => ({ costMethod: "last" })) },
        update: { useMutation: mutation },
      },
      useUtils: () => ({ warehouseMulti: { list: { invalidate: vi.fn() } }, settings: { get: { invalidate: vi.fn() } } }),
    },
  };
});
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { WarehouseSettings } = await import("@/components/settings/WarehouseSettings");
const { SalesWarehousePicker } = await import("@/components/orders/SalesWarehousePicker");
const { UserTable } = await import("@/components/users/UserTable");

const MAIN: Wh = { id: 1, name: "Основной", isDefault: true, isSalesPoint: false, status: "active", address: null, city: null };
const BRANCH: Wh = { id: 2, name: "Филиал", isDefault: false, isSalesPoint: true, status: "active", address: null, city: null };
const STORE: Wh = { id: 3, name: "Хранение", isDefault: false, isSalesPoint: false, status: "active", address: null, city: null };
const OFF: Wh = { id: 4, name: "Закрытый", isDefault: false, isSalesPoint: true, status: "inactive", address: null, city: null };

const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);
const pick = (combo: HTMLElement, label: string) => {
  fireEvent.click(combo);
  fireEvent.click(screen.getAllByRole("option").find(o => o.textContent?.includes(label))!);
};

beforeEach(() => {
  localStorage.clear();
  h.warehouses = [MAIN, BRANCH, STORE, OFF];
  h.updates = [];
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("правило склада продажи на экране", () => {
  it("продают с основного и действующих точек продаж; отключённый и склад хранения — нет", () => {
    expect(sellableWarehouses([MAIN, BRANCH, STORE, OFF]).map(w => w.id)).toEqual([1, 2]);
    expect(sellableWarehouses(undefined)).toEqual([]);
  });

  it("каталог мастера спрашивает тем же доводом, что уйдёт в заказ", () => {
    // Агенту выбирать нельзя — и чужой склад он не подсмотрит.
    expect(catalogScope({ role: "agent", userId: 5, agentId: 0, warehouseId: 2 })).toEqual({});
    // Офис выбрал склад — агент заказа ни при чём.
    expect(catalogScope({ role: "operator", userId: 5, agentId: 9, warehouseId: 2 })).toEqual({ warehouseId: 2 });
    // Супервайзер склад не выбирает, но оформляет на агента — склад агента.
    expect(catalogScope({ role: "supervisor", userId: 5, agentId: 9, warehouseId: 2 })).toEqual({ agentId: 9 });
    // На себя — довода нет, ключ кэша прежний.
    expect(catalogScope({ role: "ceo", userId: 5, agentId: 5, warehouseId: 0 })).toEqual({});
  });
});

describe("Настройки → Склады: точка продаж", () => {
  it("отметить и снять — одной кнопкой; у основного и отключённого кнопки нет", () => {
    show(<WarehouseSettings />);
    expect(screen.getByTestId("sales-point-badge-2").textContent).toBe("Точка продаж");
    expect(screen.queryByTestId("sales-point-toggle-1")).toBeNull();
    expect(screen.queryByTestId("sales-point-toggle-4")).toBeNull();

    const store = screen.getByTestId("sales-point-toggle-3");
    expect(store.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(store);
    const branch = screen.getByTestId("sales-point-toggle-2");
    expect(branch.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(branch);
    expect(h.updates).toEqual([{ id: 3, isSalesPoint: true }, { id: 2, isSalesPoint: false }]);
  });
});

describe("выбор склада в заказе", () => {
  it("один склад продаж — выбора нет", () => {
    h.warehouses = [MAIN, STORE, OFF];
    const { container } = show(<SalesWarehousePicker value={0} onChange={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("только склады, с которых продают; выбор отдаёт номер склада", () => {
    const onChange = vi.fn();
    show(<SalesWarehousePicker value={0} onChange={onChange} />);
    const combo = within(screen.getByTestId("sales-warehouse-picker")).getByRole("combobox");
    fireEvent.click(combo);
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual(["Склад агента заказа", "Основной (основной)", "Филиал"]);
    fireEvent.click(screen.getAllByRole("option").find(o => o.textContent === "Филиал")!);
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

describe("Пользователи: склад продаж сотрудника", () => {
  const users = [
    { id: 10, name: "Агент филиала", email: "a@test.local", role: "agent", status: "active", warehouseId: 2 },
    { id: 11, name: "Агент", email: "b@test.local", role: "agent", status: "active", warehouseId: null },
    { id: 12, name: "Курьер", email: "c@test.local", role: "courier", status: "active", warehouseId: null },
  ];
  const table = (salesWarehouse?: Parameters<typeof UserTable>[0]["salesWarehouse"]) => show(
    <UserTable users={users} isLoading={false} page={1} total={3} lang="ru"
      onResetPassword={() => {}} onDeactivate={() => {}} onReactivate={() => {}} onPageChange={() => {}}
      salesWarehouse={salesWarehouse} />,
  );

  it("нет точек продаж — нет и колонки", () => {
    table(undefined);
    expect(screen.queryByText("СКЛАД ПРОДАЖ")).toBeNull();
  });

  it("назначить точку продаж; «Основной» снимает назначение; курьеру выбирать нечего", () => {
    const onChange = vi.fn();
    table({ options: [{ id: 2, name: "Филиал" }], onChange });
    expect(screen.getByText("СКЛАД ПРОДАЖ")).toBeTruthy();
    expect(within(screen.getByTestId("user-warehouse-10")).getByRole("combobox").textContent).toContain("Филиал");
    expect(within(screen.getByTestId("user-warehouse-12")).queryByRole("combobox")).toBeNull();

    pick(within(screen.getByTestId("user-warehouse-11")).getByRole("combobox"), "Филиал");
    pick(within(screen.getByTestId("user-warehouse-10")).getByRole("combobox"), "Основной");
    expect(onChange.mock.calls).toEqual([[11, 2], [10, null]]);
  });
});

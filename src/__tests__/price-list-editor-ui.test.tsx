// @vitest-environment jsdom
/**
 * Страница прайс-листа в браузере.
 *
 *   · сетка открыта ценами: пустая клетка показывает цену по правилу;
 *     вписанная цена — в «Изменено», «Сохранить» шлёт только изменённое;
 *   · «найденным −10 %» ставит цену всем найденным поиском;
 *   · магазины: видно, в каком списке магазин сейчас и что он оттуда уйдёт;
 *     «Сохранить магазины» шлёт полный набор отмеченных.
 *
 * Нарочная поломка: в onSavePrices передай rows вместо pending — падает
 * первый тест (уходят все товары каталога).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";

const stub = vi.hoisted(() => {
  const state = {
    detail: {
      id: 5, name: "Опт −7", priority: 1, isActive: true, markupPct: "-7.00",
      items: [{ id: 1, productId: 2, productName: "Вода", productCode: "W", price: "2500.00", minQuantity: "1.00", unitPrice: "3000.00" }],
      assignments: [{ id: 1, shopId: 10, shopName: "Альфа" }],
    },
    setItems: vi.fn(async (_v: unknown) => ({ success: true, set: 1, cleared: 0 })),
    setShops: vi.fn(async (_v: unknown) => ({ success: true, added: 1, removed: 0, moved: 1 })),
    invalidate: vi.fn(async () => {}),
  };
  const q = (get: () => unknown) => () => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  const mut = (fn: (v: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, mutate: (v: unknown) => void fn(v), isPending: false });
  const inv = { invalidate: state.invalidate };
  return {
    state,
    trpc: {
      priceList: {
        getById: { useQuery: q(() => state.detail) },
        list: { useQuery: q(() => [{ id: 5, name: "Опт −7" }, { id: 6, name: "VIP" }]) },
        shopMap: { useQuery: q(() => [{ shopId: 10, priceListId: 5 }, { shopId: 11, priceListId: 6 }]) },
        setItems: { useMutation: mut(v => state.setItems(v)) },
        setShops: { useMutation: mut(v => state.setShops(v)) },
        update: { useMutation: mut(async () => ({ success: true })) },
        delete: { useMutation: mut(async () => ({ success: true })) },
        upsertItem: { useMutation: mut(async () => ({ success: true })) },
        removeItem: { useMutation: mut(async () => ({ success: true })) },
      },
      product: { list: { useQuery: q(() => ({ data: [
        { id: 1, name: "Сок яблочный", code: "S-1", category: "Напитки", costPrice: "8000", unitPrice: "12000" },
        { id: 2, name: "Вода", code: "W", category: "Напитки", costPrice: "2000", unitPrice: "3000" },
        { id: 3, name: "Сок вишнёвый", code: "S-2", category: "Напитки", costPrice: "0", unitPrice: "15000" },
      ] })) } },
      shop: { list: { useQuery: q(() => ({ data: [{ id: 10, name: "Альфа", city: "Ургенч" }, { id: 11, name: "Бета", city: "Хива" }] })) } },
      useUtils: () => ({ priceList: { getById: inv, list: inv, shopMap: inv, forShop: inv }, product: inv }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const { default: PriceListEditor } = await import("@/pages/PriceListEditor");

const show = () => render(
  <LangProvider>
    <MemoryRouter initialEntries={["/price-lists/5"]}>
      <Routes><Route path="/price-lists/:id" element={<PriceListEditor />} /></Routes>
    </MemoryRouter>
  </LangProvider>,
);
const cell = (id: number) => screen.getByTestId(`price-cell-${id}`) as HTMLInputElement;
beforeEach(() => { stub.state.setItems.mockClear(); stub.state.setShops.mockClear(); });
afterEach(cleanup);

describe("цены", () => {
  it("пустая клетка — цена по правилу; сохраняется только изменённое", async () => {
    show();
    expect(cell(1).placeholder).toBe("11160");
    expect(cell(2).value).toBe("2500");
    fireEvent.change(cell(1), { target: { value: "11000" } });
    expect(screen.getByTestId("price-grid-pending").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("price-grid-save"));
    await waitFor(() => expect(stub.state.setItems).toHaveBeenCalledWith({ priceListId: 5, items: [{ productId: 1, price: 11000 }] }));
  });

  it("найденным −10 %: поиск «сок» — два товара от карточки", async () => {
    show();
    fireEvent.change(screen.getByTestId("price-grid-search"), { target: { value: "сок" } });
    expect(screen.queryByTestId("price-row-2")).toBeNull();
    fireEvent.change(screen.getByTestId("price-grid-bulk-pct"), { target: { value: "-10" } });
    fireEvent.click(screen.getByTestId("price-grid-bulk-apply"));
    fireEvent.click(screen.getByTestId("price-grid-save"));
    await waitFor(() => expect(stub.state.setItems).toHaveBeenCalledWith({ priceListId: 5, items: [{ productId: 1, price: 10800 }, { productId: 3, price: 13500 }] }));
  });

  it("цена ниже себестоимости — видна до сохранения", () => {
    show();
    fireEvent.change(cell(1), { target: { value: "7000" } });
    expect(cell(1).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("price-margin-1").textContent).toBe("-12.5%");
  });
});

describe("магазины", () => {
  it("видно, откуда магазин уйдёт; сохраняется полный набор отмеченных", async () => {
    show();
    fireEvent.click(screen.getByTestId("price-list-tab-shops"));
    expect(screen.getByTestId("price-shop-11").textContent).toContain("сейчас: VIP");
    fireEvent.click(screen.getByTestId("price-shop-11"));
    expect(screen.getByTestId("price-shop-11").textContent).toContain("уйдёт из «VIP»");
    expect(screen.getByTestId("price-shops-pending").textContent).toContain("перейдут из других списков: 1");
    fireEvent.click(screen.getByTestId("price-shops-save"));
    await waitFor(() => expect(stub.state.setShops).toHaveBeenCalledWith({ priceListId: 5, shopIds: [10, 11] }));
  });
});

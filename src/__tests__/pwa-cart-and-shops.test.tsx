// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

/**
 * Корзина каталога и список магазинов на телефоне — поведение, а не текст.
 *
 * Корзина (lib/catalog-cart.ts) — как в мобилке: у каждого вошедшего своя,
 * единица прибавляется и убавляется, на нуле строка уходит, в мастер заказа
 * уезжает позициями. Магазины (components/phone/ShopBrowser) — «Все
 * магазины» и территории; поиск показывает точки сразу, без лишнего тапа.
 *
 * Нарочная поломка: в addToCart убери удаление строки на нуле — падает
 * «на нуле строка уходит»; в ShopBrowser убери `|| !!search.trim()` у flat —
 * падает «поиск показывает точки сразу».
 */
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));

import { addToCart, loadCart, clearCart, cartToItems } from "@/lib/catalog-cart";
import { ShopBrowser } from "@/components/phone/ShopBrowser";

const MILK = { productId: 7, productName: "Молоко", unitPrice: "12000", available: "40", unit: "pcs", unitWeight: 1 };

beforeEach(() => { localStorage.clear(); cleanup(); });

describe("корзина каталога", () => {
  it("прибавляет и убавляет по единице", () => {
    addToCart(1, MILK, 1);
    addToCart(1, MILK, 1);
    expect(loadCart(1)).toEqual([{ ...MILK, quantity: 2 }]);
    addToCart(1, MILK, -1);
    expect(loadCart(1)[0].quantity).toBe(1);
  });

  it("на нуле строка уходит", () => {
    addToCart(1, MILK, 1);
    addToCart(1, MILK, -1);
    expect(loadCart(1)).toEqual([]);
    // Уходит из хранилища, а не только прячется при чтении: иначе пустая
    // корзина висела бы записью и «В заказе: 0 товаров» было бы делом времени.
    expect(localStorage.getItem("warehouse_pro_catalog_cart:1")).toBeNull();
  });

  it("у каждого вошедшего своя корзина", () => {
    // На складе компьютер бывает общий: чужой набор не должен уехать от твоего имени.
    addToCart(1, MILK, 3);
    expect(loadCart(2)).toEqual([]);
    clearCart(1);
    expect(loadCart(1)).toEqual([]);
  });

  it("в мастер заказа уезжает позициями с количеством строкой", () => {
    addToCart(1, MILK, 2);
    expect(cartToItems(loadCart(1))).toEqual([{
      productId: 7, productName: "Молоко", unitPrice: "12000", quantity: "2", available: "40", unit: "pcs", unitWeight: 1,
    }]);
  });

  it("битая запись не роняет экран", () => {
    localStorage.setItem("warehouse_pro_catalog_cart:1", "{не json");
    expect(loadCart(1)).toEqual([]);
  });
});

const SHOPS = [
  { id: 1, name: "Барака Market", district: "Марказ", debt: "850000", status: "active" },
  { id: 2, name: "Гулистон", district: "Марказ", status: "active" },
  { id: 3, name: "Нодира MCHJ", district: "Ёшлик", status: "active" },
];

describe("магазины на телефоне", () => {
  it("«Все магазины» и территории со счётом", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    const rows = screen.getAllByTestId("phone-territory");
    expect(rows.map(r => r.textContent)).toEqual([
      "Все магазины3 магазина",
      "Ёшлик1 магазин",
      "Марказ2 магазина",
    ]);
    expect(screen.queryAllByTestId("phone-shop-card")).toHaveLength(0);
  });

  it("территория открывает свои точки, «назад» — к территориям", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    fireEvent.click(screen.getAllByTestId("phone-territory")[2]);
    const cards = screen.getAllByTestId("phone-shop-card");
    expect(cards.map(c => within(c).getAllByText(/./)[0].textContent)).toEqual(["Барака Market", "Гулистон"]);
    fireEvent.click(screen.getByLabelText("Назад"));
    expect(screen.getAllByTestId("phone-territory")).toHaveLength(3);
  });

  it("поиск показывает точки сразу, без тапа по территории", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Поиск магазинов…"), { target: { value: "нодира" } });
    expect(screen.queryAllByTestId("phone-territory")).toHaveLength(0);
    expect(screen.getAllByTestId("phone-shop-card")).toHaveLength(1);
  });

  it("нажатие открывает точку, тележка — новый заказ, долг виден на карточке", () => {
    const onOpen = vi.fn(), onOrder = vi.fn();
    render(<ShopBrowser shops={SHOPS} onOpen={onOpen} onOrder={onOrder} />);
    fireEvent.change(screen.getByPlaceholderText("Поиск магазинов…"), { target: { value: "барака" } });
    const card = screen.getByTestId("phone-shop-card");
    expect(card.textContent).toContain((850000).toLocaleString("ru"));
    fireEvent.click(within(card).getByText("Барака Market"));
    expect(onOpen).toHaveBeenCalledWith(1);
    fireEvent.click(within(card).getByLabelText("Новый заказ"));
    expect(onOrder).toHaveBeenCalledWith(1);
  });
});

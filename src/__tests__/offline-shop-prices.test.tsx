// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { LangProvider } from "@/i18n";
import { saveOfflineCopy, loadOfflineCopy, setSessionOwner } from "@/lib/offline-copy";

/**
 * Цены магазина без связи — копией по каждому магазину.
 *
 * Мастер заказа и список товаров брали цены магазина только из живого
 * product.listAll({ shopId }), а копия каталога была одна на всех — «того
 * магазина, где заказывали последним». После перезагрузки без связи строки
 * шли по цене одной штуки мимо ступеней, а другой магазин и витрина видели
 * чужие цены. Здесь — настоящий ProductSelector и настоящий хук копий,
 * подменён только сервер.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · в useOfflineCopy верни копию без сверки tag — «смена магазина: копия
 *     прежнего не мелькает»;
 *   · в ProductSelector верни `catalog = products ?? copy` без цен магазина —
 *     «без связи список и строка — по цене этого магазина»;
 *   · пиши в общую копию products вместо cardPriced — «общая копия — по
 *     карточке»;
 *   · в loadOfflineCopy отдай общую копию как есть, без atCardPrice — оба
 *     теста «копия прежней версии…» (выбор товаров и каталог).
 */

type Row = { id: number; code: string; barcode: string | null; name: string; unitPrice: string; basePrice: string; unit: string; available: string; unitWeight: number; photoUrl: null; priceListId: number | null; tiers: Array<{ minQuantity: string; price: string; priority: number }> | null };

const h = vi.hoisted(() => ({ live: undefined as undefined | unknown[] }));
vi.mock("@/providers/trpc", () => ({
  trpc: { product: { listAll: { useQuery: () => ({ data: h.live, isLoading: false, isLoadingError: h.live === undefined }) } } },
}));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// Каталогу нужен только номер вошедшего — под ним лежит его корзина.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));

const { ProductSelector } = await import("@/components/orders/ProductSelector");
const { useOfflineCopy } = await import("@/hooks/useOfflineCopy");
const { default: Catalog } = await import("@/pages/Catalog");
const { MemoryRouter } = await import("react-router");

const TIERS = [{ minQuantity: "1.00", price: "10000.00", priority: 0 }, { minQuantity: "10.00", price: "8500.00", priority: 0 }];
// Ответ сервера для магазина 5: цена прайс-листа и ступень, карточка — 12 000.
const SHOP5: Row[] = [
  { id: 1, code: "A-1", barcode: null, name: "Молоко", unitPrice: "10000.00", basePrice: "12000.00", unit: "pcs", available: "40", unitWeight: 1, photoUrl: null, priceListId: 3, tiers: TIERS },
];

function Harness({ shopId }: { shopId: number }) {
  const [items, setItems] = useState<never[]>([]);
  return (
    <LangProvider>
      <ProductSelector items={items} onChange={setItems as never} shopId={shopId} />
      <pre data-testid="cart-json">{JSON.stringify(items)}</pre>
    </LangProvider>
  );
}

const addByCode = (code: string) => {
  const input = screen.getByTestId("product-search");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
};
const cart = () => JSON.parse(screen.getByTestId("cart-json").textContent ?? "[]") as Array<{ productId: number; unitPrice: string }>;

beforeEach(() => {
  localStorage.clear();
  setSessionOwner(1);
  h.live = undefined;
});
afterEach(cleanup);

describe("список товаров в заказе без связи", () => {
  it("живой ответ ложится в копию: общая — по карточке, цены — в копию магазина", () => {
    h.live = SHOP5;
    render(<Harness shopId={5} />);
    const generic = loadOfflineCopy<Row[]>("catalog", 1)!.data;
    expect(generic[0].unitPrice, "в общую копию легла цена магазина — витрина и другие магазины увидят её").toBe("12000.00");
    expect(generic[0].tiers).toBeNull();
    expect(loadOfflineCopy("shopPrices", 1, 5)?.data).toEqual([{ id: 1, unitPrice: "10000.00", tiers: TIERS }]);
  });

  it("без связи список и строка — по цене этого магазина из его копии", () => {
    h.live = SHOP5;
    render(<Harness shopId={5} />);
    cleanup();

    // Перезагрузка без связи: живого ответа нет, остались копии.
    h.live = undefined;
    render(<Harness shopId={5} />);
    expect(screen.getByTestId("selector-offline-copy")).toBeTruthy();
    expect(screen.getByTestId("product-row-1").textContent, "в списке цена карточки вместо цены магазина").toContain("10000.00");
    addByCode("A-1");
    expect(cart()[0].unitPrice).toBe("10000.00");
  });

  it("магазин без своей копии получает цену карточки, а не цену другого магазина", () => {
    h.live = SHOP5;
    render(<Harness shopId={5} />);
    cleanup();

    h.live = undefined;
    render(<Harness shopId={6} />);
    expect(screen.getByTestId("product-row-1").textContent).not.toContain("10000.00");
    addByCode("A-1");
    expect(cart()[0].unitPrice, "магазину 6 досталась цена магазина 5").toBe("12000.00");
  });
});

describe("копия прежней версии — с ценами последнего магазина", () => {
  /*
    Прежняя версия писала в общую копию ответ с ценами магазина 5: прайс-лист,
    ступени, 10 000 вместо карточных 12 000. Такие копии ещё лежат на
    устройствах. Своей копии цен у магазина 6 нет — и без связи ему, и
    витрине, нельзя ни показать, ни посчитать цену магазина 5.
  */
  // Как есть, мимо нынешнего ProductSelector; живого ответа нет (h.live).
  beforeEach(() => saveOfflineCopy("catalog", 1, SHOP5));

  it("выбор товаров для магазина без своей копии: в списке, строке и итоге — карточка", () => {
    render(<Harness shopId={6} />);
    expect(screen.getByTestId("selector-offline-copy")).toBeTruthy();
    expect(screen.getByTestId("product-row-1").textContent, "в списке цена магазина 5").not.toContain("10000.00");
    expect(screen.getByTestId("product-row-1").textContent).toContain("12000.00");
    addByCode("A-1");
    addByCode("A-1");
    expect(cart(), "в строку корзины легла цена магазина 5").toEqual([expect.objectContaining({ productId: 1, unitPrice: "12000.00" })]);
    expect(document.body.textContent, "итог корзины посчитан по цене магазина 5").toContain("24000.00");
    expect(document.body.textContent).not.toContain("20000.00");
  });

  it("каталог без связи: на карточке и в сумме корзины — карточка", () => {
    render(<MemoryRouter><LangProvider><Catalog /></LangProvider></MemoryRouter>);
    expect(screen.getByTestId("catalog-offline-copy")).toBeTruthy();
    expect(screen.getByTestId("catalog-card-1").textContent, "витрина показывает цену магазина 5").toContain("12000.00");
    fireEvent.click(screen.getByTestId("catalog-add-1"));
    expect(screen.getByTestId("catalog-cart-bar").textContent, "корзина каталога считает по цене магазина 5").toContain("12000");
    expect(screen.getByTestId("catalog-cart-bar").textContent).not.toContain("10000");
  });
});

describe("хук копий", () => {
  it("смена магазина: копия прежнего не мелькает ни на одну отрисовку", () => {
    saveOfflineCopy("shopPrices", 1, ["цены магазина 5"], 5);
    const seen: Array<{ scope: number; data: unknown }> = [];
    const { rerender } = renderHook(({ scope }: { scope: number }) => {
      const r = useOfflineCopy<string[]>("shopPrices", undefined, scope);
      seen.push({ scope, data: r.data });
      return r;
    }, { initialProps: { scope: 5 } });
    expect(seen.at(-1)!.data).toEqual(["цены магазина 5"]);

    rerender({ scope: 6 });
    const leaked = seen.filter(s => s.scope === 6 && s.data !== undefined);
    expect(leaked, "магазин 6 хоть раз отрисовался с ценами магазина 5").toEqual([]);
  });
});

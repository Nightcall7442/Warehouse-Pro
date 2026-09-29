// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Ступени прайс-листа видны до отправки — в каждом окне, где набирают строки.
 *
 * Сервер считает строку по ступени («от 10 — 8500»), а каталог отдаёт цену
 * при одной штуке. Окна показывали цену одной штуки при любом количестве:
 * агент называл магазину 120 000, накладная печаталась на 102 000. В правке
 * состава у офиса было хуже — цена поля уходит на сервер как набранная, и
 * новая строка на 12 штук сохранялась по цене одной, мимо ступени.
 *
 * Окна поднимаются настоящие, подменены только ручки: каталог отдаёт молоко
 * за 10 000 со ступенью «от 10 — 8 500» (tiers), как product.listAll/list
 * с магазином.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · QuickOrderModal: pricedCart берёт p.unitPrice без priceAt — «быстрый
 *     заказ: 12 штук по ступени…»;
 *   · OrderItemsEditor: priced без priceAt (цена одной штуки) — «агент:
 *     новая строка…» и «офис: …уходит ценой ступени»;
 *   · OrderItemsEditor: руками набранная цена не снимает auto — «офис: …
 *     набранная руками не перезаписывается»;
 *   · OrderItemsEditor: auto у всех строк — «строка заказа не переоценивается»;
 *   · ProductSelector: карточка показывает product.unitPrice — «карточка
 *     товара в корзине…».
 */

const h = vi.hoisted(() => {
  const tiers = [
    { minQuantity: "1.00", price: "10000.00", priority: 0 },
    { minQuantity: "10.00", price: "8500.00", priority: 0 },
  ];
  const catalog = [
    { id: 7, code: "M-7", barcode: null, name: "Молоко", unitPrice: "10000.00", unit: "pcs", available: "100", unitWeight: 1, photoUrl: null, tiers },
    { id: 8, code: "S-8", barcode: null, name: "Сок", unitPrice: "3000.00", unit: "pcs", available: "100", unitWeight: 1, photoUrl: null, tiers: null },
  ];
  return { catalog, role: "agent", create: vi.fn(), update: vi.fn() };
});

vi.mock("@/providers/trpc", () => ({
  trpc: {
    agent: { availableShops: { useQuery: () => ({ data: [{ id: 1, name: "Хумо", ownerName: null, district: null, city: null, debt: "0.00" }] }) } },
    product: {
      listAll: { useQuery: () => ({ data: h.catalog, isLoading: false }) },
      list: { useQuery: () => ({ data: { data: h.catalog } }) },
    },
    order: {
      create: { useMutation: () => ({ mutate: h.create, isPending: false }) },
      updateItems: { useMutation: () => ({ mutate: h.update, isPending: false }) },
    },
    priceList: { forShop: { useQuery: () => ({ data: { current: null, lists: [] } }) } },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: h.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// Выпадающий список — родным <select>: проверяется окно, а не список.
vi.mock("@/components/PremiumSelect", async () => {
  const { createElement: el } = await import("react");
  return {
    PremiumSelect: ({ value, onChange, options, "aria-label": label }: {
      value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; "aria-label"?: string;
    }) => el("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
      options.map(o => el("option", { key: o.value, value: o.value }, o.label))),
  };
});

const { QuickOrderModal } = await import("@/components/orders/QuickOrderModal");
const { OrderItemsEditor } = await import("@/components/orders/OrderItemsEditor");
const { ProductSelector } = await import("@/components/orders/ProductSelector");

afterEach(() => { cleanup(); h.role = "agent"; h.create.mockReset(); h.update.mockReset(); });

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("быстрый заказ: ступени", () => {
  it("12 штук по ступени, обратно ниже порога — по цене одной; «Итого» следом", () => {
    render(<LangProvider><QuickOrderModal open onOpenChange={() => {}} preselectedShopId={1} /></LangProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Молоко/ }));
    const qty = screen.getByLabelText("Количество");

    type(qty, "12");
    expect(document.body.textContent, "12 штук посчитаны по цене одной").toMatch(/8\s500 × 12/);
    expect(document.body.textContent).toMatch(/Итого\s*102\s000 UZS/);
    // И в списке товаров слева — цена строки, как в корзине справа.
    expect(screen.getByRole("button", { name: /Молоко/ }).textContent, "в списке товаров цена одной штуки, в корзине — ступени").toMatch(/8\s500/);

    type(qty, "5");
    expect(document.body.textContent).toMatch(/10\s000 × 5/);
    expect(document.body.textContent).toMatch(/Итого\s*50\s000 UZS/);
  });
});

type Line = { id: number; productId: number; productName: string; quantity: string; unitPrice: string; unit: string };
function editor(items: Line[] = []) {
  render(<LangProvider><OrderItemsEditor orderId={42} shopId={1} priceListId={null} items={items} onSaved={() => {}} /></LangProvider>);
  fireEvent.click(screen.getByText("Изменить состав"));
}
const addMilk = () => type(screen.getByLabelText("Добавить товар"), "7");
const save = () => fireEvent.click(screen.getByText("Сохранить состав"));
const sent = (call: number) => (h.update.mock.calls[call][0] as { items: unknown[] }).items;

describe("правка состава: новая строка идёт за ступенью", () => {
  it("агент: новая строка на 12 штук — по ступени, и сумма позиций тоже", () => {
    editor();
    addMilk();
    type(screen.getByLabelText("Количество: Молоко"), "12");
    expect(screen.getByLabelText("Цена: Молоко").textContent, "агент видит цену одной штуки, а заказ ляжет по ступени").toBe("8500");
    expect(screen.getByText("Сумма позиций").parentElement!.textContent).toContain("102000");

    type(screen.getByLabelText("Количество: Молоко"), "3");
    expect(screen.getByLabelText("Цена: Молоко").textContent).toBe("10000");
  });

  it("офис: нетронутая цена показана по ступени и уходит без цены — её назначит сервер; набранная руками не перезаписывается", () => {
    h.role = "operator";
    editor();
    addMilk();
    type(screen.getByLabelText("Количество: Молоко"), "12");
    const price = screen.getByLabelText("Цена: Молоко") as HTMLInputElement;
    expect(price.value).toBe("8500");
    save();
    expect(sent(0), "нетронутая цена ушла ручной — сервер не запишет прайс-лист").toEqual([{ productId: 7, quantity: 12 }]);

    type(price, "9000");
    type(screen.getByLabelText("Количество: Молоко"), "20");
    expect(price.value, "набранную офисом цену затёрла ступень").toBe("9000");
    save();
    expect(sent(1)).toEqual([{ productId: 7, quantity: 20, unitPrice: "9000" }]);
  });

  it("строка заказа не переоценивается: сервер оставляет ей прежнюю цену", () => {
    editor([{ id: 1, productId: 7, productName: "Молоко", quantity: "2", unitPrice: "10000.00", unit: "pcs" }]);
    type(screen.getByLabelText("Количество: Молоко"), "12");
    expect(screen.getByLabelText("Цена: Молоко").textContent, "экран обещает цену, которую сервер строке не даст").toBe("10000");
  });
});

describe("мастер: карточка каталога", () => {
  it("карточка товара в корзине — с ценой строки, а не одной штуки", () => {
    render(
      <LangProvider>
        <ProductSelector shopId={1} onChange={() => {}} items={[
          { productId: 7, productName: "Молоко", unitPrice: "8500.00", quantity: "12", available: "100", unit: "pcs", unitWeight: 1 },
        ]} />
      </LangProvider>,
    );
    expect(within(screen.getByTestId("product-row-7")).getByText(/\/шт/).textContent, "карточка спорит с корзиной").toContain("8500.00");
    expect(within(screen.getByTestId("product-row-8")).getByText(/\/шт/).textContent).toContain("3000.00");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * «Повторить» и «Новый заказ» из карточек — в окно быстрого заказа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Телефонный заказ почти всегда «как в прошлый раз», а оператор набирал
 * позиции заново: в карточке заказа повторить было нечем, из карточки магазина
 * нельзя было даже начать заказ.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящие кнопки и настоящее окно (QuickOrderHost → QuickOrderModal);
 * подменены только ручки. Черновик сервера (order.repeatDraft) — магазин
 * «Хумо», которого нет среди первых строк поиска, молоко 12 шт при 5 на
 * складе и снятый с продажи «Айран».
 *   · «Повторить» открывает окно с этим магазином и строками, называет
 *     снятый товар и помечает нехватку; заказ уходит обычным order.create;
 *   · «Новый заказ» из магазина — окно с магазином и пустой корзиной, и
 *     корзина прошлого окна в него не переезжает;
 *   · «Повторить последний» спрашивает черновик по магазину; у магазина без
 *     заказов окно всё равно открывается — с магазином.
 *
 * Нарочные поломки (каждая роняет свой тест):
 *   · в QuickOrderModal верни useState(null) для pickedShop — «Шаг 2» без
 *     имени магазина: падает «Повторить»;
 *   · в QuickOrderModal верни корзину initialItem ? [initialItem] : [] без
 *     start.lines — падают оба повтора;
 *   · убери key={session.key} у окна в QuickOrderHost — падает «открытие
 *     поверх открытого» (окно остаётся с корзиной прошлого повтора);
 *   · убери пометку нехватки (quick-order-short) — падает «Повторить».
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  draftQuery: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const DRAFT = {
  shop: { id: 5, name: "Хумо" },
  source: { id: 42, orderNumber: "№42", createdAt: new Date("2026-09-20T10:00:00Z") },
  lines: [
    { productId: 7, name: "Молоко", code: "M-7", unit: "pcs", quantity: "12.00", unitPrice: "8500.00", available: "5.00" },
    { productId: 8, name: "Сок", code: "S-8", unit: "pcs", quantity: "3.00", unitPrice: "3000.00", available: "40.00" },
  ],
  skipped: [{ productId: 9, name: "Айран", quantity: "4.00" }],
  lastTime: [],
};

vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ client: { order: { repeatDraft: { query: h.draftQuery } } } }),
    // Первые строки поиска — другие магазины: «Хумо» попадает в окно только закреплённым.
    agent: { availableShops: { useQuery: () => ({ data: [{ id: 1, name: "Барака", ownerName: null, district: null, city: null, debt: "0.00" }] }) } },
    product: {
      listAll: { useQuery: () => ({ data: [
        { id: 7, code: "M-7", barcode: null, name: "Молоко", unitPrice: "10000.00", available: "5", tiers: [
          { minQuantity: "1.00", price: "10000.00", priority: 0 }, { minQuantity: "10.00", price: "8500.00", priority: 0 },
        ] },
        { id: 8, code: "S-8", barcode: null, name: "Сок", unitPrice: "3000.00", available: "40", tiers: null },
      ] }) },
    },
    order: { create: { useMutation: () => ({ mutate: h.create, isPending: false }) } },
    priceList: { forShop: { useQuery: () => ({ data: { current: null, lists: [] } }) } },
  },
}));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: h.error, success: vi.fn(), info: h.info } }));
vi.mock("@/components/PremiumSelect", async () => {
  const { createElement: el } = await import("react");
  return {
    PremiumSelect: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) =>
      el("select", { value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
        options.map(o => el("option", { key: o.value, value: o.value }, o.label))),
  };
});

const { RepeatOrderButton, ShopOrderButtons } = await import("@/components/orders/RepeatOrderButtons");
const { QuickOrderHost } = await import("@/components/orders/QuickOrderHost");
const { closeQuickOrder, openQuickOrder } = await import("@/lib/quick-order");

beforeEach(() => {
  h.draftQuery.mockReset().mockResolvedValue(DRAFT);
  h.create.mockReset();
  h.info.mockReset();
  h.error.mockReset();
});
afterEach(() => { act(() => closeQuickOrder()); cleanup(); });

const page = (buttons: React.ReactNode) => render(<LangProvider>{buttons}<QuickOrderHost /></LangProvider>);
const dialog = () => screen.findByRole("dialog");

describe("карточка заказа: «Повторить»", () => {
  it("окно с магазином и строками повтора; снятый товар назван, нехватка помечена; заказ — обычным create", async () => {
    page(<RepeatOrderButton orderId={42} />);
    fireEvent.click(screen.getByTestId("order-repeat"));

    const w = await dialog();
    expect(h.draftQuery).toHaveBeenCalledWith({ orderId: 42 });
    expect(within(w).getByTestId("quick-order-repeat-note").textContent).toContain("№42");
    expect(within(w).getByTestId("quick-order-skipped").textContent, "снятый с продажи товар молча пропал").toContain("Айран (4)");
    // Строки в корзине, цена — по ступени текущего каталога.
    expect(within(w).getByText(/Корзина/).textContent).toContain("(2)");
    expect(w.textContent).toMatch(/8\s500 × 12/);
    expect(w.textContent).toMatch(/3\s000 × 3/);
    expect(within(w).getByTestId("quick-order-short-7").textContent, "12 при 5 на складе — без пометки").toContain("5");
    expect(within(w).queryByTestId("quick-order-short-8")).toBeNull();

    // Магазин выбран — «Далее» открыт, на втором шаге его имя.
    fireEvent.click(within(w).getByText("Далее"));
    expect(w.textContent, "магазин повтора не выбран в окне").toContain("Хумо");
    fireEvent.click(within(w).getByText("Создать заказ"));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({
      shopId: 5,
      items: [{ productId: 7, quantity: 12 }, { productId: 8, quantity: 3 }],
    });
  });

  it("чужой заказ — отказ сервера словами, окно не открывается", async () => {
    h.draftQuery.mockRejectedValue(new Error("Этот заказ оформил другой сотрудник."));
    page(<RepeatOrderButton orderId={43} />);
    fireEvent.click(screen.getByTestId("order-repeat"));
    await vi.waitFor(() => expect(h.error).toHaveBeenCalledWith("Этот заказ оформил другой сотрудник."));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("карточка магазина", () => {
  it("«Новый заказ» — окно с магазином и пустой корзиной; корзина прошлого окна не переезжает", async () => {
    page(<ShopOrderButtons shop={{ id: 5, name: "Хумо" }} />);
    // Сначала повтор — в корзине две строки.
    fireEvent.click(screen.getByTestId("shop-repeat-last"));
    expect(within(await dialog()).getByText(/Корзина/).textContent).toContain("(2)");
    act(() => closeQuickOrder());

    fireEvent.click(screen.getByTestId("shop-new-order"));
    const w = await dialog();
    expect(within(w).getByText(/Корзина/).textContent, "новое окно открылось с корзиной прошлого").toContain("(0)");
    expect(within(w).queryByTestId("quick-order-repeat-note")).toBeNull();
    // Магазин выбран и стоит в списке, хотя поиск его не вернул.
    expect(within(w).getByRole("button", { name: /Хумо/ })).toBeTruthy();
  });

  it("открытие поверх открытого окна начинает с чистого листа", async () => {
    page(<ShopOrderButtons shop={{ id: 5, name: "Хумо" }} />);
    fireEvent.click(screen.getByTestId("shop-repeat-last"));
    expect(within(await dialog()).getByText(/Корзина/).textContent).toContain("(2)");
    // Не закрывая: открыть окно другому магазину (N или кнопка другой карточки).
    act(() => openQuickOrder({ shop: { id: 1, name: "Барака" } }));
    const w = await dialog();
    expect(within(w).getByText(/Корзина/).textContent, "окно осталось с корзиной прошлого повтора").toContain("(0)");
    expect(within(w).queryByTestId("quick-order-repeat-note")).toBeNull();
  });

  it("«Повторить последний» — черновик по магазину", async () => {
    page(<ShopOrderButtons shop={{ id: 5, name: "Хумо" }} />);
    fireEvent.click(screen.getByTestId("shop-repeat-last"));
    const w = await dialog();
    expect(h.draftQuery).toHaveBeenCalledWith({ shopId: 5 });
    expect(w.textContent).toMatch(/8\s500 × 12/);
  });

  it("у магазина нет заказов — окно всё равно открыто, с магазином, и сказано почему пусто", async () => {
    h.draftQuery.mockResolvedValue({ ...DRAFT, source: null, lines: [], skipped: [] });
    page(<ShopOrderButtons shop={{ id: 5, name: "Хумо" }} />);
    fireEvent.click(screen.getByTestId("shop-repeat-last"));
    const w = await dialog();
    expect(h.info).toHaveBeenCalled();
    expect(within(w).getByText(/Корзина/).textContent).toContain("(0)");
    expect(within(w).getByRole("button", { name: /Хумо/ })).toBeTruthy();
  });
});

/*
  Кнопки стоят в карточках. Сами карточки тянут десятки ручек, поднимать их
  здесь незачем: поведение кнопок проверено выше, а здесь — что они там есть и
  что показаны офису, а не всем.
*/
describe("кнопки на местах", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("карточка заказа — «Повторить» офису; карточка магазина — оба действия, не для архива", () => {
    expect(read("src/pages/OrderDetail.tsx")).toContain("{usesQuickOrder(user?.role) && !order.deletedAt && <RepeatOrderButton orderId={order.id} />}");
    expect(read("src/pages/ShopDetail.tsx")).toContain("{usesQuickOrder(user?.role) && !isArchived && <ShopOrderButtons shop={{ id: shop.id, name: shop.name }} />}");
    expect(read("src/App.tsx")).toContain("<QuickOrderHost />");
  });
});

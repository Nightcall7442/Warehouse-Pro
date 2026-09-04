// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent, act, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { LangProvider } from "@/i18n";

/**
 * Корзина на мобильном — выдвижная панель снизу.
 *
 * До этого корзина была просто следующим блоком под каталогом. В одну
 * колонку это значило: чтобы посмотреть набранное или поправить количество,
 * надо пролистать весь каталог вниз, а потом столько же обратно. У тенанта
 * с двумя сотнями товаров так и было — «листать до корзины очень тяжело».
 *
 * Проверяется три вещи, каждая из которых ломается молча:
 *
 * 1. Панель рисуется порталом в body. Родитель у корзины —
 *    .animate-fade-up, а это animation: … forwards с transform в последнем
 *    кадре. Режим forwards оставляет transform применённым навсегда, и
 *    элемент с transform становится точкой отсчёта для position: fixed
 *    внутри себя. Впиши панель на место — и «низ экрана» она отсчитает от
 *    низа списка товаров, то есть уедет на несколько экранов вниз. Ни типы,
 *    ни линтер этого не увидят: разметка останется правильной.
 *
 * 2. Закрытая панель отсутствует в документе, а не просто спрятана. Иначе
 *    её содержимое остаётся в порядке обхода для скринридера и клавиатуры.
 *
 * 3. Боковая колонка на десктопе продолжает показывать те же позиции.
 *    Панель — добавление для узкого экрана, а не замена корзины.
 */

afterEach(cleanup);

const PRODUCTS = [
  { id: 1, code: "A-1", name: "Печенье", unitPrice: "12000.00", unit: "pcs", available: "50", unitWeight: 1, photoUrl: null },
  { id: 2, code: "A-2", name: "Сок",     unitPrice: "8000.00",  unit: "pcs", available: "5",  unitWeight: 1, photoUrl: null },
];

const trpcStub = vi.hoisted(() => ({
  product: { listAll: { useQuery: () => ({ data: [
    { id: 1, code: "A-1", name: "Печенье", unitPrice: "12000.00", unit: "pcs", available: "50", unitWeight: 1, photoUrl: null },
    { id: 2, code: "A-2", name: "Сок",     unitPrice: "8000.00",  unit: "pcs", available: "5",  unitWeight: 1, photoUrl: null },
  ], isLoading: false }) } },
}));

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const { ProductSelector } = await import("@/components/orders/ProductSelector");

const CART = [{
  productId: PRODUCTS[0].id,
  productName: PRODUCTS[0].name,
  unitPrice: PRODUCTS[0].unitPrice,
  quantity: "3",
  available: PRODUCTS[0].available,
  unit: PRODUCTS[0].unit,
  unitWeight: 1,
}];

function renderSelector(opts: { cartOpen: boolean; onCartOpenChange?: (open: boolean) => void }) {
  return render(
    <LangProvider>
      <ProductSelector
        items={CART}
        onChange={vi.fn()}
        cartOpen={opts.cartOpen}
        onCartOpenChange={opts.onCartOpenChange ?? vi.fn()}
      />
    </LangProvider>,
  );
}

describe("корзина: выдвижная панель на мобильном", () => {
  it("закрытая панель отсутствует в документе целиком", () => {
    renderSelector({ cartOpen: false });
    expect(screen.queryByTestId("cart-sheet")).toBeNull();
    expect(screen.queryByTestId("cart-sheet-backdrop")).toBeNull();
  });

  it("открытая панель показывает набранные позиции", () => {
    renderSelector({ cartOpen: true });
    const sheet = screen.getByTestId("cart-sheet");
    expect(within(sheet).getByText("Печенье")).toBeTruthy();
    expect(within(sheet).getByDisplayValue("3")).toBeTruthy();
  });

  it("панель рисуется порталом в body, а не внутри .animate-fade-up", () => {
    // Внутри .animate-fade-up (animation: … forwards, transform в последнем
    // кадре) position: fixed считался бы от неё, а не от экрана: панель
    // ушла бы вниз за пределы видимого. Разметка при этом осталась бы
    // правильной, поэтому ловится только так.
    renderSelector({ cartOpen: true });
    const sheet = screen.getByTestId("cart-sheet");
    expect(sheet.closest(".animate-fade-up")).toBeNull();
    expect(sheet.closest(".order-grid")).toBeNull();
    // Встречная проверка: closest действительно находит эту обёртку, когда
    // элемент внутри неё. Без неё null выше не значил бы ничего — например,
    // если бы класс переименовали.
    expect(screen.getByTestId("product-row-1").closest(".animate-fade-up")).not.toBeNull();
  });

  it("подложка и крестик закрывают панель", () => {
    const onCartOpenChange = vi.fn();
    renderSelector({ cartOpen: true, onCartOpenChange });

    act(() => { fireEvent.click(screen.getByTestId("cart-sheet-backdrop")); });
    expect(onCartOpenChange).toHaveBeenLastCalledWith(false);

    act(() => { fireEvent.click(screen.getByTestId("cart-sheet-close")); });
    expect(onCartOpenChange).toHaveBeenLastCalledWith(false);
    expect(onCartOpenChange).toHaveBeenCalledTimes(2);
  });

  it("Escape закрывает панель", () => {
    const onCartOpenChange = vi.fn();
    renderSelector({ cartOpen: true, onCartOpenChange });
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(onCartOpenChange).toHaveBeenCalledWith(false);
  });

  it("пока панель открыта, страница под ней не прокручивается", () => {
    const { unmount } = renderSelector({ cartOpen: true });
    expect(document.body.style.overflow).toBe("hidden");
    act(() => { unmount(); });
    expect(document.body.style.overflow).toBe("");
  });

  it("боковая колонка на десктопе показывает те же позиции", () => {
    // Панель — добавление для узкого экрана. Колонка остаётся в разметке
    // всегда и прячется только правилом ширины в index.css.
    const { container } = renderSelector({ cartOpen: false });
    const panel = container.querySelector(".order-cart-panel");
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText("Печенье")).toBeTruthy();
    // Крестик — только у панели: колонку закрывать некуда.
    expect(within(panel as HTMLElement).queryByTestId("cart-sheet-close")).toBeNull();
  });
});

describe("корзина: кнопка-итог на экране «Новый заказ»", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../pages/NewOrder.tsx"), "utf8");

  it("итог в нижней строке — кнопка, открывающая корзину", () => {
    // Раньше это была подпись: сумму видно, а дотянуться до корзины всё
    // равно можно было только прокруткой до конца каталога.
    expect(src).toMatch(/data-testid="open-cart"/);
    expect(src).toMatch(/onClick=\{\(\) => setCartOpen\(true\)\}/);
  });

  it("панель получает состояние и обработчик", () => {
    // Шаги стали отдельными адресами, и признак корзины доезжает до панели
    // через контекст родителя, а не прямым пропсом со страницы.
    expect(src).toMatch(/<ProductSelector[\s\S]*?cartOpen=\{w\.cartOpen\}/);
    expect(src).toMatch(/<ProductSelector[\s\S]*?onCartOpenChange=\{w\.setCartOpen\}/);
  });

  it("смена шага закрывает корзину", () => {
    // Иначе, уйдя с открытой панелью на «Итог» и вернувшись назад, человек
    // получит её снова раскрытой поверх каталога: панель размонтируется
    // вместе с шагом, а признак переживает размонтирование.
    expect(src).toMatch(/setCartOpen\(false\);\s*\n\s*navigate\(STEP_PATHS\[next - 1\]\)/);
    expect(src).toMatch(/goToStep\(step \+ 1\)/);
  });

  it("шаг берётся из адреса, а не из состояния", () => {
    /*
      Шаг хранился в useState, и системная «назад» — кнопка браузера, жест от
      края на телефоне, аппаратная клавиша на Android — про него не знала:
      уводила со страницы целиком, унося магазин и набранную корзину.
      Обновление страницы делало то же самое.

      Теперь у каждого шага свой адрес, а нарисованная стрелка в шапке ведёт
      себя как системная — отдаёт шаг назад по истории.
    */
    expect(src).not.toMatch(/setStep\(/);
    expect(src).toMatch(/const step = location\.pathname/);
    expect(src).toMatch(/onClick=\{\(\) => navigate\(-1\)\}/);
  });

  it("заход на внутренний шаг без магазина возвращает на первый", () => {
    // Состояние живёт в памяти: перезагрузка на /orders/new/items оставила бы
    // пустой заказ — экран без товаров и погасшую кнопку без объяснения.
    expect(src).toMatch(/if \(step > 1 && shopId === 0\) navigate\(STEP_PATHS\[0\], \{ replace: true \}\)/);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Количество в заказе: две беды, обе меняли то, что уедет в магазин.
 *
 * 1. Поле нельзя было стереть. На пустой строке parseFloat давал NaN, и
 *    обработчик выходил, не тронув состояние; поле управляемое, поэтому React
 *    возвращал в разметку прежнее число. Агент жал стирание — цифра не
 *    удалялась. Чтобы поменять 3 на 12, надо было целиться курсором и
 *    дописывать вокруг старой цифры.
 *
 * 2. Тап по карточке клал одну штуку, стирая набранное. Агент вбивал «12»,
 *    гасил клавиатуру тапом по этой же карточке — в корзину уходила 1 шт.
 *    Заметить подмену можно было, только открыв корзину; иначе магазин
 *    получал одну пачку вместо двенадцати.
 *
 * Пустое количество безопасно: строки с неположительным количеством и так
 * отсеиваются везде, где считается заказ (NewOrder.tsx, строки 174, 186, 221),
 * и сервер их не принимает.
 */

afterEach(cleanup);

const PRODUCTS = [
  { id: 1, code: "A-1", name: "Печенье", unitPrice: "12000.00", unit: "pcs", available: "50", unitWeight: 1, photoUrl: null },
];

const trpcStub = vi.hoisted(() => ({
  product: {
    listAll: {
      useQuery: () => ({
        data: [{ id: 1, code: "A-1", name: "Печенье", unitPrice: "12000.00", unit: "pcs", available: "50", unitWeight: 1, photoUrl: null }],
        isLoading: false,
      }),
    },
  },
}));

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const { ProductSelector } = await import("@/components/orders/ProductSelector");

type Item = { productId: number; productName: string; unitPrice: string; quantity: string; available: string; unit: string; unitWeight: number };

const inCart = (quantity: string): Item[] => [{
  productId: PRODUCTS[0].id,
  productName: PRODUCTS[0].name,
  unitPrice: PRODUCTS[0].unitPrice,
  quantity,
  available: PRODUCTS[0].available,
  unit: PRODUCTS[0].unit,
  unitWeight: 1,
}];

function renderSelector(items: Item[]) {
  const onChange = vi.fn();
  render(
    <LangProvider>
      <ProductSelector items={items} onChange={onChange} cartOpen={false} onCartOpenChange={vi.fn()} />
    </LangProvider>,
  );
  return onChange;
}

describe("количество в заказе", () => {
  it("поле можно стереть — обработчик получает пустое значение", () => {
    const onChange = renderSelector(inCart("3"));
    const field = screen.getAllByDisplayValue("3")[0] as HTMLInputElement;

    fireEvent.change(field, { target: { value: "" } });

    // Раньше onChange не вызывался вовсе, и поле возвращало «3».
    expect(onChange, "стирание не дошло до состояния").toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as Item[];
    expect(next[0].quantity).toBe("");
  });

  it("после стирания можно набрать другое число", () => {
    const onChange = renderSelector(inCart(""));
    /*
      По роли, а не по значению или идентификатору. Пустых полей на экране
      два — поиск стоит раньше в разметке; а product-qty-N носит поле
      БЫСТРОГО добавления, оно рисуется только пока товара нет в корзине.
      Числовых полей несколько: одно в строке каталога, другое в боковой
      корзине — берём первое, это строка каталога.
    */
    const field = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;

    fireEvent.change(field, { target: { value: "12" } });

    const next = onChange.mock.calls.at(-1)![0] as Item[];
    expect(next[0].quantity).toBe("12");
  });

  it("на карточке нет полей ввода — клавиатуре открываться не от чего", () => {
    /*
      Решение владельца, снято с живого телефона: «если нажать на плюс,
      автоматически открывается клава, чтобы писать; сделай, чтобы клава не
      открывалась — только плюс товар, а задать по сколько только в корзине».

      Раньше на карточке стояло поле количества, и тап по нему выкидывал
      клавиатуру на пол-экрана. Теперь число на карточке меняется только
      кнопками, а набирается в корзине.
    */
    renderSelector([]);
    const card = screen.getByTestId("product-row-1");
    expect(card.querySelectorAll("input"), "на карточке снова появилось поле ввода").toHaveLength(0);

    // И у добавленного товара тоже: там теперь просто число.
    cleanup();
    renderSelector(inCart("3"));
    const inCartCard = screen.getByTestId("product-row-1");
    expect(inCartCard.querySelectorAll("input")).toHaveLength(0);
    expect(inCartCard.textContent).toContain("3");
  });

  it("добавление не возвращает курсор в поиск", () => {
    /*
      Именно этот возврат и открывал клавиатуру: после «+» код ставил курсор
      обратно в строку поиска, а телефон на фокус выкидывает клавиатуру. Агент
      при этом просто набирает товары один за другим и печатать не собирался.
    */
    renderSelector([]);
    const search = screen.getByTestId("product-search");
    fireEvent.click(screen.getByTestId("product-add-1"));
    expect(document.activeElement, "курсор снова уводят в поиск").not.toBe(search);
  });

  it("тап по карточке без набранного кладёт одну штуку", () => {
    // Обычный быстрый путь ломать нельзя: пустое поле по-прежнему значит «одну».
    const onChange = renderSelector([]);
    fireEvent.click(screen.getByTestId("product-row-1"));
    const next = onChange.mock.calls.at(-1)![0] as Item[];
    expect(next[0].quantity).toBe("1");
  });
});

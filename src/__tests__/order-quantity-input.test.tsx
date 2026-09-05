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

  it("тап по карточке кладёт набранное количество, а не одну штуку", () => {
    const onChange = renderSelector([]);

    // Набираем в поле карточки, затем жмём саму карточку — так агент гасит
    // клавиатуру, и именно на этом пути терялось набранное.
    const quick = screen.getByTestId("product-qty-1") as HTMLInputElement;
    fireEvent.change(quick, { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("product-row-1"));

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as Item[];
    expect(next).toHaveLength(1);
    expect(next[0].quantity, "в корзину ушла одна штука вместо набранных 12").toBe("12");
  });

  it("тап по карточке без набранного кладёт одну штуку", () => {
    // Обычный быстрый путь ломать нельзя: пустое поле по-прежнему значит «одну».
    const onChange = renderSelector([]);
    fireEvent.click(screen.getByTestId("product-row-1"));
    const next = onChange.mock.calls.at(-1)![0] as Item[];
    expect(next[0].quantity).toBe("1");
  });
});

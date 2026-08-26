/**
 * Один товар — одна строка в заказе.
 *
 * Схема ввода order.create не требовала уникальности productId, и две строки с
 * одним товаром проходили все проверки. Дальше их встречал UPDATE вида
 * `reserved = reserved + CASE WHEN product_id = 7 THEN 60 WHEN product_id = 7
 * THEN 60 ELSE 0 END`, а MySQL берёт только первый совпавший WHEN: в заказ
 * ложилось 120 единиц, на складе занималось 60. Проверка достатка пропускала
 * обе строки, потому что сверяла каждую с одним и тем же available.
 *
 * Итог — заказ на товар, которого нет, и завышенный на величину дубля остаток,
 * который следующий заказ тоже «продаст».
 *
 * Здесь проверяется чистая функция схлопывания: она стоит первой в create, и
 * весь остальной код исходит из того, что товар встречается один раз.
 */
import { describe, it, expect } from "vitest";
import { mergeDuplicateItems } from "../services/order";

describe("схлопывание повторяющихся товаров", () => {
  it("две строки одного товара становятся одной с суммой количеств", () => {
    const merged = mergeDuplicateItems([
      { productId: 7, quantity: "60" },
      { productId: 7, quantity: "60" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ productId: 7, quantity: "120" });
  });

  it("три и больше — тоже", () => {
    const merged = mergeDuplicateItems([
      { productId: 3, quantity: "1" },
      { productId: 3, quantity: "2" },
      { productId: 3, quantity: "4" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe("7");
  });

  it("разные товары не трогаются", () => {
    const merged = mergeDuplicateItems([
      { productId: 1, quantity: "5" },
      { productId: 2, quantity: "3" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map(i => i.quantity)).toEqual(["5", "3"]);
  });

  it("порядок — по первому появлению товара, как складывали в корзину", () => {
    const merged = mergeDuplicateItems([
      { productId: 9, quantity: "1" },
      { productId: 4, quantity: "1" },
      { productId: 9, quantity: "1" },
    ]);
    expect(merged.map(i => i.productId)).toEqual([9, 4]);
    expect(merged[0].quantity).toBe("2");
  });

  it("дробные количества складываются как числа, а не склеиваются как строки", () => {
    const merged = mergeDuplicateItems([
      { productId: 5, quantity: "1.5" },
      { productId: 5, quantity: "2.25" },
    ]);
    expect(Number(merged[0].quantity)).toBeCloseTo(3.75);
  });

  it("исходный массив не меняется — вызывающий может на него рассчитывать", () => {
    const input = [
      { productId: 7, quantity: "60" },
      { productId: 7, quantity: "60" },
    ];
    mergeDuplicateItems(input);
    expect(input).toHaveLength(2);
    expect(input[0].quantity).toBe("60");
  });

  it("прочие поля строки сохраняются от первого вхождения", () => {
    const merged = mergeDuplicateItems([
      { productId: 2, quantity: "1", note: "первая" },
      { productId: 2, quantity: "1", note: "вторая" },
    ] as Array<{ productId: number; quantity: string; note: string }>);
    expect(merged[0].note).toBe("первая");
  });

  it("пустой список остаётся пустым", () => {
    expect(mergeDuplicateItems([])).toEqual([]);
  });

  // Именно этот случай и приводил к пересорту: 100 на складе, две строки по 60.
  it("после схлопывания количество видно целиком — проверка достатка увидит 120, а не 60", () => {
    const merged = mergeDuplicateItems([
      { productId: 7, quantity: "60" },
      { productId: 7, quantity: "60" },
    ]);
    const available = 100;
    const requested = Number(merged[0].quantity);
    expect(requested).toBe(120);
    expect(available < requested).toBe(true); // заказ должен быть отклонён
  });
});

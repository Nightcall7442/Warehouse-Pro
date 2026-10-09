/**
 * Сумма прописью в акте сверки.
 *
 * Её читают глазами при подписи, и ошибку в ней не спишешь на округление:
 * «две тысячи» вместо «два тысячи», «сумов» после пяти и «сум» после
 * двадцати одного — то, по чему бухгалтер сразу видит самодельную бумагу.
 */
import { describe, it, expect } from "vitest";
import { amountInWords, integerInWords, plural } from "@contracts/amount-in-words";

describe("сумма прописью", () => {
  it("числа до тысячи", () => {
    expect(integerInWords(0)).toBe("ноль");
    expect(integerInWords(1)).toBe("один");
    expect(integerInWords(11)).toBe("одиннадцать");
    expect(integerInWords(21)).toBe("двадцать один");
    expect(integerInWords(100)).toBe("сто");
    expect(integerInWords(999)).toBe("девятьсот девяносто девять");
  });

  it("тысяча — женского рода", () => {
    expect(integerInWords(1000)).toBe("одна тысяча");
    expect(integerInWords(2000)).toBe("две тысячи");
    expect(integerInWords(5000)).toBe("пять тысяч");
    expect(integerInWords(21000)).toBe("двадцать одна тысяча");
    expect(integerInWords(12000)).toBe("двенадцать тысяч");
  });

  it("миллионы и пропуски разрядов", () => {
    expect(integerInWords(1_250_000)).toBe("один миллион двести пятьдесят тысяч");
    expect(integerInWords(1_000_001)).toBe("один миллион один");
    expect(integerInWords(2_000_000_000)).toBe("два миллиарда");
    expect(integerInWords(3_004_005)).toBe("три миллиона четыре тысячи пять");
  });

  it("склонение: 1 сум, 2 сума, 5 сумов, 11–14 сумов, 21 сум", () => {
    const f = ["сум", "сума", "сумов"] as const;
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 112].map(n => plural(n, f)))
      .toEqual(["сум", "сума", "сума", "сумов", "сумов", "сумов", "сумов", "сум", "сума", "сумов", "сумов", "сумов"]);
  });

  it("полная строка — с заглавной буквы, сумы и тийины", () => {
    expect(amountInWords(1_250_000)).toBe("Один миллион двести пятьдесят тысяч сумов 00 тийинов");
    expect(amountInWords(21)).toBe("Двадцать один сум 00 тийинов");
    expect(amountInWords(1002.5)).toBe("Одна тысяча два сума 50 тийинов");
    expect(amountInWords(0)).toBe("Ноль сумов 00 тийинов");
  });

  it("знак не пишется: в чью пользу долг, говорит сама фраза акта", () => {
    expect(amountInWords(-5000)).toBe("Пять тысяч сумов 00 тийинов");
  });

  it("копейки не теряются на 0,995 и не дают «100 тийинов»", () => {
    expect(amountInWords(9.999)).toBe("Десять сумов 00 тийинов");
  });
});

import { describe, it, expect } from "vitest";
import { normalizeDecimalInput, parseDecimalInput, isDecimalInput } from "@/lib/decimal-input";

/**
 * Проверено в настоящем браузере на локали ru: поле type="number" на «12,5»
 * отдаёт value === "", а checkValidity() возвращает true. Ошибки не видно
 * нигде, а на сервере пустая строка становится значением по умолчанию — то
 * есть цена товара обнуляется от нажатия запятой.
 */
describe("запятая в цене больше не теряет число", () => {
  it("запятая — это разделитель, а не мусор", () => {
    expect(normalizeDecimalInput("12,5")).toBe("12.5");
    expect(parseDecimalInput("12,5")).toBe(12.5);
  });

  it("вставленное из буфера с разделителями тысяч читается", () => {
    // Так сумма выглядит везде в приложении: money() печатает её с
    // неразрывными пробелами. Скопировали оттуда — должно вставиться.
    expect(parseDecimalInput("1 250")).toBe(1250);
    expect(parseDecimalInput("1\u00A0250,75")).toBe(1250.75);
    expect(parseDecimalInput("1 250")).toBe(1250);
  });

  it("незаконченный набор не обрезается", () => {
    // Вызывается на каждое нажатие. Если убрать точку в конце, поставить её
    // будет невозможно — поле не даст набрать дробную часть.
    expect(normalizeDecimalInput("12.")).toBe("12.");
    expect(normalizeDecimalInput("12,")).toBe("12.");
    expect(normalizeDecimalInput("0.")).toBe("0.");
  });

  it("вторая точка отбрасывается, а не склеивает разряды", () => {
    // «12.5.7» → «12.57» было бы враньём про введённое.
    expect(normalizeDecimalInput("12.5.7")).toBe("12.5");
    expect(normalizeDecimalInput("12,5,7")).toBe("12.5");
  });

  it("буквы в поле цены не появляются", () => {
    expect(normalizeDecimalInput("12abc5")).toBe("125");
    expect(normalizeDecimalInput("abc")).toBe("");
  });

  it("минус сохраняется только в начале", () => {
    expect(normalizeDecimalInput("-5,5")).toBe("-5.5");
    expect(normalizeDecimalInput("5-5")).toBe("55");
  });

  it("пустое поле — это не ноль", () => {
    // Number("") === 0, и именно на этом цены обнулялись молча. Пустое поле
    // обязано отличаться от честно введённого нуля.
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput(null)).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
    expect(parseDecimalInput("0"), "честный ноль должен читаться как ноль").toBe(0);
  });

  it("незаконченный ввод числом ещё не считается", () => {
    expect(parseDecimalInput(".")).toBeNull();
    expect(parseDecimalInput("-")).toBeNull();
    expect(isDecimalInput("12.")).toBe(true);
    expect(isDecimalInput("abc")).toBe(false);
  });
});

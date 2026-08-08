import { describe, it, expect, vi } from "vitest";
import { makeConditionEvaluator, UnsupportedCondition } from "./helpers/fake-conditions";

/**
 * Проверка самого разборщика условий.
 *
 * Он лежит под тремя десятками тестовых файлов, поэтому его собственная ошибка
 * тише и опаснее любой другой: она не сломает тесты, а изменит их вердикт.
 * Отсюда подробность — особенно вокруг «что считается неизвестным».
 */

const COL = { name: "quantity" }, OTHER = { name: "deleted_at" };
const fieldOf = (c: unknown) => (c === COL ? "quantity" : c === OTHER ? "deletedAt" : undefined);
const ev = makeConditionEvaluator({ fieldOf });

const eq = (col: unknown, val: unknown) => ({ __kind: "eq", col, val });
const row = (r: Record<string, unknown>) => r;

describe("неизвестное условие — ошибка, а не «да»", () => {
  it("незнакомый вид бросает исключение", () => {
    // Именно это раньше возвращало true и делало тест подтверждающим что угодно.
    expect(() => ev(row({ quantity: 1 }), { __kind: "arrayOverlaps", col: COL, val: 1 }))
      .toThrow(UnsupportedCondition);
  });

  it("в тексте ошибки сказано, что делать", () => {
    try {
      ev(row({}), { __kind: "someNewOperator" });
      throw new Error("не бросило");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("someNewOperator");
      expect(m).toMatch(/fake-conditions/);
      expect(m).toMatch(/нельзя/);
    }
  });

  it("сырой sql без обработчика — ошибка", () => {
    // Раньше любой sql`` молча считался выполненным. В 25 файлах из 36 такие
    // условия есть, и среди них — фильтры по датам и по статусам.
    const raw = { __kind: "sql", strings: ["CAST(", " AS DECIMAL) > 0"], values: [COL] };
    expect(() => ev(row({ quantity: 0 }), raw)).toThrow(/sql``/);
  });

  it("сырой sql с обработчиком считается так, как решил тест", () => {
    const rawSql = vi.fn(() => false);
    const withHandler = makeConditionEvaluator({ fieldOf, rawSql });
    expect(withHandler(row({ quantity: 5 }), { __kind: "sql", strings: ["…"], values: [] })).toBe(false);
    expect(rawSql).toHaveBeenCalledTimes(1);
  });

  it("неизвестная колонка тоже ошибка", () => {
    // Опечатка в карте колонок иначе превращалась бы в сравнение с undefined,
    // то есть в тихое «не совпало» для всех строк.
    expect(() => ev(row({ quantity: 1 }), eq({ name: "чужая" }, 1))).toThrow(/неизвестная колонка/);
  });

  it("отсутствие условия — единственное безопасное «да»", () => {
    expect(ev(row({ quantity: 1 }), undefined)).toBe(true);
    expect(ev(row({ quantity: 1 }), null)).toBe(true);
  });
});

describe("операторы считаются верно", () => {
  it("eq сравнивает нестрого: из базы приходят строки", () => {
    // «10.00» из DECIMAL и число 10 — одно значение.
    expect(ev(row({ quantity: "10.00" }), eq(COL, 10))).toBe(true);
    expect(ev(row({ quantity: "10.00" }), eq(COL, 11))).toBe(false);
  });

  it("isNull отличает пустую колонку от заполненной", () => {
    // Тот самый фильтр, который знали пять файлов из тридцати шести.
    const isNull = { __kind: "isNull", col: OTHER };
    expect(ev(row({ deletedAt: null }), isNull)).toBe(true);
    expect(ev(row({}), isNull)).toBe(true);
    expect(ev(row({ deletedAt: new Date() }), isNull)).toBe(false);
  });

  it("isNotNull — зеркало", () => {
    const isNotNull = { __kind: "isNotNull", col: OTHER };
    expect(ev(row({ deletedAt: new Date() }), isNotNull)).toBe(true);
    expect(ev(row({ deletedAt: null }), isNotNull)).toBe(false);
  });

  it("сравнения работают и на числах-строках", () => {
    expect(ev(row({ quantity: "5" }), { __kind: "gt", col: COL, val: 3 })).toBe(true);
    expect(ev(row({ quantity: "5" }), { __kind: "gte", col: COL, val: 5 })).toBe(true);
    expect(ev(row({ quantity: "5" }), { __kind: "lt", col: COL, val: 5 })).toBe(false);
    expect(ev(row({ quantity: "5" }), { __kind: "lte", col: COL, val: 5 })).toBe(true);
  });

  it("сравнение дат идёт по времени, а не по тексту", () => {
    const d = (s: string) => new Date(s);
    const evd = makeConditionEvaluator({ fieldOf: () => "at" });
    expect(evd(row({ at: d("2026-08-08") }), { __kind: "gte", col: {}, val: d("2026-08-01") })).toBe(true);
    expect(evd(row({ at: d("2026-07-31") }), { __kind: "gte", col: {}, val: d("2026-08-01") })).toBe(false);
  });

  it("inArray и notInArray", () => {
    const values = [1, 2, 3];
    expect(ev(row({ quantity: "2" }), { __kind: "inArray", col: COL, values })).toBe(true);
    expect(ev(row({ quantity: "9" }), { __kind: "inArray", col: COL, values })).toBe(false);
    expect(ev(row({ quantity: "9" }), { __kind: "notInArray", col: COL, values })).toBe(true);
  });

  it("like понимает % и _ и не зависит от регистра", () => {
    const evs = makeConditionEvaluator({ fieldOf: () => "name" });
    const like = (val: string) => ({ __kind: "like", col: {}, val });
    expect(evs(row({ name: "Молоко 3.2%" }), like("%молоко%"))).toBe(true);
    expect(evs(row({ name: "Кефир" }), like("%молоко%"))).toBe(false);
    expect(evs(row({ name: "Кефир" }), like("Кефи_"))).toBe(true);
    // Спецсимволы регулярных выражений в образце — обычные символы для LIKE.
    expect(evs(row({ name: "a.b" }), like("a.b"))).toBe(true);
    expect(evs(row({ name: "axb" }), like("a.b"))).toBe(false);
  });

  it("between включает границы", () => {
    const between = { __kind: "between", col: COL, min: 5, max: 10 };
    expect(ev(row({ quantity: 5 }), between)).toBe(true);
    expect(ev(row({ quantity: 10 }), between)).toBe(true);
    expect(ev(row({ quantity: 11 }), between)).toBe(false);
  });

  it("and, or и not вложены как в SQL", () => {
    const r = row({ quantity: "5", deletedAt: null });
    const isNull = { __kind: "isNull", col: OTHER };
    expect(ev(r, { __kind: "and", conds: [eq(COL, 5), isNull] })).toBe(true);
    expect(ev(r, { __kind: "and", conds: [eq(COL, 9), isNull] })).toBe(false);
    expect(ev(r, { __kind: "or", conds: [eq(COL, 9), isNull] })).toBe(true);
    expect(ev(r, { __kind: "not", cond: eq(COL, 5) })).toBe(false);
  });

  it("вложенное неизвестное условие не проглатывается and-ом", () => {
    // Самый коварный случай: одно понятное условие рядом с непонятым. Раньше
    // непонятое давало true, и вся связка держалась на соседе.
    expect(() => ev(row({ quantity: 5 }), { __kind: "and", conds: [eq(COL, 5), { __kind: "чтотоновое" }] }))
      .toThrow(UnsupportedCondition);
  });
});

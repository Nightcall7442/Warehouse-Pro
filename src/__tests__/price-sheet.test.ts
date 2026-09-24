/**
 * Сетка прайс-листа — логика без браузера.
 *
 *   · правило «к карточке» считается до копейки так же, как на сервере
 *     (applyMarkup) — иначе сетка показала бы одну цену, а заказ взял другую;
 *   · действующая цена: своя → правило → карточка;
 *   · проценты к карточке и маржа, продажа ниже себестоимости;
 *   · «найденным −7 %»; что уходит на сервер — только изменённое, пусто
 *     там, где цена была, — null.
 *
 * Нарочная поломка: в changes убери проверку «совпало с сохранённым» —
 * падает «неизменённое не уходит».
 */
import { describe, it, expect } from "vitest";
import { ruled, effective, toCardPct, marginPct, applyPct, belowCost, changes, normalizePrice, type PriceRow } from "@/lib/price-sheet";
import { applyMarkup } from "../../api/services/price-resolver";

const row = (patch: Partial<PriceRow> = {}): PriceRow => ({
  productId: 1, name: "Сок", code: "S-1", category: "Напитки", costPrice: 8000, cardPrice: 12000, price: "", tiers: 0, ...patch,
});

describe("цена по правилу", () => {
  it("совпадает с серверной до копейки", () => {
    for (const [card, pct] of [[12000, -7], [9999.99, 3.5], [1, -33.33], [123456.78, 12.5], [0.1, 1000]] as const) {
      expect(ruled(card, pct)!.toFixed(2)).toBe(applyMarkup(card, pct));
    }
    expect(ruled(12000, null)).toBeNull();
  });

  it("действует своя → правило → карточка", () => {
    expect(effective(row({ price: "11000" }), -7)).toEqual({ price: 11000, source: "own" });
    expect(effective(row(), -7)).toEqual({ price: 11160, source: "rule" });
    expect(effective(row(), null)).toEqual({ price: 12000, source: "card" });
  });
});

describe("проценты", () => {
  it("к карточке, маржа, ниже себестоимости", () => {
    expect(toCardPct(11160, 12000)).toBe(-7);
    expect(toCardPct(100, 0)).toBeNull();
    expect(marginPct(12000, 8000)).toBe(50);
    expect(marginPct(12000, 0)).toBeNull();
    expect(belowCost(row({ price: "7999" }), null)).toBe(true);
    expect(belowCost(row({ price: "8000" }), null)).toBe(false);
    expect(belowCost(row({ costPrice: 0, price: "1" }), null)).toBe(false);
  });

  it("найденным: карточка −7 % до копеек; без карточки — не трогаем", () => {
    const rows = applyPct([row(), row({ productId: 2, cardPrice: 9999.99 }), row({ productId: 3, cardPrice: 0 }), row({ productId: 4 })], new Set([1, 2, 3]), -7);
    expect(rows.map(r => r.price)).toEqual(["11160", "9299.99", "", ""]);
  });
});

describe("что уходит на сервер", () => {
  it("новое и изменённое — числом, убранное — null, неизменённое не уходит", () => {
    const base = new Map([[1, "11000"], [2, "500"], [3, "700"]]);
    const out = changes(base, [
      row({ productId: 1, price: "11000.00" }),  // то же самое
      row({ productId: 2, price: "" }),          // убрали
      row({ productId: 3, price: "650" }),       // поменяли
      row({ productId: 4, price: "99.999" }),    // новое, до копеек
      row({ productId: 5, price: "" }),          // и не было
      row({ productId: 6, price: "abc" }),       // мусор — не уходит
    ]);
    expect(out).toEqual([{ productId: 2, price: null }, { productId: 3, price: 650 }, { productId: 4, price: 100 }]);
  });

  it("вставка из Excel: «1 200,50» → число, пусто — пусто, мусор — null", () => {
    expect(normalizePrice("1 200,50")).toBe("1200.50");
    expect(normalizePrice("")).toBe("");
    expect(normalizePrice("12 шт")).toBeNull();
  });
});

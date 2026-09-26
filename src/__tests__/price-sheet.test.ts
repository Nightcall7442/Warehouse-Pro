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
import { ruled, effective, toCardPct, belowCost, changes, type PriceRow } from "@/lib/price-sheet";
import { markupPct } from "@/lib/arrival-sheet";
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
    expect(toCardPct(0, 12000)).toBe(-100);
    // Маржа к себестоимости — та же наценка, что в приходе.
    expect(markupPct(8000, 12000)).toBe(50);
    expect(markupPct(0, 12000)).toBeNull();
    expect(belowCost(row({ price: "7999" }), null)).toBe(true);
    expect(belowCost(row({ price: "8000" }), null)).toBe(false);
    expect(belowCost(row({ costPrice: 0, price: "1" }), null)).toBe(false);
  });

  it("найденным: карточка −7 % — та же цена, что даст правило, до копеек", () => {
    // «Найденным ±X %» считает через ruled(); без карточки — в сетке (price-list-editor-ui).
    expect([ruled(12000, -7), ruled(9999.99, -7)]).toEqual([11160, 9299.99]);
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
});

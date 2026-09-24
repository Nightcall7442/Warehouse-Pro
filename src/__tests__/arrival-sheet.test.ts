/**
 * Логика листа прихода — без браузера.
 *
 * Что проверяется: товары пачкой без дублей, скан +1, «пришло = по
 * накладной» не затирает посчитанное, упаковки ↔ штуки, разница с
 * накладной, итоги, вставка столбца из Excel (числа «1 200,50», мусор
 * пропускается, лишние строки отброшены), что уходит на сервер (строка по
 * накладной без «пришло» — нулём; пустая — не уходит), проверки до
 * отправки, строки из документа (ноль — «не считали»), клавиатура сетки.
 *
 * Нарочная поломка: в toPayload убери `|| r.expected.trim() !== ""` из
 * фильтра — падает «строка по накладной уходит нулём».
 */
import { describe, it, expect } from "vitest";
import {
  rowFromProduct, addProducts, applyScan, fillFromExpected, boxesToQuantity, quantityToBoxes, diff, markupPct,
  totals, pasteRange, normalizeNumber, toPayload, problems, rowsFromDetail, type SheetRow,
} from "@/lib/arrival-sheet";
import { nextCell, parseClipboard, isRangePaste } from "@/lib/grid-nav";

const juice = { id: 1, name: "Сок", code: "S-1", unit: "pcs", unitWeight: "1.05", packSize: "12", packLabel: "короб", costPrice: "9000", unitPrice: "12000" };
const water = { id: 2, name: "Вода", code: "W-1", unit: "pcs", unitWeight: "0.5", packSize: null, costPrice: "0", unitPrice: "3000" };
const row = (p: typeof juice | typeof water, patch: Partial<SheetRow> = {}): SheetRow => ({ ...rowFromProduct(p), ...patch });

describe("товары в лист", () => {
  it("строка из карточки: цены подсказкой, упаковка, пустые количества", () => {
    expect(rowFromProduct(juice)).toMatchObject({ productId: 1, name: "Сок", code: "S-1", packSize: 12, unitWeight: 1.05, costPrice: "9000", sellingPrice: "12000", quantity: "", expected: "" });
    expect(rowFromProduct(water).costPrice).toBe("");
  });

  it("пачкой: уже стоящие не дублируются", () => {
    const r = addProducts([row(juice)], [juice, water, water]);
    expect(r.rows.map(x => x.productId)).toEqual([1, 2]);
    expect(r).toMatchObject({ added: 1, skipped: 2 });
  });

  it("скан: +1 к стоящему, новый — строка с единицей", () => {
    const a = applyScan([row(juice, { quantity: "4" })], juice);
    expect(a[0].quantity).toBe("5");
    const b = applyScan(a, water);
    expect(b[1]).toMatchObject({ productId: 2, quantity: "1" });
  });

  it("«пришло = по накладной» не трогает уже посчитанное и строки без накладной", () => {
    const r = fillFromExpected([row(juice, { expected: "24" }), row(water, { expected: "10", quantity: "9" }), row({ ...water, id: 3 })]);
    expect(r.rows.map(x => x.quantity)).toEqual(["24", "9", ""]);
    expect(r.filled).toBe(1);
  });
});

describe("числа строки", () => {
  it("упаковки ↔ штуки", () => {
    expect(boxesToQuantity("3", 12)).toBe("36");
    expect(boxesToQuantity("0", 12)).toBe("");
    expect(boxesToQuantity("2", 0)).toBe("");
    expect(quantityToBoxes("36", 12)).toBe("3");
    expect(quantityToBoxes("30", 12)).toBe("");
  });

  it("разница с накладной и наценка", () => {
    expect(diff(row(juice, { expected: "24", quantity: "22" }))).toBe(-2);
    expect(diff(row(juice, { expected: "24" }))).toBeNull();
    expect(diff(row(juice, { quantity: "5" }))).toBeNull();
    expect(markupPct("9000", "12000")).toBe(33.3);
    expect(markupPct("", "12000")).toBeNull();
  });

  it("итоги: единицы, вес, закупка, продажа, расхождения, не посчитано", () => {
    const t = totals([row(juice, { expected: "24", quantity: "22" }), row(water, { expected: "10" }), row({ ...water, id: 3 }, { quantity: "4", costPrice: "2000" })]);
    expect(t).toMatchObject({ positions: 3, units: 26, expectedUnits: 34, mismatches: 1, notCounted: 1 });
    expect(t.costSum).toBe(22 * 9000 + 4 * 2000);
    expect(t.saleSum).toBe(22 * 12000 + 4 * 3000);
    expect(t.weightKg).toBe(22 * 1.05 + 4 * 0.5);
  });
});

describe("вставка из Excel", () => {
  it("столбец «пришло» с третьей строки; лишние строки отброшены", () => {
    const rows = [row(juice), row(water), row({ ...water, id: 3 }), row({ ...water, id: 4 })];
    const r = pasteRange(rows, 2, "quantity", parseClipboard("5\n6\n7\n"));
    expect(r.rows.map(x => x.quantity)).toEqual(["", "", "5", "6"]);
    expect(r.cells).toBe(2);
  });

  it("диапазон вправо: пришло → закупка → продажа; «1 200,50» — число; мусор пропускается", () => {
    const r = pasteRange([row(juice)], 0, "quantity", parseClipboard("10\t1 200,50\tабв"));
    expect(r.rows[0]).toMatchObject({ quantity: "10", costPrice: "1200.50", sellingPrice: "12000" });
    expect(r.cells).toBe(2);
  });

  it("нормализация и признаки вставки", () => {
    expect(normalizeNumber("1 200,5")).toBe("1200.5");
    expect(normalizeNumber("")).toBe("");
    expect(normalizeNumber("12шт")).toBeNull();
    expect(isRangePaste("12")).toBe(false);
    expect(isRangePaste("12\n")).toBe(false);
    expect(isRangePaste("12\n13")).toBe(true);
    expect(isRangePaste("12\t13")).toBe(true);
    expect(parseClipboard("1\r\n2\r\n")).toEqual([["1"], ["2"]]);
  });
});

describe("на сервер", () => {
  it("строка по накладной уходит нулём; пустая строка не уходит; числа — с двумя знаками", () => {
    const p = toPayload([
      row(juice, { expected: "24" }),
      row(water),
      row({ ...water, id: 3 }, { quantity: "4.5", costPrice: "2000", batchNumber: " L-7 ", expiresAt: "2027-01-01" }),
    ]);
    expect(p).toEqual([
      { productId: 1, quantity: "0.00", expectedQuantity: "24.00", costPrice: "9000.00", sellingPrice: "12000.00", batchNumber: undefined, expiresAt: undefined },
      { productId: 3, quantity: "4.50", expectedQuantity: undefined, costPrice: "2000.00", sellingPrice: "3000.00", batchNumber: "L-7", expiresAt: "2027-01-01" },
    ]);
  });

  it("до отправки: срок раньше даты прихода и строка без количества", () => {
    const pr = problems([row(juice, { quantity: "1", expiresAt: "2026-09-01" }), row(water)], "2026-09-24");
    expect(pr.map(x => [x.row, x.col])).toEqual([[0, "expiresAt"], [1, "quantity"]]);
  });

  it("строки документа: ноль в «пришло» — ещё не считали; накладная и партия сохраняются", () => {
    const rows = rowsFromDetail([
      { productId: 1, productName: "Сок", productCode: "S-1", quantity: 0, expectedQuantity: 24, costPrice: "9000.00", sellingPrice: "0.00", batchNumber: null, expiresAt: null, unit: "pcs", unitWeight: "1.05", packSize: "12.00", packLabel: "короб" },
      { productId: 2, productName: "Вода", productCode: "W-1", quantity: 10, expectedQuantity: null, costPrice: "0.00", sellingPrice: "3000.00", batchNumber: "B", expiresAt: "2027-01-01" },
    ]);
    expect(rows[0]).toMatchObject({ quantity: "", expected: "24", costPrice: "9000", sellingPrice: "", packSize: 12 });
    expect(rows[1]).toMatchObject({ quantity: "10", expected: "", sellingPrice: "3000", batchNumber: "B", expiresAt: "2027-01-01", unit: "pcs" });
  });
});

describe("клавиатура сетки", () => {
  it("Enter и стрелки — по столбцу; за краем — остаёмся", () => {
    expect(nextCell("Enter", { row: 0, col: "quantity" }, 3)).toEqual({ row: 1, col: "quantity" });
    expect(nextCell("Enter", { row: 2, col: "quantity" }, 3)).toBeNull();
    expect(nextCell("Enter", { row: 1, col: "quantity" }, 3, true)).toEqual({ row: 0, col: "quantity" });
    expect(nextCell("ArrowUp", { row: 0, col: "quantity" }, 3)).toBeNull();
    expect(nextCell("ArrowDown", { row: 1, col: "costPrice" }, 3)).toEqual({ row: 2, col: "costPrice" });
    expect(nextCell("a", { row: 1, col: "quantity" }, 3)).toBeNull();
  });
});

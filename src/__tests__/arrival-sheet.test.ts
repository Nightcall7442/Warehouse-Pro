/**
 * Логика листа прихода — без браузера.
 *
 * Что проверяется: товары пачкой без дублей, скан +1, «пришло = по
 * накладной» не затирает посчитанное, упаковки ↔ штуки, разница с
 * накладной, итоги, вставка столбца из Excel (числа «1 200,50», мусор
 * пропускается, лишние строки отброшены), что уходит на сервер (строка по
 * накладной без «пришло» — нулём), проверки до отправки (пустая строка и
 * «пришло 0» без накладной — ошибка в ячейке, а не отказ всего сохранения),
 * строки из документа (ноль — «не считали», «состояние» едет обратно),
 * клавиатура сетки.
 *
 * Нарочные поломки: в problems() верни `r.quantity.trim() === ""` вместо
 * `!(num(r.quantity) > 0)` — падает «ноль без накладной»; убери condition из
 * toPayload — падает «состояние строки не стирается».
 */
import { describe, it, expect } from "vitest";
import {
  rowFromProduct, addProducts, applyScan, fillFromExpected, boxesToQuantity, quantityToBoxes, diff, markupPct, pctText,
  totals, pasteRange, toPayload, problems, rowsFromDetail, type SheetRow,
} from "@/lib/arrival-sheet";
import { nextCell, parseClipboard, isRangePaste, normalizeNumber } from "@/lib/grid-nav";

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
    expect(r.added).toBe(1);
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
    // Та же формула — маржа прайс-листа (числа) и сводка прихода.
    expect(markupPct(8000, 12000)).toBe(50);
    expect([pctText(33.3), pctText(-7), pctText(null)]).toEqual(["+33.3%", "-7%", ""]);
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
    expect(r.map(x => x.quantity)).toEqual(["", "", "5", "6"]);
  });

  it("диапазон вправо: пришло → закупка → продажа; «1 200,50» — число; мусор пропускается", () => {
    const r = pasteRange([row(juice)], 0, "quantity", parseClipboard("10\t1 200,50\tабв"));
    expect(r[0]).toMatchObject({ quantity: "10", costPrice: "1200.50", sellingPrice: "12000" });
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
  it("строка по накладной уходит нулём; числа — с двумя знаками", () => {
    const p = toPayload([
      row(juice, { expected: "24" }),
      row({ ...water, id: 3 }, { quantity: "4.5", costPrice: "2000", batchNumber: " L-7 ", expiresAt: "2027-01-01" }),
    ]);
    expect(p).toEqual([
      { productId: 1, quantity: "0.00", expectedQuantity: "24.00", costPrice: "9000.00", sellingPrice: "12000.00", batchNumber: undefined, expiresAt: undefined, condition: undefined },
      { productId: 3, quantity: "4.50", expectedQuantity: undefined, costPrice: "2000.00", sellingPrice: "3000.00", batchNumber: "L-7", expiresAt: "2027-01-01", condition: undefined },
    ]);
  });

  it("до отправки: срок раньше даты прихода и строка без количества", () => {
    const pr = problems([row(juice, { quantity: "1", expiresAt: "2026-09-01" }), row(water)], "2026-09-24");
    expect(pr.map(x => [x.row, x.col])).toEqual([[0, "expiresAt"], [1, "quantity"]]);
  });

  /*
    27.09.2026: ноль в «Пришло» без накладной проверка пропускала, toPayload
    слал «0.00» без expectedQuantity, и refine arrivalItemInput отвергал всё
    сохранение целиком, не подсветив ни строки, ни ячейки.
  */
  it("ноль без накладной — ошибка в ячейке; что прошло проверку, сервер не отвергнет", () => {
    const rows = [
      row(juice, { quantity: "0" }),                 // ноль, накладной нет — ошибка
      row(water, { quantity: "0.00" }),              // из Excel — то же
      row({ ...water, id: 3 }, { quantity: " " }),   // пробел — то же, что пусто
      row({ ...water, id: 4 }, { quantity: "0", expected: "12" }), // ждали 12, не приехало — можно
      row({ ...water, id: 5 }, { expected: "0" }),   // ждали ноль — сервер принимает
      row({ ...water, id: 6 }, { quantity: "3" }),
    ];
    expect(problems(rows, "2026-09-24").map(p => [p.row, p.col])).toEqual([[0, "quantity"], [1, "quantity"], [2, "quantity"]]);

    // То же правило, что refine в api/arrival-router.ts: строка без ошибок проходит.
    const serverAccepts = (i: { quantity: string; expectedQuantity?: string }) => Number(i.quantity) > 0 || i.expectedQuantity != null;
    const clean = rows.filter((_, i) => !problems(rows, "2026-09-24").some(p => p.row === i));
    expect(clean).toHaveLength(3);
    expect(toPayload(clean).every(serverAccepts)).toBe(true);
    expect(toPayload(rows.slice(0, 3)).some(serverAccepts)).toBe(false);
  });

  it("минус — ошибка в своей ячейке, одна; сервер отказал бы всему сохранению", () => {
    const rows = [
      row(juice, { quantity: "-5" }),                 // минус без накладной — одна ошибка, не две
      row(water, { quantity: "-5", expected: "12" }), // минус при накладной
      row({ ...water, id: 3 }, { quantity: "4", expected: "-1" }),
    ];
    expect(problems(rows, "2026-09-24").map(p => [p.row, p.col])).toEqual([[0, "quantity"], [1, "quantity"], [2, "expected"]]);
  });

  it("строки документа: ноль в «пришло» — ещё не считали; накладная и партия сохраняются", () => {
    const rows = rowsFromDetail([
      { productId: 1, productName: "Сок", productCode: "S-1", quantity: 0, expectedQuantity: 24, costPrice: "9000.00", sellingPrice: "0.00", batchNumber: null, expiresAt: null, unit: "pcs", unitWeight: "1.05", packSize: "12.00", packLabel: "короб" },
      { productId: 2, productName: "Вода", productCode: "W-1", quantity: 10, expectedQuantity: null, costPrice: "0.00", sellingPrice: "3000.00", batchNumber: "B", expiresAt: "2027-01-01" },
    ]);
    expect(rows[0]).toMatchObject({ quantity: "", expected: "24", costPrice: "9000", sellingPrice: "", packSize: 12 });
    expect(rows[1]).toMatchObject({ quantity: "10", expected: "", sellingPrice: "3000", batchNumber: "B", expiresAt: "2027-01-01", unit: "pcs" });
  });

  /*
    27.09.2026: setItems заменяет строки целиком, а в SheetRow и toPayload
    «состояния» не было — правка одного количества в ожидающем приходе,
    заведённом прежней формой, молча стирала «Повреждено, 3 шт».
  */
  it("состояние строки не стирается: из документа — обратно на сервер", () => {
    const rows = rowsFromDetail([
      { productId: 1, productName: "Сок", productCode: "S-1", quantity: 10, expectedQuantity: null, costPrice: "9000.00", sellingPrice: "12000.00", batchNumber: null, expiresAt: null, condition: "Повреждено, 3 шт" },
      { productId: 2, productName: "Вода", productCode: "W-1", quantity: 5, expectedQuantity: null, costPrice: "0.00", sellingPrice: "3000.00", batchNumber: null, expiresAt: null, condition: "" },
    ]);
    const edited = rows.map((r, i) => (i === 0 ? { ...r, quantity: "9" } : r));
    expect(toPayload(edited).map(p => [p.quantity, p.condition])).toEqual([["9.00", "Повреждено, 3 шт"], ["5.00", undefined]]);
    // Строка из карточки и черновик до 27.09 — без поля: уходят без него, не падают.
    expect("condition" in row(juice)).toBe(false);
    expect(toPayload([row(juice, { quantity: "1" })])[0].condition).toBeUndefined();
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

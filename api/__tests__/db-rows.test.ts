import { describe, it, expect } from "vitest";
import { rowsOf, firstRow } from "../lib/db-rows";

/**
 * Форма ответа mysql2 — [rows, fields], где оба элемента массивы. Именно
 * поэтому неверное обращение не падает, а тихо отдаёт undefined: в этой базе
 * кода так одновременно жили три ошибки — автокоды товаров, два графика в
 * кабинете суперадмина и сверка размеров таблиц при бэкапе.
 */
describe("rowsOf", () => {
  const rows = [{ month: "2026-07", cnt: "5" }, { month: "2026-08", cnt: "9" }];

  it("разворачивает кортеж [rows, fields]", () => {
    expect(rowsOf([rows, []])).toEqual(rows);
  });

  it("не путает fields со строками", () => {
    // Прежний код делал result.map(...) и получал ДВА элемента: сами строки и
    // fields. Оба без нужных полей, поэтому график рисовал точки без месяца.
    const out = rowsOf<{ month: string }>([rows, [{ name: "month" }]]);
    expect(out).toHaveLength(2);
    expect(out.map(r => r.month)).toEqual(["2026-07", "2026-08"]);
  });

  it("принимает строки, отданные напрямую", () => {
    // Часть стендов и обёрток отдаёт строки без кортежа — такой ответ должен
    // обрабатываться так же, иначе помощник сам станет источником нулей.
    expect(rowsOf(rows)).toEqual(rows);
  });

  it("отдаёт пустой массив на пустом и неожиданном ответе", () => {
    expect(rowsOf([])).toEqual([]);
    expect(rowsOf([[], []])).toEqual([]);
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf({ affectedRows: 1 })).toEqual([]);
  });
});

describe("firstRow", () => {
  it("достаёт строку из кортежа, а не массив строк", () => {
    // Ровно это ломало автонумерацию: result[0] — массив, у него нет maxCode,
    // значение уходило в ?? 0, и импорт каждый раз начинал коды заново.
    expect(firstRow<{ maxCode: string }>([[{ maxCode: "42" }], []])?.maxCode).toBe("42");
  });

  it("возвращает undefined, когда строк нет", () => {
    expect(firstRow([[], []])).toBeUndefined();
    expect(firstRow([])).toBeUndefined();
  });

  it("не выдаёт массив за строку", () => {
    const wrong = ([[{ maxCode: "42" }], []] as unknown as Array<{ maxCode?: string }>)[0]?.maxCode;
    expect(wrong).toBeUndefined();               // как было написано раньше
    expect(firstRow<{ maxCode: string }>([[{ maxCode: "42" }], []])?.maxCode).toBe("42"); // как стало
  });
});

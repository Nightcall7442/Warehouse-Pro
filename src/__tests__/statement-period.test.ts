/**
 * Периоды акта сверки — словами бухгалтера, а не «30 дней назад».
 *
 * Арендатор просил «по период выбрать» (09.10.2026): за месяц, за квартал,
 * с начала года. Здесь проверяются стыки, на которых такие отрезки обычно
 * ломаются: январь (прошлый месяц — в прошлом году), первый квартал (прошлый —
 * четвёртый прошлого года), последний день февраля, и местная дата вместо UTC.
 */
import { describe, it, expect } from "vitest";
import { presetRange, localDay, dayToRu, isStatementPreset, STATEMENT_PRESETS } from "@contracts/statement-period";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("готовые периоды акта", () => {
  it("этот месяц — с первого числа по сегодня, не до конца месяца", () => {
    expect(presetRange("thisMonth", at(2026, 10, 9))).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  });

  it("прошлый месяц в январе — декабрь прошлого года целиком", () => {
    expect(presetRange("lastMonth", at(2026, 1, 15))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("прошлый месяц в марте кончается последним днём февраля", () => {
    expect(presetRange("lastMonth", at(2026, 3, 31))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("lastMonth", at(2028, 3, 1))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("квартал: этот — с начала квартала, прошлый — целиком", () => {
    expect(presetRange("thisQuarter", at(2026, 10, 9))).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    expect(presetRange("lastQuarter", at(2026, 10, 9))).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetRange("thisQuarter", at(2026, 6, 30))).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("прошлый квартал в первом квартале — четвёртый прошлого года", () => {
    expect(presetRange("lastQuarter", at(2026, 2, 10))).toEqual({ from: "2025-10-01", to: "2025-12-31" });
  });

  it("год: с начала — по сегодня, прошлый — целиком", () => {
    expect(presetRange("thisYear", at(2026, 10, 9))).toEqual({ from: "2026-01-01", to: "2026-10-09" });
    expect(presetRange("lastYear", at(2026, 10, 9))).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("всё время — без дат, свой период — даты вводит человек", () => {
    expect(presetRange("all", at(2026, 10, 9))).toEqual({ from: "", to: "" });
    expect(presetRange("custom", at(2026, 10, 9))).toBeNull();
  });

  it("сегодня — по местному календарю: в два ночи это уже сегодня, а не вчера по UTC", () => {
    // В Ташкенте (UTC+5) 02:00 — ещё вчерашний день по UTC; прежний код
    // (toISOString) отдавал именно его.
    expect(localDay(at(2026, 10, 10, 2))).toBe("2026-10-10");
  });

  it("каждый отрезок кончается не раньше, чем начинается", () => {
    for (const p of STATEMENT_PRESETS) {
      const r = presetRange(p.id, at(2026, 1, 1));
      if (r && r.from) expect(r.from <= r.to, p.id).toBe(true);
    }
  });

  it("у каждого отрезка есть слова на обоих языках", () => {
    for (const p of STATEMENT_PRESETS) {
      expect(p.ru.trim(), p.id).not.toBe("");
      expect(p.uz.trim(), p.id).not.toBe("");
    }
  });

  it("чужое значение из адреса страницы не считается отрезком", () => {
    expect(isStatementPreset("lastMonth")).toBe(true);
    expect(isStatementPreset("30")).toBe(false);
    expect(isStatementPreset(null)).toBe(false);
  });

  it("дата для бумаги — без часовых поясов", () => {
    expect(dayToRu("2026-10-09")).toBe("09.10.2026");
  });
});

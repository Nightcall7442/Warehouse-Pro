import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Засев — история, а не план: ни одна дата в нём не в будущем.
 *
 * daysAgo отсчитывал часы от восьми утра, а заказы просили ещё «8 +» сверху:
 * сегодняшние ложились на 16:00–01:00 следующего дня. При утреннем прогоне
 * CI (12:46 UTC, 21.09.2026) они стояли в списке выше только что оформленного
 * заказа, e2e «жизнь заказа» не находила свой заказ на первой странице, и
 * упали оба открытых PR — ни один из них список не трогал. Вечерний прогон
 * накануне проходил.
 *
 * Сам засев зовёт базу при импорте, поэтому здесь — по тексту.
 * Нарочная поломка: верни «8 +» в вызов или убери ограничитель — упадёт.
 */
const seed = fs.readFileSync(path.resolve(process.cwd(), "db/seed.ts"), "utf8").replace(/\r\n/g, "\n");
// daysAgo с 25.09.2026 живёт в db/seed-dates.ts — там его и проверяют поведением
// (src/__tests__/seed-today-stays-today.test.ts); здесь — что засев берёт именно его.
const dates = fs.readFileSync(path.resolve(process.cwd(), "db/seed-dates.ts"), "utf8").replace(/\r\n/g, "\n");

describe("засев не датирует будущим", () => {
  it("daysAgo не отдаёт дату позже «сейчас»", () => {
    expect(seed).toContain('import { daysAgo } from "./seed-dates"');
    expect(dates).toMatch(/if \(d\.getTime\(\) > now\) \{\s*d\.setTime\(Math\.max\(dayStart\.getTime\(\), now -/);
  });

  it("часы заказов — от восьми утра один раз, а не дважды", () => {
    expect(seed).toContain("const createdAt = daysAgo(daysBack, Math.floor(rnd() * 10));");
    expect(seed).not.toContain("daysAgo(daysBack, 8 +");
  });
});

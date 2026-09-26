import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hoursAfter } from "../../db/seed-dates";

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
 * Сам daysAgo проверяется поведением в src/__tests__/seed-today-stays-today.test.ts.
 * Засев зовёт базу при импорте, поэтому вызовы в нём — по тексту.
 * Нарочная поломка: верни «8 +» в вызов — падает «от восьми утра»; верни
 * доставке «createdAt.getTime() + …» или убери Math.min из hoursAfter —
 * падает «доставка и слово магазина».
 */
const seed = fs.readFileSync(path.resolve(process.cwd(), "db/seed.ts"), "utf8").replace(/\r\n/g, "\n");

describe("засев не датирует будущим", () => {
  it("часы заказов — от восьми утра один раз, а не дважды", () => {
    expect(seed).toContain("const createdAt = daysAgo(daysBack, Math.floor(rnd() * 10));");
    expect(seed).not.toContain("daysAgo(daysBack, 8 +");
  });

  /*
    Сегодняшний доставленный заказ в 12:20 получал «доставлен» в 17:20 и
    «подтверждён магазином» в 21:20 — «Контроль» и курьер показывали то,
    чего ещё не было (26.09.2026).
  */
  it("доставка и слово магазина — не позже «сейчас»", () => {
    const now = new Date(2026, 8, 25, 12, 46).getTime();
    const created = new Date(2026, 8, 25, 12, 20);
    expect(hoursAfter(created, 5, now).getTime()).toBe(now);
    expect(hoursAfter(created, 9, now).getTime()).toBe(now);
    // Вчерашнее событие остаётся на своём часе — ограничитель трогает только будущее.
    expect(hoursAfter(new Date(2026, 8, 24, 9, 0), 9, now)).toEqual(new Date(2026, 8, 24, 18, 0));

    for (const field of ["deliveredAt", "shopConfirmedAt", "shopDisputedAt"]) {
      expect(seed, field).toMatch(new RegExp(`\\b${field}: [^\\n]*\\? hoursAfter\\(createdAt, `));
    }
    expect(seed, "метка времени снова считается от createdAt без ограничителя").not.toMatch(/createdAt\.getTime\(\) \+/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daysAgo } from "../../db/seed-dates";

/**
 * «Сегодня» засева остаётся сегодня — в любой час прогона.
 *
 * 25.09.2026 съёмка лендинга засеяла базу в 00:15 UTC. Сегодняшние визиты
 * ставились на 8 утра, это «будущее», и откат «сейчас минус до получаса»
 * уводил их во вчера: «Мой день» и «План» на кадрах — «На сегодня визитов
 * нет», при подписи лендинга «Точки на сегодня… Был — отметил».
 *
 * Нарочная поломка: в seed-dates.ts убери Math.max(dayStart…) — падает
 * «сразу после полуночи»; поставь откат вперёд (now + …) — «никогда в
 * будущем»; убери geolocation из контекста мобилки — последний.
 */
const at = (h: number, m: number) => { const d = new Date(2026, 8, 25, h, m, 0, 0); return d.getTime(); };
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

describe("засев: сегодня — это сегодня", () => {
  it("сразу после полуночи сегодняшнее не уезжает во вчера", () => {
    for (const minute of [0, 1, 5, 14, 29]) {
      const now = at(0, minute);
      for (let i = 0; i < 50; i++) {
        const d = daysAgo(0, 0, now);
        expect(sameDay(d, new Date(now)), `00:${minute} → ${d.toString()}`).toBe(true);
      }
    }
  });

  it("никогда в будущем — в любой час", () => {
    for (let h = 0; h < 24; h++) {
      const now = at(h, 7);
      for (const off of [0, 3, 9]) expect(daysAgo(0, off, now).getTime()).toBeLessThanOrEqual(now);
    }
  });

  it("днём сегодняшнее — утро этого дня, вчерашнее — утро вчера", () => {
    const now = at(14, 0);
    const today = daysAgo(0, 0, now);
    expect(today.getHours()).toBe(8);
    expect(sameDay(today, new Date(now))).toBe(true);
    const y = daysAgo(1, 0, at(0, 10));
    expect(y.getDate()).toBe(24);
    expect(y.getHours()).toBe(8);
  });

  it("засев берёт общую функцию, а съёмка мобилки выдаёт геолокацию", () => {
    const seed = readFileSync(join(process.cwd(), "db/seed.ts"), "utf-8");
    expect(seed).toContain('import { daysAgo } from "./seed-dates"');
    expect(seed).not.toMatch(/function daysAgo/);
    const shots = readFileSync(join(process.cwd(), "scripts/screenshots.mjs"), "utf-8");
    const mobileCtx = shots.slice(shots.indexOf("async function shootMobile"));
    expect(mobileCtx).toMatch(/newContext\(\{[\s\S]*?geolocation: \{ latitude: [\d.]+, longitude: [\d.]+ \}, permissions: \["geolocation"\]/);
  });
});

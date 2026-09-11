/**
 * Ни один список не принимает размер страницы без потолка.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * user.list, product.list, arrival.list и returns.list объявляли
 * pageSize: z.number().default(25) — без min, без max, без int. Любой
 * вошедший мог запросить страницу в миллиард строк и положить сервер одним
 * запросом; экраны веба и так просили 5 000–10 000 (Склад, форма прихода,
 * экспорт товаров), то есть потолок 10 000 уже был фактическим у
 * warehouseMulti.getStock — просто не у всех.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Каждое объявление pageSize и limit в роутерах несёт .max(…). Потолок
 * 10 000 повторяет существующий у getStock и ничего не ломает у нынешних
 * экранов; ponytail: снижать до 500 можно только после перевода формы
 * прихода и Склада на серверный поиск (дорожная карта 7.3).
 *
 * Нарочная поломка: убери .max(10000) у product.list — проверка называет
 * файл и строку.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const API = resolve(__dirname, "..");

describe("размер страницы ограничен сверху", () => {
  it("каждый pageSize/limit в роутерах несёт .max()", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(API).filter(f => f.endsWith("-router.ts"))) {
      const lines = readFileSync(join(API, name), "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (/\b(pageSize|limit):\s+z\.number\(\)/.test(line) && !/\.max\(/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(offenders, "объявления без потолка").toEqual([]);
  });
});

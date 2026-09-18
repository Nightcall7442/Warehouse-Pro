/**
 * Журнал для сквозных проверок отмечает КАЖДУЮ миграцию, а не одну последнюю.
 *
 * Догон (migration-catchup) сверяет журнал построчно и применяет всё, чего в
 * таблице нет, прощая «уже есть». С одной записью он переигрывал 57 старых
 * файлов поверх схемы от drizzle-kit push — и 0052 снимала orders.warehouse_id,
 * которую 0057 вернула: сервер стартовал, первый заказ падал на «Unknown
 * column». Нарочная поломка: верни одну запись с Math.max — тест падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/e2e-baseline-journal.mjs", "utf-8");
const catchup = readFileSync("api/lib/migration-catchup.ts", "utf-8");

describe("e2e-baseline-journal", () => {
  it("вставляет строку на каждую запись журнала с её when", () => {
    expect(script).toMatch(/for \(const e of journal\.entries\) \{[\s\S]*?insert into `__drizzle_migrations`[\s\S]*?e\.when/);
    // Одной записи «последняя метка» больше нет.
    expect(script).not.toMatch(/values \(\?, \?\)",\s*\[`e2e-baseline:\$\{journal\.entries\.length\}/);
  });

  it("догон по-прежнему сверяет построчно по when — поэтому нужна каждая", () => {
    expect(catchup).toContain("journal.entries.filter(e => !applied.has(String(e.when)))");
  });
});

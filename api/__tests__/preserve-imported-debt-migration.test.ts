import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
  Миграция 0073 записывает строкой «долг» ту часть shops.debt, которую записи
  не объясняют (долг из старого импорта). «Не объясняют» — значит больше, чем
  дал бы recalcShopDebt. Если формула в миграции хоть словом разойдётся с
  кодом, магазину запишется долг, которого нет, — и первый же пересчёт сделает
  его настоящим. Поэтому формулы сверяются здесь буква в букву.
*/
const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** SQL без комментариев и с одним пробелом вместо любых пробелов. */
function normalize(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
    .trim();
}

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  expect(a, `не найдено «${start}»`).toBeGreaterThanOrEqual(0);
  const b = text.indexOf(end, a + start.length);
  expect(b, `не найдено «${end}»`).toBeGreaterThan(a);
  return text.slice(a + start.length, b);
}

describe("миграция 0073: долг считается той же формулой, что recalcShopDebt", () => {
  const code = read("api/services/shop-debt.ts");
  const migration = read("db/migrations/0073_preserve_imported_shop_debt.sql");

  const paidOnOrder = between(code, "const PAID_ON_ORDER = sql`", "`;");
  const recalc = between(code, "export async function recalcShopDebt", "WHERE s.id = ${shopId}");
  const fromCode = recalc.slice(recalc.indexOf("SET s.debt = ") + "SET s.debt = ".length)
    .replace("${PAID_ON_ORDER}", paidOnOrder);
  const fromMigration = between(migration, "ROUND(CAST(s.debt AS DECIMAL(15,2)) - ", ", 2) AS gap");

  it("формулы совпадают", () => {
    expect(normalize(fromMigration)).toBe(normalize(fromCode));
  });

  it("пишет только недостающее и только вверх", () => {
    expect(migration).toContain("WHERE d.gap > 0.01");
    expect(migration).toContain("'debt'");
    expect(normalize(migration)).toContain("SELECT d.tenant_id, d.shop_id, NULL, d.gap, 'debt'");
  });

  it("в журнале миграций и со снимком", () => {
    const journal = JSON.parse(read("db/migrations/meta/_journal.json")) as { entries: Array<{ tag: string }> };
    expect(journal.entries.map(e => e.tag)).toContain("0073_preserve_imported_shop_debt");
    expect(() => read("db/migrations/meta/0073_snapshot.json")).not.toThrow();
  });
});

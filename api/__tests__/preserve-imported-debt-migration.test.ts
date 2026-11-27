import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
  Миграция 0073 записывает строкой «долг» ту часть shops.debt, которую записи
  не объясняют (долг из старого импорта). «Не объясняют» — значит больше, чем
  дал бы recalcShopDebt. Если формула миграции даст долг МЕНЬШЕ, чем код, —
  магазину запишется долг, которого нет, и первый же пересчёт сделает его
  настоящим. Поэтому формулы сверяются здесь буква в букву.

  С одним известным расхождением. Миграцию писали, когда на каждом заказе
  стоял пол GREATEST(0, total − paid); потом его сняли (переплата гасит
  соседние заказы, бизнес-аудит 19.11.2026, п. 5). Пол только поднимает
  расчётный долг, значит зазор у миграции не больше, чем был бы по новой
  формуле, — она запишет не больше настоящего. Сверка ниже возвращает пол в
  формулу кода и требует совпадения во всём остальном: любое другое
  расхождение — уже не это и падает.
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
  const PER_ORDER = "THEN CAST(o.total AS DECIMAL(15,2)) - ${PAID_ON_ORDER}";
  const recalcTail = recalc.slice(recalc.indexOf("SET s.debt = ") + "SET s.debt = ".length);
  // Формула кода с полом на заказе, как в день миграции (см. выше).
  // И без правила «наличные на руках долг не гасят» (COUNTS_FOR_DEBT, 27.11.2026):
  // в день миграции платёж гасил долг в момент записи.
  const before2711 = (t: string) => t
    .replaceAll(" AND ${COUNTS_FOR_DEBT}", "")
    .replace(
      "SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p\n        WHERE p.shop_id = s.id AND p.tenant_id = s.tenant_id AND p.type = 'payment' AND p.order_id IS NULL",
      "SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments\n        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'payment' AND order_id IS NULL",
    )
    .replace(
      "SELECT SUM(CAST(p.amount AS DECIMAL(15,2)))\n        FROM payments p\n        JOIN orders o2 ON o2.id = p.order_id\n        WHERE p.shop_id = s.id AND p.tenant_id = s.tenant_id AND p.type = 'payment'",
      "SELECT SUM(CAST(p2.amount AS DECIMAL(15,2)))\n        FROM payments p2\n        JOIN orders o2 ON o2.id = p2.order_id\n        WHERE p2.shop_id = s.id AND p2.tenant_id = s.tenant_id AND p2.type = 'payment'",
    );
  const fromCode = before2711(recalcTail)
    .replace(PER_ORDER, "THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - ${PAID_ON_ORDER})")
    .replace("${PAID_ON_ORDER}", before2711(paidOnOrder));
  const fromMigration = between(migration, "ROUND(CAST(s.debt AS DECIMAL(15,2)) - ", ", 2) AS gap");

  it("формулы совпадают во всём, кроме снятого потом пола на заказе", () => {
    expect(recalcTail, "у recalcShopDebt изменилась ветка заказа — пересмотрите сверку").toContain(PER_ORDER);
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

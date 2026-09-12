/**
 * Долгие операции внутри HTTP: прибыль считается разом, импорт — пачками.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Страница прибыли ждала пять чтений базы друг за другом, и ещё раз столько
 * же за прошлый период — сумму десяти задержек. Импорт товаров шёл по одной
 * строке с автокоммитом: четыре-пять запросов на товар, каждый — fsync на
 * управляемой базе; две тысячи строк — минуты внутри одного запроса.
 *
 * Нарочная поломка: замени в analytics-router `Promise.all([` у calcPeriod
 * на последовательные await — первый тест назовёт место.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("прибыль", () => {
  it("пять чтений периода и два периода — разом", () => {
    const src = read("api/analytics-router.ts");
    const at = src.indexOf("async function calcPeriod(");
    const body = src.slice(at, src.indexOf("const delta = (curr", at));
    expect(body).toContain("revRowP, cogsRowP, expenseRowP, payrollRowP, returnsInPeriod(db, tid, dateFrom, dateTo),");
    expect(body).not.toMatch(/const (revRow|cogsRow|expenseRow|payrollRow) = await db\.select/);
    expect(body).toMatch(/const \[current, previous\] = await Promise\.all\(\[/);
  });
});

describe("импорт товаров", () => {
  it("пачками по сто строк в транзакции; фото в S3 — до транзакции; дубль одной строки не роняет пачку", () => {
    const src = read("api/import-router.ts");
    const at = src.indexOf("const CHUNK = 100;");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("if (blockedByPlan > 0)", at));
    expect(body).toContain("await db.transaction(async (tx) => {");
    expect(body).toContain("await tx.insert(products).values({");
    expect(body).toContain("await setStock(tx, {");
    // фото — снаружи транзакции
    expect(body.indexOf("uploadBase64ToS3(")).toBeLessThan(body.indexOf("await db.transaction("));
    // ошибка строки ловится внутри пачки
    expect(body).toMatch(/for \(const row of chunk\) \{\s*if \(room <= 0\)[\s\S]*?try \{[\s\S]*?\} catch \(err: unknown\) \{\s*noteRowError\(row, err\);/);
  });
});

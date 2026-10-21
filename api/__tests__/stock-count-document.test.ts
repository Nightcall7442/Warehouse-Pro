/**
 * Инвентаризация — документ. Здесь то, что проверяется без базы; арифметика
 * применения — real-db/stock-count.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("документ инвентаризации", () => {
  const router = readFileSync("api/stock-count-router.ts", "utf-8");
  // Цикл применения — общий у прямого применения и утверждения директором.
  const service = readFileSync("api/services/stock-count.ts", "utf-8");

  it("применяет через дверь остатка и пишет движение «inventory»; непосчитанное не трогает; применённый не правится", () => {
    expect(service).toContain("await setStock(tx, { tenantId, warehouseId: count.warehouseId, productId: it.productId, quantity: target });");
    expect(service).toContain('"inventory"');
    expect(service).toContain("const target = mode === \"absolute\" ? counted : round2(current + (counted - book));");
    expect(router).toContain("const toApply = items.filter(i => i.counted != null);");
    expect(router).toContain('applyCountLines(tx, ctx.tenant.id, count, toApply.map(');
    expect(router).toMatch(/if \(status !== "draft"\) throw new TRPCError\(\{ code: "PRECONDITION_FAILED"/);
    // разница — от ТЕКУЩЕГО остатка под блокировкой, не от снимка
    expect(service).toMatch(/\.for\("update"\)\.limit\(1\);\s*const current = Number\(row\?\.current \?\? 0\);/);
    expect(readFileSync("api/services/stock-ledger.ts", "utf-8")).toMatch(/\| "inventory"\s/);
  });

  it("только офис с правом warehouse.adjust; в дереве роутеров; вкладка на складе со сканером", () => {
    expect(router).toMatch(/create: operatorQuery\.use\(can\("warehouse\.adjust"\)\)/);
    // Применить самому — ещё и право проводить без утверждения директора.
    expect(router).toMatch(/applyCount: operatorQuery.use\(can\("warehouse\.adjust"\)\)\.use\(can\("warehouse\.apply"\)\)/);
    expect(readFileSync("api/router.ts", "utf-8")).toContain("stockCount:   stockCountRouter,");
    const ui = readFileSync("src/components/warehouse/StockCounts.tsx", "utf-8");
    for (const id of ["stock-count-new", "stock-count-wedge", "stock-count-scan", "stock-count-apply", "stock-count-submit", "stock-count-approve", "stock-count-reject"]) expect(ui).toContain(`"${id}"`);
    expect(readFileSync("src/pages/Warehouse.tsx", "utf-8")).toContain('{activeTab === "counts" && canAdjust && (');
  });

  it("миграции документа (создание и утверждение) — только схема (правило с 0028)", () => {
    // Номер второй ищется по имени: при слиянии веток миграции перенумеровывают.
    const approval = readdirSync("db/migrations").filter(f => f.endsWith("_stock_count_approval.sql"));
    expect(approval).toHaveLength(1);
    for (const file of ["0032_stock_counts.sql", ...approval]) {
      const sqlText = readFileSync(`db/migrations/${file}`, "utf-8");
      const statements = sqlText.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
      expect(statements.every(s => /^(CREATE|ALTER)\b/.test(s)), file).toBe(true);
    }
  });
});

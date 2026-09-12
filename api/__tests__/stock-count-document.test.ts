/**
 * Инвентаризация — документ. Здесь то, что проверяется без базы; арифметика
 * применения — real-db/stock-count.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("документ инвентаризации", () => {
  const router = readFileSync("api/stock-count-router.ts", "utf-8");

  it("применяет через дверь остатка и пишет движение «inventory»; непосчитанное не трогает; применённый не правится", () => {
    expect(router).toContain("await setStock(tx, { tenantId: ctx.tenant.id, warehouseId: count.warehouseId, productId: it.productId, quantity: counted });");
    expect(router).toContain('reason: "inventory"');
    expect(router).toContain("const toApply = items.filter(i => i.counted != null);");
    expect(router).toMatch(/if \(count\.status !== "draft"\) throw new TRPCError\(\{ code: "PRECONDITION_FAILED"/);
    // разница — от ТЕКУЩЕГО остатка под блокировкой, не от снимка
    expect(router).toMatch(/\.for\("update"\)\.limit\(1\);\s*const current = Number\(row\?\.current \?\? 0\);/);
    expect(readFileSync("api/services/stock-ledger.ts", "utf-8")).toContain('| "inventory";');
  });

  it("только офис с правом warehouse.adjust; в дереве роутеров; вкладка на складе со сканером", () => {
    expect(router).toMatch(/create: operatorQuery\.use\(can\("warehouse\.adjust"\)\)/);
    expect(router).toMatch(/applyCount: operatorQuery.use\(can\("warehouse\.adjust"\)\)/);
    expect(readFileSync("api/router.ts", "utf-8")).toContain("stockCount:   stockCountRouter,");
    const ui = readFileSync("src/components/warehouse/StockCounts.tsx", "utf-8");
    for (const id of ["stock-count-new", "stock-count-wedge", "stock-count-scan", "stock-count-apply"]) expect(ui).toContain(`"${id}"`);
    expect(readFileSync("src/pages/Warehouse.tsx", "utf-8")).toContain('{activeTab === "counts" && canAdjust && (');
  });

  it("миграция 0032 — только схема (правило с 0028)", () => {
    const sqlText = readFileSync("db/migrations/0032_stock_counts.sql", "utf-8");
    const statements = sqlText.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    expect(statements.every(s => /^(CREATE|ALTER)\b/.test(s))).toBe(true);
  });
});

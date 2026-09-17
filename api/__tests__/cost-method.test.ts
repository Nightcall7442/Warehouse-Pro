/**
 * Себестоимость при приходе: «последняя закупка» или «средняя по остатку».
 *
 *   · формула средней — по количеству, от остатка ДО приёмки; при равных
 *     объёмах совпадает с «пополам» (пример Serena: 55 000 и 60 000 → 57 500);
 *   · ноль в приходе — «не трогать»; пустая карточка (0) — берётся приход;
 *   · правило — одно на организацию, по умолчанию «последняя» — для всех,
 *     кто ничего не менял, поведение не меняется;
 *   · приход читает правило и остаток по всем складам до приёмки, пишет
 *     журнал только когда средняя отличается от закупки;
 *   · настройка отдаётся и принимается settings.get/update, переключатель
 *     стоит в «Складах»; журнал действий знает product.cost_averaged;
 *     миграция 0050 без хвостового маркера.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextCostPrice } from "../services/cost-method";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("формула", () => {
  it("последняя закупка — как есть; средняя — по количеству от остатка до приёмки", () => {
    expect(nextCostPrice("last", 100, 55000, 10, 60000)).toBe(60000);
    expect(nextCostPrice("average", 100, 55000, 10, 60000)).toBe(55454.55);
    // Равные объёмы — «пополам», как просила Serena.
    expect(nextCostPrice("average", 10, 55000, 10, 60000)).toBe(57500);
    // Подешевело — среднее падает, но не до новой цены.
    expect(nextCostPrice("average", 30, 60000, 10, 50000)).toBe(57500);
  });
  it("ноль в приходе — не трогать; пустая карточка или пустой склад — приход целиком; отрицательный остаток не участвует", () => {
    expect(nextCostPrice("average", 100, 55000, 10, 0)).toBe(55000);
    expect(nextCostPrice("last", 100, 55000, 10, 0)).toBe(55000);
    expect(nextCostPrice("average", 100, 0, 10, 60000)).toBe(60000);
    expect(nextCostPrice("average", 0, 55000, 10, 60000)).toBe(60000);
    expect(nextCostPrice("average", -5, 55000, 10, 60000)).toBe(60000);
    expect(nextCostPrice("average", 100, 55000, 0, 60000)).toBe(60000);
    expect(nextCostPrice("average", 3, 10.005, 1, 20)).toBe(12.5);
  });
});

describe("проводка и экраны", () => {
  it("приход читает правило организации и остаток по всем складам ДО приёмки; журнал — только при усреднении", () => {
    const a = read("api/services/arrival.ts");
    expect(a).toContain('const costMethod: CostMethod = cfg?.costMethod ?? "last";');
    expect(a.indexOf("coalesce(sum(${warehouseStock.currentStock}), 0)")).toBeLessThan(a.indexOf("await receiveStock(tx, {"));
    expect(a).toContain("const cost = nextCostPrice(costMethod, onHandBefore, oldCost, qty, newCost);");
    expect(a).toContain("if (newCost > 0) pricePatch.costPrice = cost.toFixed(2);");
    expect(a).toContain('if (newCost > 0 && costMethod === "average" && Math.abs(cost - newCost) >= 0.01) {');
    expect(a).toContain('action: "product.cost_averaged"');
  });
  it("по умолчанию — «последняя»; настройка ходит через settings.get/update; переключатель в «Складах»", () => {
    expect(read("db/schema.ts")).toContain('costMethod:          mysqlEnum("cost_method", ["last", "average"]).default("last").notNull(),');
    const r = read("api/settings-router.ts");
    expect(r).toContain("costMethod: settings.costMethod,");
    expect(r).toContain('costMethod:          z.enum(["last", "average"]).optional(),');
    const ui = read("src/components/settings/WarehouseSettings.tsx");
    expect(ui).toContain('data-testid={`cost-method-${value}`}');
    expect(ui).toContain("onChange={() => saveCost.mutate({ costMethod: value })}");
    expect(read("contracts/audit-text.ts")).toContain('"product.cost_averaged": { ru:');
    expect(read("src/pages/AuditLog.tsx")).toContain('"product.cost_averaged":');
  });
  it("миграция: одно поле enum со значением по умолчанию, без хвостового маркера", () => {
    const sql = readFileSync(join(ROOT, "db/migrations/0050_cost_method.sql"), "utf8");
    expect(sql.trim()).toBe("ALTER TABLE `settings` ADD `cost_method` enum('last','average') DEFAULT 'last' NOT NULL;");
  });
});

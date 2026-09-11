/**
 * Кредитный лимит стоит там, где долг возникает.
 *
 * Заказ «в долг» должен деньгами с момента оформления (services/shop-debt.ts),
 * поэтому проверка стоит в OrderService.create до резерва и записи, только
 * для paymentMethod = debt и только при заданном лимите (NULL — без лимита,
 * ничьё поведение не меняется). Поведение — real-db/credit-limit.test.ts.
 *
 * Нарочная поломка: убери условие `shop.creditLimit != null` — вторая проверка
 * падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORDER = readFileSync(resolve(__dirname, "../services/order.ts"), "utf-8");
const create = ORDER.slice(ORDER.indexOf("  async create("), ORDER.indexOf("\n  async ", ORDER.indexOf("  async create(") + 10));

describe("кредитный контроль при оформлении", () => {
  it("проверяется до резерва склада и записи заказа", () => {
    const at = create.indexOf('input.paymentMethod === "debt" && shop.creditLimit != null');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(create.indexOf("resolveOrderWarehouse(tx"));
    expect(at).toBeLessThan(create.indexOf("tx.insert(orders)"));
  });

  it("пустой лимит — без проверки, отказ называет магазин и суммы", () => {
    expect(create).toContain("shop.creditLimit != null");
    expect(create).toMatch(/Кредитный лимит магазина «\$\{shop\.name\}» .*превышен: долг .*заказ /);
  });

  it("лимит редактируется в карточке магазина и принимается роутером", () => {
    expect(readFileSync(resolve(__dirname, "../shop-router.ts"), "utf-8")).toMatch(/creditLimit: z\.preprocess/);
    expect(readFileSync(resolve(__dirname, "../../src/pages/ShopDetail.tsx"), "utf-8")).toContain('key: "creditLimit"');
  });
});

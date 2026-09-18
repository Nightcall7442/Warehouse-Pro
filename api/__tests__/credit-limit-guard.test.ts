/**
 * Кредитный лимит стоит там, где долг возникает.
 *
 * Заказ «в долг» должен деньгами с момента оформления (services/shop-debt.ts),
 * поэтому проверка стоит в OrderService.create до записи заказа, только
 * для paymentMethod = debt и только при заданном лимите (NULL — без лимита,
 * ничьё поведение не меняется). Поведение — real-db/credit-limit.test.ts.
 *
 * Долг читается ПОД ЗАМКОМ строки магазина внутри транзакции, а не снаружи:
 * два одновременных заказа «в долг» иначе оба видели долг до друг друга и
 * оба проходили под лимит. Замок — после строк остатка, в порядке
 * заказ → остаток → магазин, как у отмены и доставки.
 *
 * Нарочная поломка: убери условие `shopLocked.creditLimit != null` — вторая
 * проверка падает; убери `.for("update")` у чтения магазина — первая.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orderMethod } from "./helpers/order-source";

const create = orderMethod("create");

describe("кредитный контроль при оформлении", () => {
  it("долг читается под замком строки магазина, после замка остатка и до записи заказа", () => {
    const lock = create.indexOf('eq(shops.tenantId, tenantId))).for("update")');
    expect(lock).toBeGreaterThan(0);
    const at = create.indexOf('input.paymentMethod === "debt" && shopLocked.creditLimit != null');
    expect(at).toBeGreaterThan(lock);
    expect(lock).toBeGreaterThan(create.indexOf('.for("update")')); // сначала остаток
    expect(at).toBeLessThan(create.indexOf("tx.insert(orders)"));
    expect(at).toBeGreaterThan(create.indexOf("await db.transaction("));
    // Снаружи транзакции долг и лимит не читаются вовсе.
    expect(create.slice(0, create.indexOf("await db.transaction("))).not.toMatch(/debt: shops\.debt|creditLimit: shops\.creditLimit/);
  });

  it("пустой лимит — без проверки, отказ называет магазин и суммы", () => {
    expect(create).toContain("shopLocked.creditLimit != null");
    expect(create).toMatch(/Кредитный лимит магазина «\$\{shop\.name\}» .*превышен: долг .*заказ /);
  });

  it("лимит редактируется в карточке магазина и принимается роутером", () => {
    expect(readFileSync(resolve(__dirname, "../shop-router.ts"), "utf-8")).toMatch(/creditLimit: z\.preprocess/);
    expect(readFileSync(resolve(__dirname, "../../src/pages/ShopDetail.tsx"), "utf-8")).toContain('key: "creditLimit"');
  });
});

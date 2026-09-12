/**
 * Возврат товара поставщику: одно действие вместо «корректировки склада» +
 * «платежа наличными». Арифметика — real-db/supplier-return.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("возврат поставщику", () => {
  const router = readFileSync("api/supplier-router.ts", "utf-8");
  it("товар уходит дверью с просроченных партий первым; долг гасится строкой «return» не больше остатка; ключ идемпотентности", () => {
    expect(router).toContain('reason: "supplier_return", referenceId: paymentId');
    expect(router).toContain('paymentMethod: "return"');
    expect(router).toContain("const applied = Math.max(0, Math.min(credit, remaining));");
    expect(router).toContain('isDuplicateOf(e, "uq_supplier_payment_idem")');
    expect(router).toContain("У поставки в USD не задан курс");
    const door = readFileSync("api/services/stock-ledger.ts", "utf-8");
    expect(door).toContain('entry.reason === "manual_adjustment" || entry.reason === "supplier_return"');
  });
  it("«return» нельзя передать обычным платежом; на экране — кнопка и форма", () => {
    const pay = router.slice(router.indexOf("  pay: operatorQuery"), router.indexOf("  returnGoods:"));
    expect(pay).toContain('paymentMethod:  z.enum(["cash", "card", "transfer"])');
    expect(readFileSync("src/components/counterparties/CounterpartyDetail.tsx", "utf-8")).toContain("data-testid={`cp-return-${r.id}`}");
    expect(readFileSync("src/components/counterparties/SupplierReturnForm.tsx", "utf-8")).toContain('data-testid="supplier-return-submit"');
    expect(readFileSync("src/components/counterparties/constants.ts", "utf-8")).toContain('return: { ru: "Возврат товара"');
    expect(readFileSync("db/migrations/0035_supplier_payment_return.sql", "utf-8")).toContain("enum('cash','card','transfer','return')");
  });
});

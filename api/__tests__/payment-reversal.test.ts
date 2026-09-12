/**
 * Сторно платежа и излишек курьера — чистые правила.
 *
 * Платёж нельзя было ни отменить, ни исправить: ошибка кассира на порядок
 * (5 000 000 вместо 500 000) обнуляла долг, а лишнее не показывалось ни как
 * аванс, ни как ошибка. Курьеру допуск 20 % сверх остатка пропускал деньги,
 * которые растворялись в GREATEST(0, …).
 *
 * Здесь: splitExcess делит принятое на «по заказу» и «излишек»; форма
 * сторно — отрицательная строка того же типа со ссылкой и уникальный индекс
 * на ссылку. Поведение на настоящей базе — real-db/payment-reversal.test.ts.
 *
 * Нарочная поломка: в splitExcess верни `onOrder = amount` — первая группа
 * падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitExcess } from "../services/payment";

describe("излишек сверх остатка", () => {
  it("в пределах остатка — всё на заказ", () => {
    expect(splitExcess(1000, 200, 800)).toEqual({ onOrder: 800, excess: 0 });
  });
  it("сверх остатка — излишек отдельно", () => {
    expect(splitExcess(1000, 200, 900)).toEqual({ onOrder: 800, excess: 100 });
  });
  it("копейки не теряются", () => {
    expect(splitExcess(0.3, 0.1, 0.25)).toEqual({ onOrder: 0.2, excess: 0.05 });
  });
});

describe("форма сторно", () => {
  const PAY = readFileSync(resolve(__dirname, "../services/payment.ts"), "utf-8");
  const body = PAY.slice(PAY.indexOf("  async reverse("), PAY.indexOf("  async getPaymentHistory("));

  it("отрицательная строка того же типа, ссылка, автор исходного платежа", () => {
    expect(body).toContain("amount: (-Number(p.amount)).toFixed(2)");
    expect(body).toContain("type: p.type");
    expect(body).toContain("reversalOf: p.id");
    expect(body).toContain("createdBy: p.createdBy");
  });

  it("повтор и сторно сторно отвергаются; долг пересчитывается; след пишется", () => {
    expect(body).toContain("Платёж уже сторнирован");
    expect(body).toContain("Это уже сторно");
    expect(body).toContain("recalcShopDebt(tx, tenantId, shopId)");
    expect(body).toContain('action: "payment.reverse"');
  });

  it("одно сторно на платёж закреплено индексом", () => {
    expect(readFileSync(resolve(__dirname, "../../db/schema.ts"), "utf-8")).toContain('uniqueIndex("uq_payments_reversal_of").on(t.reversalOf)');
  });

  it("курьер: оба пути делят излишек и пишут его отдельной строкой", () => {
    const COURIER = readFileSync(resolve(__dirname, "../services/courier-delivery.ts"), "utf-8");
    expect((COURIER.match(/splitExcess\(/g) ?? []).length).toBe(2);
    expect((COURIER.match(/recordExcess\(tx/g) ?? []).length).toBe(2);
  });
});

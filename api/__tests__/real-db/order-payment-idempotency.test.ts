/**
 * Повтор оплаты по заказу на настоящей MySQL.
 *
 * Заглушка не знает уникальных индексов: на ней дубль ключа проходит как
 * обычная вставка, и «второй платёж не записан» проверить нечем. Здесь
 * uq_payments_idempotency настоящий, и обе части проверяются по строкам:
 *
 *   1. Два вызова с одним ключом — одна строка платежа, второй ответ помечен
 *      duplicate, долг магазина уменьшен один раз.
 *   2. Остаток с копейками принимается: 0.10 + 0.20 к заказу на 0.30 в double
 *      даёт «больше суммы заказа», в тийинах — ровно в ноль.
 *
 * Запуск: TEST_DATABASE_URL=... npm run test:db (см. harness.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("повтор оплаты по заказу на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  async function deliveredOrder(total: string): Promise<number> {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: "delivered" as never, paymentMethod: "debt" as never,
      subtotal: total, total,
    } as never);
    return Number(row.insertId);
  }

  const actor = () => ({ id: s.agentId, role: "agent" as const });

  async function shopDebt(): Promise<number> {
    const [row] = await db.select({ debt: schema.shops.debt }).from(schema.shops)
      .where(and(eq(schema.shops.id, s.shopId), eq(schema.shops.tenantId, s.tenantId)));
    return Number(row!.debt);
  }

  it("один ключ — одна строка платежа и один вычет из долга", async () => {
    const orderId = await deliveredOrder("1000.00");
    const key = "11111111-2222-3333-4444-555555555555";

    const first = await OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "400", method: "cash", idempotencyKey: key,
    });
    const second = await OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "400", method: "cash", idempotencyKey: key,
    });

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual({ success: true, duplicate: true });
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(1);
    // Долг: 1000 − 400, а не 1000 − 800.
    expect(await shopDebt()).toBe(600);
  });

  it("разные ключи — два платежа, как и раньше", async () => {
    const orderId = await deliveredOrder("1000.00");
    await OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "400", method: "cash", idempotencyKey: "aaaaaaaa-0000-0000-0000-000000000001",
    });
    await OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "600", method: "cash", idempotencyKey: "aaaaaaaa-0000-0000-0000-000000000002",
    });
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(2);
    expect(await shopDebt()).toBe(0);
  });

  it("точный остаток с копейками принимается", async () => {
    // 0.1 + 0.2 > 0.3 в double — именно так отвергались законные финалы.
    const orderId = await deliveredOrder("0.30");
    await OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "0.10", method: "cash", idempotencyKey: "bbbbbbbb-0000-0000-0000-000000000001",
    });
    await expect(OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "0.20", method: "cash", idempotencyKey: "bbbbbbbb-0000-0000-0000-000000000002",
    })).resolves.toMatchObject({ success: true });
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(2);
    // А сверх суммы — по-прежнему отказ.
    await expect(OrderService.recordPartialPayment(db, s.tenantId, actor(), {
      orderId, paidAmount: "0.01", method: "cash", idempotencyKey: "bbbbbbbb-0000-0000-0000-000000000003",
    })).rejects.toThrow(/превышать сумму заказа/);
  });
});

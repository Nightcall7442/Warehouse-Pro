/**
 * Сторно на настоящей базе: долг и касса сходятся, повтор невозможен.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { PaymentService } from "../../services/payment";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("сторно платежа", () => {
  let db: ServiceDb;
  let s: Seeded;
  const actor = () => ({ id: s.agentId, name: "Оператор", role: "operator" });

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed();
    await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№R-1",
      status: "delivered" as never, paymentMethod: "debt" as never, subtotal: "1000.00", total: "1000.00",
    } as never);
  });

  async function debt(): Promise<number> {
    const [row] = await db.select({ debt: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId));
    return Number(row!.debt);
  }
  async function cashOf(userId: number): Promise<number> {
    const [row] = await db.select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(15,2))), 0)` })
      .from(schema.payments).where(and(eq(schema.payments.createdBy, userId), eq(schema.payments.type, "payment")));
    return Number(row!.total);
  }

  it("сторно возвращает долг и обнуляет кассу автора; повтор отвергается", async () => {
    await PaymentService.addPayment(db, s.tenantId, { shopId: s.shopId, amount: "400", type: "payment", createdBy: s.courierId, idempotencyKey: "r-1" });
    expect(await debt()).toBe(600);
    const [p] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.shopId, s.shopId));

    const r = await PaymentService.reverse(db, s.tenantId, { paymentId: p!.id, reason: "ошибка ввода", actor: actor() });
    expect(r.success).toBe(true);
    expect(await debt()).toBe(1000);
    expect(await cashOf(s.courierId)).toBe(0);
    expect(await countOf("payments", `reversal_of = ${p!.id}`)).toBe(1);

    await expect(PaymentService.reverse(db, s.tenantId, { paymentId: p!.id, reason: "ещё раз", actor: actor() })).rejects.toThrow(/уже сторнирован/);
    await expect(PaymentService.reverse(db, s.tenantId, { paymentId: r.reversalId, reason: "сторно сторно", actor: actor() })).rejects.toThrow(/уже сторно/);
    expect(await countOf("audit_log", `action = 'payment.reverse'`)).toBe(1);
  });
});

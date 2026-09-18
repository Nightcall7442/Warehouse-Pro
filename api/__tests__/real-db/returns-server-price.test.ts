/**
 * Возврат без заказа на настоящей базе: цену называет сервер.
 *
 * Магазину продали по 100 (заказ доставлен, долг 500), потом карточку
 * подняли до 120. Агент оформляет возврат без заказа и пишет 5. Строка
 * получает цену последней продажи — 100, а не 5 и не 120; названные агентом
 * 5 лежат рядом (requestedPrice) и в сумму не входят. Товар без продаж
 * этому магазину — по карточке. После проведения долг уменьшается на 100,
 * а не на 5.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

function ctxFor(db: ServiceDb, tenantId: number, userId: number, role: "agent" | "operator"): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role, status: "active" as const, name: "Т", email: "t@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describeIf("возврат без заказа — цена сервера", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("100.000");
    // Продажа по 100 в долг, доставлена: долг магазина 500.
    const { id } = await OrderService.create(db, s.tenantId, s.agentId, { shopId: s.shopId, items: [{ productId: s.productId, quantity: "5" }], paymentMethod: "debt", idempotencyKey: "rs-1" });
    await OrderService.updateStatus(db, s.tenantId, id, "delivered", { id: s.agentId, role: "ceo" });
    await db.update(schema.products).set({ unitPrice: "120.00" }).where(eq(schema.products.id, s.productId));
  });

  const debt = async () => Number((await db.select({ d: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId)))[0]!.d);

  it("строка — по последней продаже, цена агента рядом; проведение уменьшает долг по цене сервера", async () => {
    expect(await debt()).toBe(500);
    const { returnsRouter } = await import("../../returns-router");
    const agent = returnsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
    const { id } = await agent.create({ shopId: s.shopId, reason: "defect", items: [
      { productId: s.productId, quantity: 1, unitPrice: 5 },
      { productId: s.secondProductId, quantity: 1, unitPrice: 250 },   // не продавался — карточка 250, совпало
    ] });
    const doc = (await agent.getById({ id }))!;
    expect(doc.items.map(i => [Number(i.productId), i.unitPrice, i.subtotal, i.requestedPrice])).toEqual([
      [s.productId, "100.00", "100.00", "5.00"],
      [s.secondProductId, "250.00", "250.00", null],
    ]);
    expect(doc.totalAmount).toBe("350.00");

    const operator = returnsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
    await operator.updateStatus({ id, status: "approved" });
    await operator.updateStatus({ id, status: "completed" });
    // 500 − 350 по цене сервера, а не 500 − 255 по цене агента.
    expect(await debt()).toBe(150);
  });
});

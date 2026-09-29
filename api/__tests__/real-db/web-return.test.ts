/**
 * Возврат от магазина из веба — на настоящей базе, через настоящую ручку.
 *
 * Что было: из веба возврат после доставки не оформлялся — кнопки не было, и
 * офис обходил это корректировкой остатка и сторно платежа, ломая долг
 * магазина и выручку. Сервер при этом возврат заводить умел (returns.create).
 *
 * Что проверяется:
 *   · оператор заводит возврат по доставленному заказу — он встаёт в ту же
 *     очередь «на рассмотрении», с тем, кто завёл; долг и выручка не
 *     двигаются, пока возврат не проведён;
 *   · остаток к возврату (returns.returnable) — доставленное минус всё, кроме
 *     отклонённого; сверх него сервер отказывает — и вторым документом, и
 *     двумя строками одного товара в одном запросе; отклонённый не в счёт;
 *   · после проведения долг магазина и выручка меняются ровно по своим
 *     правилам: долг — по заказу (services/shop-debt.ts), выручка — за период
 *     (services/revenue-returns.ts), оба на сумму по ценам заказа;
 *   · заказ другого магазина или чужой организации — отказ;
 *   · курьер возврат не заводит.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { returnsInPeriod, totalReturned } from "../../services/revenue-returns";
import {
  ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

// Роутер ходит в getDb(), а не в ctx.db — подменяем на тестовую базу.
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describeIf("возврат из веба — очередь, остаток, деньги", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;
  let orderId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("100.000");
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Дилноза", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
    // В долг: 5 × 100 + 2 × 250 = 1 000, доставлен.
    ({ id: orderId } = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "debt", idempotencyKey: "wr-1",
      items: [{ productId: s.productId, quantity: "5" }, { productId: s.secondProductId, quantity: "2" }],
    }));
    await OrderService.updateStatus(db, s.tenantId, orderId, "delivered", { id: s.agentId, role: "ceo" });
  });

  const router = async () => (await import("../../returns-router")).returnsRouter;
  const as = async (role: string, tenantId = s.tenantId, userId = operatorId) => (await router()).createCaller(ctxFor(db, tenantId, userId, role));
  const debt = async () => Number((await db.select({ d: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId)))[0]!.d);
  const revenueReturned = async () => totalReturned(await returnsInPeriod(db, s.tenantId, "2000-01-01", "2999-12-31")).amount;
  const left = async () => Object.fromEntries((await (await as("operator")).returnable({ orderId })).map(l => [l.productId, l.left]));

  it("оператор заводит — возврат в очереди «на рассмотрении», с тем, кто завёл; деньги не двигаются", async () => {
    expect(await debt()).toBe(1000);
    const op = await as("operator");
    const { id, returnNumber } = await op.create({ orderId, shopId: s.shopId, reason: "expired", notes: "вздутые", items: [{ productId: s.productId, quantity: 2, unitPrice: 1 }] });

    const queue = await op.list({ status: "pending" });
    expect(queue.data.map(r => [r.id, r.returnNumber, r.orderId, r.createdByName, r.createdByRole, r.totalAmount])).toEqual([
      [id, returnNumber, orderId, "Дилноза", "operator", "200.00"],   // цена заказа, а не присланная 1
    ]);
    expect(await debt()).toBe(1000);
    expect(await revenueReturned()).toBe(0);
    expect(await left()).toEqual({ [s.productId]: 3, [s.secondProductId]: 2 });
  });

  it("сверх доставленного — отказ: вторым документом и двумя строками в одном; отклонённый не в счёт", async () => {
    const op = await as("operator");
    const first = await op.create({ orderId, shopId: s.shopId, reason: "defect", items: [{ productId: s.productId, quantity: 4, unitPrice: 100 }] });
    await expect(op.create({ orderId, shopId: s.shopId, reason: "defect", items: [{ productId: s.productId, quantity: 2, unitPrice: 100 }] }))
      .rejects.toThrow(/возвращают больше, чем доставили — уже возвращено 4 из 5/);
    await expect(op.create({ orderId, shopId: s.shopId, reason: "defect", items: [
      { productId: s.secondProductId, quantity: 1, unitPrice: 250 }, { productId: s.secondProductId, quantity: 2, unitPrice: 250 },
    ] })).rejects.toThrow(/возвращают больше, чем доставили/);
    expect(await left()).toEqual({ [s.productId]: 1, [s.secondProductId]: 2 });

    await op.updateStatus({ id: first.id, status: "rejected" });
    expect(await left()).toEqual({ [s.productId]: 5, [s.secondProductId]: 2 });
    await expect(op.create({ orderId, shopId: s.shopId, reason: "defect", items: [{ productId: s.productId, quantity: 5, unitPrice: 100 }] })).resolves.toBeTruthy();
  });

  it("после проведения: долг по заказу и выручка за период — ровно на сумму возврата по ценам заказа", async () => {
    const op = await as("operator");
    const { id } = await op.create({ orderId, shopId: s.shopId, reason: "wrong_item", items: [
      { productId: s.productId, quantity: 2, unitPrice: 1 }, { productId: s.secondProductId, quantity: 1, unitPrice: 1 },
    ] });
    // Проводит тот же круг и тем же путём, что возвраты с телефона.
    await op.updateStatus({ id, status: "approved" });
    expect(await debt()).toBe(1000);
    await op.updateStatus({ id, status: "completed" });
    // 2 × 100 + 1 × 250 = 450.
    expect(await debt()).toBe(550);
    expect(await revenueReturned()).toBe(450);
    expect(await left()).toEqual({ [s.productId]: 3, [s.secondProductId]: 1 });
  });

  it("заказ другого магазина — отказ: долг снимался бы не с того, кто получил товар", async () => {
    const [other] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин Бета" });
    const op = await as("operator");
    await expect(op.create({ orderId, shopId: Number(other.insertId), reason: "defect", items: [{ productId: s.productId, quantity: 1, unitPrice: 100 }] }))
      .rejects.toThrow(/другого магазина/);
    expect(await db.select().from(schema.returns)).toHaveLength(0);
  });

  it("чужая организация — ни остатка, ни возврата, ни строки в её очереди", async () => {
    const [foreignShop] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой" });
    const [foreignOp] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой оператор", email: "x@other.local", passwordHash: "x", role: "operator" });
    const stranger = await as("operator", s.otherTenantId, Number(foreignOp.insertId));
    await expect(stranger.returnable({ orderId })).rejects.toThrow(/не найден/);
    await expect(stranger.create({ orderId, shopId: Number(foreignShop.insertId), reason: "defect", items: [{ productId: s.productId, quantity: 1, unitPrice: 100 }] }))
      .rejects.toThrow(/не найден/);

    await (await as("operator")).create({ orderId, shopId: s.shopId, reason: "defect", items: [{ productId: s.productId, quantity: 1, unitPrice: 100 }] });
    expect((await stranger.list()).data).toHaveLength(0);
  });

  it("курьер возврат не заводит", async () => {
    await expect((await as("courier", s.tenantId, s.courierId)).create({ orderId, shopId: s.shopId, reason: "defect", items: [{ productId: s.productId, quantity: 1, unitPrice: 100 }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/**
 * Пункты средней важности бизнес-аудита 19.11.2026 — на настоящей MySQL.
 *
 *   · заказ на магазин в архиве не оформляется;
 *   · возврат от магазина ложится на склад заказа, а не на склад по умолчанию;
 *   · «выручка сегодня» агента — без отменённых;
 *   · выполнение плана продаж — за вычетом проведённых возвратов.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { actualsForTargets } from "../../services/sales-target-actuals";
import { businessToday } from "@contracts/business-time";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("средние пункты аудита", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("100.000");
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" } as never);
    operatorId = Number(op.insertId);
  });

  const order = (key: string, qty = "5") => OrderService.create(db, s.tenantId, s.agentId, {
    shopId: s.shopId, paymentMethod: "debt", idempotencyKey: key, items: [{ productId: s.productId, quantity: qty }],
  });

  it("магазин в архиве — заказ не оформляется", async () => {
    await db.update(schema.shops).set({ status: "inactive" } as never).where(eq(schema.shops.id, s.shopId));
    await expect(order("arch-1")).rejects.toThrow(/в архиве/);
  });

  it("возврат ложится на склад, с которого уехал заказ, даже если склад по умолчанию сменили", async () => {
    // Заказ уехал со склада A (по умолчанию на тот момент).
    const { id: orderId } = await order("wh-1", "5");
    await OrderService.updateStatus(db, s.tenantId, orderId, "delivered", { id: operatorId, role: "operator" });
    // Потом по умолчанию стал склад B.
    const [w2] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Склад B", isDefault: false } as never);
    const whB = Number(w2.insertId);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: whB, currentStock: "50.000", reserved: "0.000", available: "50.000" } as never);
    await db.update(schema.warehouses).set({ isDefault: false } as never).where(eq(schema.warehouses.id, s.warehouseId));
    await db.update(schema.warehouses).set({ isDefault: true } as never).where(eq(schema.warehouses.id, whB));
    const stockAt = async (wh: number) => Number((await db.select({ c: schema.warehouseStock.currentStock }).from(schema.warehouseStock)
      .where(and(eq(schema.warehouseStock.productId, s.productId), eq(schema.warehouseStock.warehouseId, wh))))[0].c);
    const a = await stockAt(s.warehouseId);

    const op = (await import("../../returns-router")).returnsRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const { id } = await op.create({ orderId, shopId: s.shopId, reason: "wrong_item", items: [{ productId: s.productId, quantity: 2, unitPrice: 1 }] });
    await op.updateStatus({ id, status: "approved" });
    await op.updateStatus({ id, status: "completed", disposition: "restock" });

    expect(await stockAt(s.warehouseId), "возврат не на складе заказа").toBe(a + 2);
    expect(await stockAt(whB), "возврат ушёл на новый склад по умолчанию").toBe(50);
  });

  it("выручка агента «сегодня» не включает отменённый заказ", async () => {
    await order("today-1", "3");
    const { id: cancelled } = await order("today-2", "4");
    await OrderService.updateStatus(db, s.tenantId, cancelled, "cancelled", { id: operatorId, role: "operator" });
    const dash = (await import("../../dashboard-router")).dashboardRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
    const r = await dash.agentDashboard();
    expect(r.todayRevenue).toBe(300);
  });

  it("план продаж: выполнено — за вычетом проведённого возврата", async () => {
    const { id: orderId } = await order("plan-1", "10");
    await OrderService.updateStatus(db, s.tenantId, orderId, "delivered", { id: operatorId, role: "operator" });
    const today = businessToday();
    const [t] = await db.insert(schema.salesTargets).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: today as never, periodEnd: today as never, targetAmount: "5000.00",
    } as never);
    const op = (await import("../../returns-router")).returnsRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const { id } = await op.create({ orderId, shopId: s.shopId, reason: "wrong_item", items: [{ productId: s.productId, quantity: 3, unitPrice: 1 }] });
    await op.updateStatus({ id, status: "approved" });
    await op.updateStatus({ id, status: "completed", disposition: "restock" });

    const actual = (await actualsForTargets(db, s.tenantId, [Number(t.insertId)])).get(Number(t.insertId));
    expect(actual?.revenue).toBe(700);
  });
});

/**
 * Комиссии и деньги курьера — бизнес-аудит 19.11.2026, пункты 17, 19, 20.
 *
 *   · статус комиссии — только вперёд, выплаченное не меняется, каждый
 *     переход — в журнале действий; свою ставку оператор не меняет;
 *   · курьер не принимает оплату по заказу, возвращённому целиком;
 *   · недостача в зарплате — по дате недостачи, а не закрытия расчёта
 *     (повторное закрытие в следующем месяце не удерживает её второй раз).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderCloseService } from "../../services/order-close";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("комиссии и деньги курьера", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;
  let ceoId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("100.000");
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" } as never);
    operatorId = Number(op.insertId);
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" } as never);
    ceoId = Number(ceo.insertId);
  });

  const commissionApi = async (userId: number, role: string) =>
    (await import("../../commission-router")).commissionRouter.createCaller(ctxFor(db, s.tenantId, userId, role));

  async function commissionRow(status: "pending" | "approved" | "paid") {
    const [r] = await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`${"2026-10-01"}`, periodEnd: sql`${"2026-10-31"}`,
      salesAmount: "1000000.00", commissionAmount: "50000.00", status,
    } as never);
    return Number(r.insertId);
  }

  it("статус: черновик → утверждено → выплачено; назад из «выплачено» нельзя; всё в журнале", async () => {
    const c = await commissionApi(operatorId, "operator");
    const id = await commissionRow("pending");
    await expect(c.updateStatus({ id, status: "paid" })).rejects.toThrow(/только утверждённую/);
    await c.updateStatus({ id, status: "approved" });
    await c.updateStatus({ id, status: "paid" });
    await expect(c.updateStatus({ id, status: "pending" })).rejects.toThrow(/Выплаченная комиссия не меняется/);
    const [row] = await db.select({ status: schema.commissions.status }).from(schema.commissions).where(eq(schema.commissions.id, id));
    expect(row.status).toBe("paid");
    const log = await db.select({ action: schema.auditLog.action, meta: schema.auditLog.meta }).from(schema.auditLog)
      .where(eq(schema.auditLog.action, "commission.status"));
    expect(log.map(l => (l.meta as { to: string }).to)).toEqual(["approved", "paid"]);
  });

  it("свою ставку оператор не меняет; директор — меняет", async () => {
    const asOperator = await commissionApi(operatorId, "operator");
    await expect(asOperator.setRate({ userId: operatorId, commissionRate: 100 })).rejects.toThrow(/Свою ставку меняет руководитель/);
    await asOperator.setRate({ userId: s.agentId, commissionRate: 5 });
    const asCeo = await commissionApi(ceoId, "ceo");
    await asCeo.setRate({ userId: ceoId, commissionRate: 3 });
    const log = await db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.action, "commission.rate_set"));
    expect(log).toHaveLength(2);
  });

  it("возврат целиком у курьера — оплату не принимает", async () => {
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: s.courierId, warehouseId: s.warehouseId,
      orderNumber: "№R-1", status: "shipped" as never, deliveryStatus: "out_for_delivery" as never, paymentMethod: "cash" as never,
      subtotal: "300.00", total: "300.00",
    } as never);
    const courier = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
    await expect(courier.completeDelivery({ orderId: Number(o.insertId), result: "returned", paymentMethod: "cash", paidAmount: "300" }))
      .rejects.toThrow(/возвращён целиком/);
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });

  it("недостача — в месяце, когда её записали, а не когда расчёт закрыли повторно", async () => {
    await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: s.courierId,
      orderNumber: "№S-1", status: "delivered" as never, paymentMethod: "cash" as never, subtotal: "1000.00", total: "1000.00",
      courierShortage: "200.00", shortageUserId: s.courierId,
      shortageAt: new Date("2026-09-20T07:00:00Z"), closedAt: new Date("2026-10-05T07:00:00Z"),
    } as never);
    const sep = await OrderCloseService.shortageIn(db, s.tenantId, s.courierId, new Date("2026-08-31T19:00:00Z"), new Date("2026-09-30T19:00:00Z"));
    const oct = await OrderCloseService.shortageIn(db, s.tenantId, s.courierId, new Date("2026-09-30T19:00:00Z"), new Date("2026-10-31T19:00:00Z"));
    expect(sep).toEqual({ count: 1, amount: 200 });
    expect(oct).toEqual({ count: 0, amount: 0 });
  });
});

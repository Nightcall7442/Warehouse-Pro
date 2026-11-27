/**
 * Долг магазина гасит только оператор, когда курьер сдал деньги — на
 * настоящей MySQL (решение владельца 27.11.2026, бизнес-аудит 19.11.2026, п. 18).
 *
 *   · наличные, записанные курьером, долг не гасят, пока офис не закрыл расчёт;
 *   · излишек сверх остатка сдаётся вместе с заказом и только тогда гасит
 *     долг по другим заказам; курьер не висит с ним «на руках» навсегда;
 *   · излишек по уже рассчитанному заказу оператор принимает отдельно;
 *   · сторно принятых наличных возвращает долг.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { markDelivered } from "../../services/courier-delivery";
import { OrderCloseService } from "../../services/order-close";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("наличные на руках и долг магазина", () => {
  let db: ServiceDb;
  let s: Seeded;
  let opId = 0;
  const op = () => ({ id: opId, name: "Оператор", role: "operator" });

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("100.000");
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" } as never);
    opId = Number(u.insertId);
  });

  const debt = async () => Number((await db.select({ d: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId)))[0].d);

  /** Заказ «в долг» по 100 за штуку, назначенный курьеру и в пути. */
  const onTheWay = async (key: string, qty: string) => {
    const { id } = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "debt", idempotencyKey: key, items: [{ productId: s.productId, quantity: qty }],
    });
    const router = (await import("../../courier-router")).courierRouter;
    await router.createCaller(ctxFor(db, s.tenantId, opId, "operator")).assignCourier({ orderId: id, courierId: s.courierId });
    await router.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier")).markOutForDelivery({ orderId: id });
    return id;
  };

  it("наличные курьера гасят долг только после «Закрыть расчёт»", async () => {
    const id = await onTheWay("c-1", "10"); // 1000
    expect(await debt()).toBe(1000);
    await markDelivered(db as never, s.tenantId, s.courierId, { orderId: id, cashAmount: "1000" });
    expect(await debt(), "деньги у курьера — долг магазина ещё не погашен").toBe(1000);
    await OrderCloseService.close(db as never, s.tenantId, op(), { orderId: id, cashReceived: 1000 });
    expect(await debt()).toBe(0);
  });

  it("излишек: на руках не гасит ничего, сданный с заказом — гасит долг по другому заказу", async () => {
    const other = await onTheWay("x-0", "3"); // ещё 300 долга
    const id = await onTheWay("x-1", "10");   // 1000
    expect(await debt()).toBe(1300);
    await markDelivered(db as never, s.tenantId, s.courierId, { orderId: id, cashAmount: "1050" });
    expect(await debt(), "излишек у курьера уже погасил долг").toBe(1300);
    const before = await OrderCloseService.money(db as never, s.tenantId, id);
    expect(before.claimed, "в «заявлено» — и излишек").toBe(1050);
    expect(before.excessPending).toBe(50);

    const r = await OrderCloseService.close(db as never, s.tenantId, op(), { orderId: id, cashReceived: 1050 });
    expect(r.shortage).toBe(0);
    expect(await debt(), "1000 закрыли заказ, 50 — долг по другому").toBe(250);
    expect(await OrderCloseService.mine(db as never, s.tenantId, s.courierId), "курьер чист").toMatchObject({ amount: 0 });
    expect(other).toBeGreaterThan(0);
  });

  it("излишек, не сданный с заказом, — недостача курьера", async () => {
    const id = await onTheWay("y-1", "10");
    await markDelivered(db as never, s.tenantId, s.courierId, { orderId: id, cashAmount: "1050" });
    const r = await OrderCloseService.close(db as never, s.tenantId, op(), { orderId: id, cashReceived: 1000 });
    expect(r.shortage).toBe(50);
  });

  it("излишек по рассчитанному заказу оператор принимает отдельно", async () => {
    const id = await onTheWay("z-1", "10");
    await markDelivered(db as never, s.tenantId, s.courierId, { orderId: id, cashAmount: "1000" });
    await OrderCloseService.close(db as never, s.tenantId, op(), { orderId: id, cashReceived: 1000 });
    // Излишек, записанный до того, как его стали сдавать с заказом.
    await db.insert(schema.payments).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId: null, excessOfOrderId: id, amount: "40.00", type: "payment",
      paymentMethod: "cash", createdBy: s.courierId, notes: "Излишек сверх остатка по заказу",
    } as never);
    const m = await OrderCloseService.money(db as never, s.tenantId, id);
    expect(m.excessPending).toBe(40);
    const r = await OrderCloseService.acceptExcess(db as never, s.tenantId, op(), id);
    expect(r.amount).toBe(40);
    expect((await OrderCloseService.money(db as never, s.tenantId, id)).excessPending).toBe(0);
    await expect(OrderCloseService.acceptExcess(db as never, s.tenantId, op(), id)).rejects.toThrow(/нет/);
  });

  it("сторно принятых наличных возвращает долг", async () => {
    const id = await onTheWay("r-1", "10");
    await markDelivered(db as never, s.tenantId, s.courierId, { orderId: id, cashAmount: "1000" });
    await OrderCloseService.close(db as never, s.tenantId, op(), { orderId: id, cashReceived: 1000 });
    expect(await debt()).toBe(0);
    const [p] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.orderId, id));
    const { PaymentService } = await import("../../services/payment");
    await PaymentService.reverse(db as never, s.tenantId, { paymentId: p.id, reason: "ошибка", actor: op() });
    expect(await debt()).toBe(1000);
  });
});

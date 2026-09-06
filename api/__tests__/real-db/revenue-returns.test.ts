/**
 * Какие возвраты уменьшают выручку — на настоящей MySQL.
 *
 * ── Почему не на заглушке ───────────────────────────────────────────────────
 *
 * Сложение строк проверено отдельно (api/__tests__/revenue-returns.test.ts) —
 * там чистые функции. А здесь проверяется ОТБОР, и он весь в запросе: три
 * соединения, условие периода и тот же набор условий, что у самой выручки.
 * Заглушка соединений не исполняет и подтвердила бы собственную подделку.
 *
 * Отбор решает, не будет ли вычет двойным. Товар возвращается двумя путями:
 * заказ целиком помечают «возвращён» — тогда он выпадает из выручки по
 * статусу; либо проводят документ возврата по доставленному заказу — тогда
 * заказ остаётся в выручке полной суммой, и вычесть надо документ. Спутать их
 * значит вычесть одно и то же дважды.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { returnsInPeriod, totalReturned } from "../../services/revenue-returns";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

/** Окно, заведомо накрывающее сегодняшний день. */
const FROM = "2000-01-01";
const TO = "2999-12-31";

describeIf("отбор возвратов, уменьшающих выручку", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  async function order(status: string, total: string, opts: { deleted?: boolean } = {}) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: status as never, paymentMethod: "cash",
      subtotal: total, total,
      deletedAt: opts.deleted ? new Date() : null,
    } as never);
    const orderId = Number(row.insertId);
    // Строка заказа несёт себестоимость — именно её и надо вернуть из COGS.
    await db.insert(schema.orderItems).values({
      orderId, productId: s.productId, quantity: "10.00",
      unitPrice: "30.00", costPrice: "18.00", subtotal: total,
    } as never);
    return orderId;
  }

  async function completedReturn(orderId: number | null, amount: string, qty = "10.00") {
    const [row] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId,
      returnNumber: `В-${Math.random().toString(36).slice(2, 8)}`,
      status: "completed", totalAmount: amount,
    } as never);
    const returnId = Number(row.insertId);
    await db.insert(schema.returnItems).values({
      returnId, productId: s.productId, quantity: qty,
      unitPrice: "30.00", subtotal: amount,
    } as never);
    return returnId;
  }

  it("возврат по доставленному заказу вычитается вместе со своей себестоимостью", async () => {
    const delivered = await order("delivered", "300.00");
    await completedReturn(delivered, "300.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));

    expect(out.amount).toBe(300);
    // 10 единиц по 18 — себестоимость берётся из СТРОКИ ЗАКАЗА, той самой,
    // что попала в COGS при продаже.
    expect(out.cost).toBe(180);
  });

  it("возврат по отменённому заказу не вычитается: заказ и так вне выручки", async () => {
    /*
      Главная проверка на двойной вычет. Провести возврат по отменённому
      заказу нельзя, но пометить заказ отменённым ПОСЛЕ проведения возврата
      можно. Тогда сумма заказа уходит из выручки целиком, и вычитать
      документ поверх значит снять те же деньги дважды.
    */
    const cancelled = await order("cancelled", "300.00");
    await completedReturn(cancelled, "300.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("возврат по удалённому заказу не вычитается", async () => {
    const removed = await order("delivered", "300.00", { deleted: true });
    await completedReturn(removed, "300.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("непроведённый возврат не вычитается", async () => {
    const delivered = await order("delivered", "300.00");
    const [row] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId: delivered,
      returnNumber: "В-заявка", status: "pending", totalAmount: "300.00",
    } as never);
    expect(Number(row.insertId)).toBeGreaterThan(0);

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("возврат без заказа выручку не уменьшает", async () => {
    // Ему не из чего вычитаться: такой возврат живёт только в долге магазина.
    await completedReturn(null, "200.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("возврат за пределами периода не вычитается", async () => {
    const delivered = await order("delivered", "300.00");
    await completedReturn(delivered, "300.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, "2000-01-01", "2000-12-31"));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("чужая организация не подмешивается", async () => {
    const [otherShop] = await db.insert(schema.shops)
      .values({ tenantId: s.otherTenantId, name: "Чужой магазин" } as never);
    const [otherOrder] = await db.insert(schema.orders).values({
      tenantId: s.otherTenantId, shopId: Number(otherShop.insertId), agentId: s.agentId,
      orderNumber: "№чужой", status: "delivered", paymentMethod: "cash",
      subtotal: "900.00", total: "900.00",
    } as never);
    await db.insert(schema.returns).values({
      tenantId: s.otherTenantId, shopId: Number(otherShop.insertId),
      orderId: Number(otherOrder.insertId), returnNumber: "В-чужой",
      status: "completed", totalAmount: "900.00",
    } as never);

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out).toEqual({ amount: 0, cost: 0 });
  });

  it("возврат части заказа вычитает только эту часть", async () => {
    const delivered = await order("delivered", "300.00");
    await completedReturn(delivered, "120.00", "4.00");

    const out = totalReturned(await returnsInPeriod(db, s.tenantId, FROM, TO));
    expect(out.amount).toBe(120);
    expect(out.cost).toBe(72);          // 4 единицы по 18
  });

  it("месяц берётся у возврата, а не у заказа", async () => {
    // Иначе закрытый месяц менялся бы задним числом при каждом возврате.
    const delivered = await order("delivered", "300.00");
    await completedReturn(delivered, "300.00");

    const [ret] = await db.select({ id: schema.returns.id }).from(schema.returns).limit(1);
    await db.update(schema.returns)
      .set({ createdAt: new Date("2026-03-15T10:00:00Z") })
      .where(eq(schema.returns.id, ret.id));

    const rows = await returnsInPeriod(db, s.tenantId, FROM, TO);
    expect(rows[0].month).toBe("2026-03");
  });
});

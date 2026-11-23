/**
 * Бизнес-аудит 19.11.2026, пункты 3, 6, 7, 8 — на настоящей MySQL.
 *
 *   · срок оплаты полевого — не дальше отсрочки и не позже уже назначенного
 *     (иначе «1 сум со сроком 2099» снимал удержание отгрузки);
 *   · возврат по заказу со скидкой — по цене, которую заплатил магазин;
 *   · заказ «ожидает» полевой сам не проводит;
 *   · акт инвентаризации двигает остаток на найденную при счёте разницу и не
 *     стирает продажи и приходы, прошедшие после счёта.
 * Переплата между заказами (п. 5) — в agent-debt-matches-shop-debt.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { returnableLines } from "../../services/returnable";
import { recordStockMovement, setStock } from "../../services/stock-ledger";
import { businessToday } from "@contracts/business-time";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";

/** День по Ташкенту через n суток от сегодня: «ГГГГ-ММ-ДД». */
function dayPlus(n: number): string {
  const [y, m, d] = businessToday().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe.skipIf(!hasRealDb)("долги, возвраты, инвентаризация", () => {
  let db: ServiceDb;
  let s: Seeded;
  const agent = () => ({ id: s.agentId, role: "agent" });

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("100.000"); });

  async function order(opts: { status?: string; qty?: number; discount?: string; paymentMethod?: string } = {}) {
    const qty = opts.qty ?? 10;
    const subtotal = qty * 100;
    const discount = Number(opts.discount ?? 0);
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, warehouseId: s.warehouseId,
      orderNumber: `№A-${Math.random().toString(36).slice(2, 8)}`,
      status: (opts.status ?? "delivered") as never, paymentMethod: (opts.paymentMethod ?? "debt") as never,
      subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: (subtotal - discount).toFixed(2),
    } as never);
    const orderId = Number(o.insertId);
    const [it] = await db.insert(schema.orderItems).values({
      orderId, productId: s.productId, quantity: String(qty), unitPrice: "100.00", costPrice: "50.00", subtotal: subtotal.toFixed(2),
    } as never);
    return { orderId, itemId: Number(it.insertId) };
  }

  describe("срок оплаты полевого", () => {
    const pay = (orderId: number, debtDueDate: string, key: string) =>
      OrderService.recordPartialPayment(db, s.tenantId, agent(), { orderId, paidAmount: "1", method: "cash", debtDueDate, idempotencyKey: key });

    it("2099 год — отказ; в пределах отсрочки (14 дней) — проходит", async () => {
      const { orderId } = await order();
      await expect(pay(orderId, "2099-12-31", "due-key-1")).rejects.toThrow(/не позже .*отсрочка магазина 14 дн/);
      await expect(pay(orderId, dayPlus(-1), "due-key-2")).rejects.toThrow(/не может быть в прошлом/);
      await expect(pay(orderId, dayPlus(7), "due-key-3")).resolves.toBeTruthy();
    });

    it("назначенный срок полевой не отодвигает, офис — может", async () => {
      const { orderId } = await order();
      await pay(orderId, dayPlus(5), "due-key-4");
      await expect(pay(orderId, dayPlus(10), "due-key-5")).rejects.toThrow(/уже назначен/);
      await expect(pay(orderId, dayPlus(3), "due-key-6")).resolves.toBeTruthy();
      await expect(OrderService.recordPartialPayment(db, s.tenantId, { id: s.agentId, role: "operator" },
        { orderId, paidAmount: "1", method: "cash", debtDueDate: "2027-06-01", idempotencyKey: "due-key-7" })).resolves.toBeTruthy();
    });

    it("своя отсрочка магазина главнее организации", async () => {
      await db.update(schema.shops).set({ paymentGraceDays: 30 } as never).where(eq(schema.shops.id, s.shopId));
      const { orderId } = await order();
      await expect(pay(orderId, dayPlus(25), "due-key-8")).resolves.toBeTruthy();
    });
  });

  it("возврат по заказу со скидкой 20% — по цене со скидкой", async () => {
    // 10 × 100 = 1000, скидка 200: магазин платил 80 за штуку.
    const { orderId } = await order({ discount: "200" });
    const lines = await returnableLines(db, s.tenantId, orderId);
    expect(lines.get(s.productId)?.unitPrice).toBe(80);
  });

  it("заказ «ожидает» полевой не проводит доставкой, офис — проводит", async () => {
    const { orderId, itemId } = await order({ status: "pending", paymentMethod: "cash" });
    await db.update(schema.warehouseStock).set({ reserved: "10.000", available: "90.000" } as never)
      .where(eq(schema.warehouseStock.productId, s.productId));
    await expect(OrderService.recordPartialDelivery(db, s.tenantId, agent(), { orderId, items: [{ itemId, deliveredQuantity: 10 }] }))
      .rejects.toThrow(/ждёт решения офиса/);
    const [o] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(o.status).toBe("pending");
  });

  describe("акт инвентаризации", () => {
    const api = async (role = "operator") =>
      (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, role));

    /** Движение остатка «мимо акта»: продажа или приход между счётом и применением. */
    async function move(delta: number) {
      await db.transaction(async (tx) => {
        const now = await stockOf(s.productId);
        await setStock(tx, { tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: now.current + delta });
        await recordStockMovement(tx, {
          tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId,
          type: delta > 0 ? "in" : "out", quantity: Math.abs(delta), reason: "manual_adjustment", notes: "тест",
        });
      });
    }

    it("продажа после счёта не возвращается актом", async () => {
      const c = await api();
      const { id } = await c.create({ warehouseId: s.warehouseId });
      // По учёту 100, на полке насчитали 97 — недостача 3.
      await c.setCounted({ id, productId: s.productId, counted: 97 });
      await move(-20); // курьер увёз 20
      await c.applyCount({ id });
      expect((await stockOf(s.productId)).current).toBe(77);
    });

    it("приход после счёта не списывается недостачей", async () => {
      const c = await api();
      const { id } = await c.create({ warehouseId: s.warehouseId });
      await c.setCounted({ id, productId: s.productId, counted: 100 });
      await move(+50);
      const r = await c.applyCount({ id });
      expect((await stockOf(s.productId)).current).toBe(150);
      expect(r.changed).toBe(0);
    });

    it("сканер прибавляет по одной, снимок учёта — с первого касания", async () => {
      const c = await api();
      const { id } = await c.create({ warehouseId: s.warehouseId });
      for (let i = 0; i < 5; i++) await c.setCounted({ id, productId: s.productId, delta: 1 });
      const [row] = await db.select().from(schema.stockCountItems).where(eq(schema.stockCountItems.productId, s.productId));
      expect(row.counted).toBe("5.00");
      expect(row.bookAtCount).toBe("100.00");
    });
  });
});

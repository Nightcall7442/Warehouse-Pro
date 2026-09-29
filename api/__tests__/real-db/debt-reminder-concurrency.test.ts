import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Напоминание о долге — одно на заказ и без взаимной блокировки.
 *
 * Что было: upsertDebtReminder искал открытое напоминание заказа через
 * `select … for update`. Когда напоминания ещё нет, такой запрос ставит
 * замок на промежуток индекса, а у свежих заказов промежуток общий. Две
 * одновременные записи долга со сроком по РАЗНЫМ заказам брали его обе, и
 * каждая ждала другую на вставке: ER_LOCK_DEADLOCK, и вся сделка — оплата
 * по частям, доставка курьера, «Закрыть расчёт» — откатывалась. Из восьми
 * одновременных проходила одна.
 *
 * Что проверяется — на настоящей базе:
 *   · восемь сделок одновременно, каждая как у вызывающих: замок своего
 *     заказа, затем upsertDebtReminder — все проходят, у каждого заказа своё
 *     напоминание;
 *   · две одновременные оплаты со сроком по ОДНОМУ заказу настоящим путём —
 *     напоминание одно (его сторожит замок строки заказа), с последним
 *     остатком.
 *
 * Почему восемь сделок — через общую дверь, а не через оплату целиком:
 * одновременные оплаты сами по себе иногда ловят друг друга в пересчёте
 * долга магазина (UPDATE shops с подзапросами по платежам) — это было до
 * напоминаний и чинится отдельно; здесь проверяется только напоминание.
 *
 * Нарочная поломка: верни `.for("update")` в поиск напоминания в
 * upsertDebtReminder — падает «восемь заказов» (взаимная блокировка).
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("напоминание о долге под одновременной записью", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
  });

  /** Доставленный заказ на 300. */
  const delivered = async (n: number) => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№${n}`,
      status: "delivered", deliveryStatus: "delivered", paymentMethod: "cash", subtotal: "300.00", total: "300.00", deliveredAt: new Date(),
    });
    return Number(r.insertId);
  };
  const reminders = async () => (await (db as any).execute(sql`
    SELECT order_id AS orderId, CAST(amount AS DECIMAL(15,2)) AS amount, DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate FROM debt_reminders ORDER BY order_id, id`) as unknown as [Array<Record<string, unknown>>])[0]
    .map(r => ({ orderId: Number(r.orderId), amount: Number(r.amount), dueDate: String(r.dueDate) }));

  it("восемь заказов одновременно: все записи проходят, у каждого заказа своё напоминание", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(await delivered(i));
    const { upsertDebtReminder } = await import("../../services/order-shared");

    const res = await Promise.allSettled(ids.map(id => (db as any).transaction(async (tx: any) => {
      // Как у всех трёх вызывающих: первым запросом сделки — замок своего заказа.
      await tx.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.tenantId, s.tenantId), eq(schema.orders.id, id))).for("update");
      await upsertDebtReminder(tx, s.tenantId, { shopId: s.shopId, orderId: id, amount: "200.00", dueDate: "2026-10-05" });
    })));
    const failed = res.flatMap(r => r.status === "rejected" ? [String((r.reason as { cause?: { code?: string } })?.cause?.code ?? r.reason)] : []);
    expect(failed, "одновременные записи долга по разным заказам сорвались").toEqual([]);
    expect(await reminders()).toEqual(ids.map(orderId => ({ orderId, amount: 200, dueDate: "2026-10-05" })));
  });

  it("один заказ дважды одновременно настоящей оплатой: напоминание одно, с последним остатком", async () => {
    const id = await delivered(1);
    const { OrderService } = await import("../../services/order");
    const pay = (debtDueDate: string) => OrderService.recordPartialPayment(db as any, s.tenantId, { id: ceoId, role: "ceo" }, { orderId: id, paidAmount: "100", method: "cash", debtDueDate });

    const res = await Promise.allSettled([pay("2026-10-05"), pay("2026-10-12")]);
    expect(res.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const rows = await reminders();
    expect(rows, "замок заказа не удержал второе напоминание").toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId: id, amount: 100 });
  });
});

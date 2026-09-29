import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Напоминание о долге — одно на заказ и без взаимной блокировки.
 *
 * Что было: upsertDebtReminder искал открытое напоминание заказа через
 * `select … for update`. Когда напоминания ещё нет, такой запрос ставит
 * замок на промежуток индекса, а у свежих заказов промежуток общий. Две
 * одновременные оплаты по частям со сроком — по РАЗНЫМ заказам РАЗНЫХ
 * магазинов — брали его обе, и каждая ждала другую на вставке:
 * ER_LOCK_DEADLOCK, платёж откатывался целиком. Из восьми одновременных
 * оплат проходила одна. Тот же путь у курьера (доставка с остатком в долг) и
 * у офиса («Закрыть расчёт»).
 *
 * Что проверяется — на настоящей базе, настоящим путём оплаты:
 *   · восемь одновременных оплат со сроком по заказам восьми магазинов — все
 *     проходят, у каждого заказа своё напоминание;
 *   · две одновременные оплаты со сроком по ОДНОМУ заказу — напоминание одно
 *     (его сторожит замок строки заказа), с последним остатком.
 *
 * Магазины разные нарочно: одновременные оплаты одного магазина упираются в
 * его строку (пересчёт долга) — это другое место и было до напоминаний.
 *
 * Нарочная поломка: верни `.for("update")` в поиск напоминания в
 * upsertDebtReminder — падает «восемь магазинов» (взаимная блокировка).
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("напоминание о долге под одновременными оплатами", () => {
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

  /** Доставленный заказ на 300 у своего магазина. */
  const delivered = async (n: number, shopId?: number) => {
    const d = db as any;
    const shop = shopId ?? Number((await d.insert(schema.shops).values({ tenantId: s.tenantId, name: `Магазин ${n}` }))[0].insertId);
    const [r] = await d.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: shop, agentId: s.agentId, orderNumber: `№${n}`,
      status: "delivered", deliveryStatus: "delivered", paymentMethod: "cash", subtotal: "300.00", total: "300.00", deliveredAt: new Date(),
    });
    return Number(r.insertId);
  };
  const pay = async (orderId: number, debtDueDate: string) => {
    const { OrderService } = await import("../../services/order");
    return OrderService.recordPartialPayment(db as any, s.tenantId, { id: ceoId, role: "ceo" }, { orderId, paidAmount: "100", method: "cash", debtDueDate });
  };
  const reminders = async () => (await (db as any).execute(sql`
    SELECT order_id AS orderId, CAST(amount AS DECIMAL(15,2)) AS amount FROM debt_reminders ORDER BY order_id, id`) as unknown as [Array<Record<string, unknown>>])[0]
    .map(r => ({ orderId: Number(r.orderId), amount: Number(r.amount) }));

  it("восемь магазинов одновременно: все оплаты проходят, у каждого заказа своё напоминание", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(await delivered(i));

    const res = await Promise.allSettled(ids.map(id => pay(id, "2026-10-05")));
    const failed = res.flatMap(r => r.status === "rejected" ? [String((r.reason as { cause?: { code?: string } })?.cause?.code ?? r.reason)] : []);
    expect(failed, "одновременные оплаты по разным заказам сорвались").toEqual([]);
    expect(await reminders()).toEqual(ids.map(orderId => ({ orderId, amount: 200 })));
  });

  it("один заказ дважды одновременно: напоминание одно, с последним остатком", async () => {
    const id = await delivered(1, s.shopId);
    const res = await Promise.allSettled([pay(id, "2026-10-05"), pay(id, "2026-10-12")]);
    expect(res.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await reminders(), "замок заказа не удержал второе напоминание").toEqual([{ orderId: id, amount: 100 }]);
  });
});

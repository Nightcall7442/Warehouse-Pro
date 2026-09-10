/**
 * Долг по агенту и долг магазина сходятся.
 *
 * ── Где расходились ─────────────────────────────────────────────────────────
 *
 * Одни и те же заказы дают долг в двух местах продукта:
 *
 *   • shops.debt — пересчитывается services/shop-debt.ts, возвраты учитывает;
 *   • колонка «долг» в сводке по агентам на экране заказов — свой запрос в
 *     order-router.ts, возвраты не учитывал ВОВСЕ.
 *
 * Магазин вернул половину доставленного заказа: в карточке магазина долг упал,
 * на экране заказов остался прежним. Оператор видел две цифры по одним и тем
 * же заказам и не мог объяснить разницу — а решение «звонить или отгружать»
 * принимается по ней.
 *
 * ── Почему только на настоящей базе ─────────────────────────────────────────
 *
 * Оба выражения — сырой SQL с коррелированными подзапросами. Заглушки его не
 * исполняют: они подменяют расчёт своим на JavaScript, то есть проверяют
 * двойника. Здесь выполняются ровно те запросы, что уедут в продакшен, и
 * сравниваются их ЧИСЛА.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { recalcShopDebt } from "../../services/shop-debt";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("долг по агенту повторяет долг магазина", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  async function order(opts: {
    total: string; status?: string; paymentMethod?: string; deleted?: boolean;
  }): Promise<number> {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: (opts.status ?? "delivered") as never,
      paymentMethod: (opts.paymentMethod ?? "cash") as never,
      subtotal: opts.total, total: opts.total,
      deletedAt: opts.deleted ? new Date() : null,
    } as never);
    return Number(row.insertId);
  }

  async function pay(orderId: number, amount: string) {
    await db.insert(schema.payments).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId,
      amount, type: "payment", paymentMethod: "cash",
    } as never);
  }

  async function completedReturn(orderId: number, amount: string) {
    await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId,
      returnNumber: `В-${Math.random().toString(36).slice(2, 8)}`,
      status: "completed", totalAmount: amount,
    } as never);
  }

  /** Долг магазина — боевым пересчётом. */
  async function shopDebt(): Promise<number> {
    await db.transaction(async (tx) => {
      await recalcShopDebt(tx as never, s.tenantId, s.shopId);
    });
    const [row] = await db.select({ debt: schema.shops.debt })
      .from(schema.shops).where(eq(schema.shops.id, s.shopId));
    return Number(row.debt);
  }

  /**
   * Долг по агенту — тем же выражением, что в order-router.agentSummary.
   *
   * Выражение повторено здесь дословно нарочно. Позвать сам роутер значило бы
   * поднимать tRPC с контекстом и правами ради одной колонки, а проверять
   * ХОТЬ ЧТО-ТО в этом выражении иначе нечем: оно живёт внутри select и
   * снаружи не видно. За тем, что копия не разъедется с оригиналом, следит
   * api/__tests__/returns-netted-one-way.test.ts — там сверяются условия.
   */
  async function agentDebt(): Promise<number> {
    const rows = await db.execute(sql`
      SELECT GREATEST(0, COALESCE(SUM(
        CASE
          WHEN o.status IN ('cancelled','returned') THEN 0
          WHEN o.payment_method = 'debt' OR o.status = 'delivered'
            THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE((
              SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
              WHERE p.order_id = o.id AND p.type = 'payment'
            ), 0)) - COALESCE((
              SELECT SUM(CAST(r.total_amount AS DECIMAL(15,2))) FROM returns r
              WHERE r.order_id = o.id AND r.status = 'completed'
            ), 0)
          ELSE 0
        END
      ), 0)) AS debt
      FROM orders o
      WHERE o.agent_id = ${s.agentId} AND o.tenant_id = ${s.tenantId} AND o.deleted_at IS NULL
    `);
    const [list] = rows as unknown as [Array<{ debt: unknown }>, unknown];
    return Number(list[0]?.debt ?? 0);
  }

  it("возврат по доставленному заказу виден обеим цифрам", async () => {
    // Заказ на 300, вернули товара на 120. Долг обязан стать 180 в обоих
    // местах: раньше на экране заказов оставалось 300.
    const delivered = await order({ total: "300.00" });
    await completedReturn(delivered, "120.00");

    expect(await agentDebt()).toBe(180);
    expect(await shopDebt()).toBe(180);
  });

  it("возврат и оплата вместе закрывают заказ в обеих цифрах", async () => {
    const delivered = await order({ total: "300.00" });
    await pay(delivered, "150.00");
    await completedReturn(delivered, "150.00");

    expect(await agentDebt()).toBe(0);
    expect(await shopDebt()).toBe(0);
  });

  it("возврат по ОТМЕНЁННОМУ заказу не съедает соседний", async () => {
    /*
      Отменённый заказ уже не начисляет ничего — его сумма списана целиком.
      Вычти возврат по нему сверху, и он уедет из чужого, живого заказа.

      Второй заказ здесь обязателен: на единственном заказе нижняя граница
      прячет излишек, и ошибка не видна числом. Ровно поэтому она и жила.
    */
    const cancelled = await order({ total: "300.00", status: "cancelled" });
    await completedReturn(cancelled, "300.00");
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });

    expect(await agentDebt()).toBe(500);
    expect(await shopDebt()).toBe(500);
  });

  it("переплаченный и возвращённый заказ отдаёт кредит соседнему", async () => {
    /*
      Магазин заплатил всё и вернул часть товара — эти деньги теперь его, и
      они гасят другой его заказ. Нижняя граница стоит на ВСЕЙ сумме, а не на
      каждом заказе: поставь её на каждый, и право на деньги пропало бы.
    */
    const delivered = await order({ total: "300.00" });
    await pay(delivered, "300.00");
    await completedReturn(delivered, "120.00");
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });

    expect(await agentDebt()).toBe(380);
    expect(await shopDebt()).toBe(380);
  });

  it("незаявленный возврат долг не трогает", async () => {
    // Только проведённые: заявленный или отклонённый товара не двигал.
    const delivered = await order({ total: "300.00" });
    await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId: delivered,
      returnNumber: `В-${Math.random().toString(36).slice(2, 8)}`,
      status: "pending", totalAmount: "120.00",
    } as never);

    expect(await agentDebt()).toBe(300);
    expect(await shopDebt()).toBe(300);
  });
});

/**
 * Долг магазина: оплата не исчезает, возврат не списывается дважды.
 *
 * ── Почему именно на настоящей базе ──────────────────────────────────────────
 *
 * recalcShopDebt — один UPDATE с четырьмя подзапросами, и заглушки его не
 * исполняют: они подменяют расчёт своим на JavaScript (helpers/shop-debt-recalc).
 * Двойник полезен, но проверяет он себя. Здесь же проверяется тот самый SQL,
 * который выполняет продакшен, — а именно в нём и жили обе ошибки:
 *
 *   • платёж по заказу вычитался ИЗНУТРИ слагаемого этого заказа, и когда
 *     заказ переставал быть должным (отменили, вернули, откатили в работу),
 *     платёж исчезал вместе с ним: деньги, которые магазин уже внёс,
 *     переставали учитываться где бы то ни было;
 *
 *   • возврат вычитался при условии «заказ не отменён и не возвращён» —
 *     похожем на условие начисления, но не совпадающем с ним. Удалённый заказ
 *     и заказ, выведенный из «доставлен» обратно в работу, начисляли ноль, а
 *     возврат по ним продолжал вычитаться: те же деньги списывались дважды.
 *
 * Нижняя граница GREATEST(0, …) прячет обе на магазине с единственным
 * заказом — потому это и жило незамеченным. Проверки ниже намеренно ставят
 * магазину ВТОРОЙ, открытый долговой заказ: излишек тогда съедает чужой долг
 * и виден числом.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { recalcShopDebt } from "../../services/shop-debt";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("правила долга магазина на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  /** Заказ магазина. Возвращает его номер в базе. */
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

  async function pay(orderId: number | null, amount: string) {
    await db.insert(schema.payments).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId,
      amount, type: "payment", paymentMethod: "cash",
    } as never);
  }

  async function completedReturn(orderId: number | null, amount: string) {
    await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId,
      // Номер возврата обязателен и умолчания не имеет: без него вставка
      // падает с «Field 'return_number' doesn't have a default value».
      // Заглушки этого не показывают — они не знают ограничений столбцов, и
      // ошибка нашлась только на настоящей MySQL, в CI.
      returnNumber: `В-${Math.random().toString(36).slice(2, 8)}`,
      status: "completed", totalAmount: amount,
    } as never);
  }

  /** Долг, каким его посчитал боевой запрос. */
  async function debt(): Promise<number> {
    await db.transaction(async (tx) => {
      await recalcShopDebt(tx as never, s.tenantId, s.shopId);
    });
    const [row] = await db.select({ debt: schema.shops.debt })
      .from(schema.shops)
      .where(eq(schema.shops.id, s.shopId));
    return Number(row.debt);
  }

  it("оплата отменённого заказа остаётся деньгами магазина", async () => {
    /*
      Магазин внёс 100 из 300, заказ отменили. Обязательство ушло — верно;
      сотня уйти не могла: её уже заплатили. Второй заказ в долг на 500
      показывает разницу числом: без учёта сотни вышло бы 500.
    */
    const cancelled = await order({ total: "300.00", status: "cancelled" });
    await pay(cancelled, "100.00");
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });

    expect(await debt()).toBe(400);
  });

  it("оплата удалённого заказа деньгами магазина не становится", async () => {
    /*
      Удаление — способ исправить ошибку ВВОДА: заказа не было вовсе, значит
      не было и оплаты по нему. Засчитать её значило бы выдать магазину
      придуманный кредит.
    */
    const removed = await order({ total: "300.00", deleted: true });
    await pay(removed, "100.00");
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });

    expect(await debt()).toBe(500);
  });

  it("возврат по удалённому заказу второй раз долг не уменьшает", async () => {
    /*
      Удалённый заказ уже не начисляет ничего. Возврат по нему продолжал
      вычитаться — то есть те же деньги списывались дважды. На магазине с
      одним заказом это прятала нижняя граница; здесь излишек съедал бы долг
      по СОСЕДНЕМУ заказу.
    */
    const removed = await order({ total: "300.00", deleted: true });
    await completedReturn(removed, "300.00");
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });

    expect(await debt()).toBe(500);
  });

  it("возврат по живому доставленному заказу долг уменьшает", async () => {
    // Обратная сторона: это и есть смысл документа возврата, и он обязан
    // работать. Заказ доставлен на 300, вернули на 120.
    const delivered = await order({ total: "300.00", status: "delivered" });
    await completedReturn(delivered, "120.00");

    expect(await debt()).toBe(180);
  });

  it("возврат без заказа вычитается всегда", async () => {
    // Ему нечему соответствовать — это отдельное обязательство.
    await order({ total: "500.00", status: "new", paymentMethod: "debt" });
    await completedReturn(null, "200.00");

    expect(await debt()).toBe(300);
  });

  it("обычный долговой заказ с частичной оплатой считается как прежде", async () => {
    // Сторожевая проверка: правки не должны были тронуть основной случай.
    const debtOrder = await order({ total: "300.00", status: "new", paymentMethod: "debt" });
    await pay(debtOrder, "120.00");

    expect(await debt()).toBe(180);
  });
});

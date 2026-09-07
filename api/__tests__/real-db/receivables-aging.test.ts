/**
 * Старение долга магазинов — на настоящей MySQL.
 *
 * ── Почему не на заглушке ────────────────────────────────────────────────────
 *
 * Разбор строк в отчёт проверен отдельно и на заглушке (api/__tests__/
 * receivables-aging.test.ts): там чистая функция, и её можно кормить чем
 * угодно. А вот сам запрос заглушка не выполняет — она подменяет сырой sql``
 * расчётом на JavaScript по своим таблицам, то есть проверяет собственную
 * подделку.
 *
 * Для этого запроса разница решающая. В нём есть ровно та конструкция, которая
 * первого сентября уже соврала про деньги молча: коррелирующий подзапрос
 * `SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id`. Стоит
 * потерять уточнение таблицы — и MySQL разрешит имя в пользу внутренней
 * таблицы, условие тихо станет `p.order_id = p.id`, ошибки не будет, а сумма
 * долга окажется другой. Соседний файл supplier-debt.test.ts заведён после
 * ровно такого случая.
 *
 * ── Что здесь проверяется ────────────────────────────────────────────────────
 *
 *   • долг попадает в ту корзину, которой соответствует возраст заказа;
 *   • частичная оплата уменьшает долг, а не убирает заказ целиком;
 *   • отменённые и возвращённые заказы в долг не входят;
 *   • корзины плюс неотнесённый остаток дают ровно shops.debt — то самое
 *     число, что стоит на карточке магазина;
 *   • чужая организация не подмешивается.
 *
 * ── Про даты ─────────────────────────────────────────────────────────────────
 *
 * Возраст считает MySQL через DATEDIFF(CURDATE(), …) — намеренно на сервере:
 * у клиента свой часовой пояс, и граница «тридцать дней» сдвигалась бы на
 * сутки. Поэтому даты заказов здесь задаются относительно СЕГОДНЯ, а не
 * константами: тест не должен зависеть от того, когда его запустили.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { receivablesAging, AGE_BUCKETS } from "../../services/receivables";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

// hasRealDb — значение, а не функция: без TEST_DATABASE_URL набор пропускается.
const describeIf = hasRealDb ? describe : describe.skip;

/** Дата на N дней назад — в том виде, в каком её примет колонка. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describeIf("старение долга магазинов на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  /** Заказ в долг с заданным возрастом. Возвращает его номер. */
  async function debtOrder(opts: {
    days: number; total: string; status?: string; paid?: string; shopId?: number; tenantId?: number;
  }) {
    const [order] = await db.insert(schema.orders).values({
      tenantId: opts.tenantId ?? s.tenantId,
      shopId: opts.shopId ?? s.shopId,
      agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: (opts.status ?? "delivered") as never,
      paymentMethod: "debt",
      subtotal: opts.total,
      total: opts.total,
      createdAt: daysAgo(opts.days),
    } as never);
    const orderId = Number(order.insertId);

    if (opts.paid) {
      await db.insert(schema.payments).values({
        tenantId: opts.tenantId ?? s.tenantId,
        shopId: opts.shopId ?? s.shopId,
        orderId,
        amount: opts.paid,
        type: "payment",
        paymentMethod: "cash",
      } as never);
    }
    return orderId;
  }

  const sumBuckets = (b: Record<string, number>) =>
    AGE_BUCKETS.reduce((acc, k) => acc + b[k], 0);

  it("возраст заказа определяет корзину", async () => {
    await debtOrder({ days: 3,  total: "100.00" });
    await debtOrder({ days: 20, total: "200.00" });
    await debtOrder({ days: 45, total: "400.00" });
    await debtOrder({ days: 90, total: "800.00" });

    const out = await receivablesAging(db, s.tenantId);

    expect(out.buckets.d0_7).toBe(100);
    expect(out.buckets.d8_30).toBe(200);
    expect(out.buckets.d31_60).toBe(400);
    expect(out.buckets.d60plus).toBe(800);
  });

  it("частичная оплата уменьшает долг, а не убирает заказ", async () => {
    /*
      Здесь и ловится потерянное уточнение таблицы: при `p.order_id = p.id`
      подзапрос вернул бы не ту сумму, и в корзину легло бы 300 или 0 вместо
      120. Числа подобраны так, чтобы ошибка давала ДРУГОЙ ответ.
    */
    await debtOrder({ days: 10, total: "300.00", paid: "180.00" });

    const out = await receivablesAging(db, s.tenantId);
    expect(out.buckets.d8_30).toBe(120);
  });

  it("полностью оплаченный заказ в долг не входит", async () => {
    await debtOrder({ days: 10, total: "300.00", paid: "300.00" });

    const out = await receivablesAging(db, s.tenantId);
    expect(sumBuckets(out.buckets)).toBe(0);
  });

  it("отменённый и возвращённый заказы долгом не считаются", async () => {
    await debtOrder({ days: 10, total: "500.00", status: "cancelled" });
    await debtOrder({ days: 10, total: "700.00", status: "returned" });

    const out = await receivablesAging(db, s.tenantId);
    expect(sumBuckets(out.buckets)).toBe(0);
  });

  it("корзины и остаток дают ровно долг с карточки магазина", async () => {
    /*
      Главная проверка. Экран показывает корзины и строку «не привязано к
      заказу»; вместе они обязаны давать shops.debt — то самое число, что
      стоит на карточке. Разойдись они, и верить нельзя ни одному.
    */
    await debtOrder({ days: 10, total: "300.00" });

    // Ручное начисление на магазин, без заказа: его состарить нечем.
    await db.insert(schema.payments).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId: null,
      amount: "200.00", type: "debt", paymentMethod: "cash",
    } as never);

    const { recalcShopDebt } = await import("../../services/shop-debt");
    await db.transaction(async (tx) => { await recalcShopDebt(tx as never, s.tenantId, s.shopId); });

    const out = await receivablesAging(db, s.tenantId);
    const shop = out.shops.find(x => x.shopId === s.shopId)!;

    expect(shop.debt).toBe(500);
    expect(shop.buckets.d8_30).toBe(300);
    expect(shop.unattributed).toBe(200);
    expect(sumBuckets(shop.buckets) + shop.unattributed).toBe(shop.debt);
  });

  it("заказ, возвращённый в работу, не молодеет", async () => {
    /*
      У заказа, побывавшего в архиве, created_at — дата ТЕКУЩЕГО круга: её
      двигает services/order-reopen, чтобы выручка второго круга не падала в
      месяц первого. Долг так двигать нельзя: товар уехал в магазин девяносто
      дней назад, и правка статуса сегодня не делает этот долг сегодняшним.

      Числа подобраны так, чтобы ошибка давала ДРУГОЙ ответ: возьми запрос
      created_at — и восемьсот легли бы в d0_7 вместо d60plus.
    */
    const orderId = await debtOrder({ days: 0, total: "800.00" });
    await db.update(schema.orders)
      .set({ firstOrderedAt: daysAgo(90) })
      .where(eq(schema.orders.id, orderId));

    const out = await receivablesAging(db, s.tenantId);

    expect(out.buckets.d60plus).toBe(800);
    expect(out.buckets.d0_7).toBe(0);
    expect(out.shops.find(x => x.shopId === s.shopId)!.oldestDays).toBeGreaterThanOrEqual(89);
  });

  it("у обычного заказа пустая первая дата ничего не ломает", async () => {
    // COALESCE обязан вернуться к created_at: заказов, никогда не бывавших в
    // архиве, подавляющее большинство, и они не должны попасть в d60plus
    // из-за NULL.
    await debtOrder({ days: 3, total: "150.00" });

    const out = await receivablesAging(db, s.tenantId);
    expect(out.buckets.d0_7).toBe(150);
    expect(out.buckets.d60plus).toBe(0);
  });

  it("долг соседней организации не подмешивается", async () => {
    const [otherShop] = await db.insert(schema.shops).values({
      tenantId: s.otherTenantId, name: "Чужой магазин", debt: "9999.00",
    } as never);
    await debtOrder({
      days: 10, total: "1000.00",
      tenantId: s.otherTenantId, shopId: Number(otherShop.insertId),
    });

    const out = await receivablesAging(db, s.tenantId);
    expect(out.shops.some(x => x.shopName === "Чужой магазин")).toBe(false);
    expect(out.totalDebt).toBe(0);
  });
});

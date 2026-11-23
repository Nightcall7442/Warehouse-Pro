/* ═══════════════════════════════════════════════════════════════════════════
   Сколько по заказу ещё можно вернуть — одно правило на сервер и на экран.

   ── Откуда это вынесено ─────────────────────────────────────────────────────
   Правило жило внутри returns.create и отвечало только «да» или «нет». Окну
   «Оформить возврат» в вебе нужно ЧИСЛО по каждой строке заказа — сколько
   ещё можно вписать. Посчитай экран его сам, он разошёлся бы с сервером на
   первой же правке одного из двух: окно пускало бы количество, которое
   сервер отвергнет, или прятало бы то, что вернуть можно. Поэтому одна
   функция: create проверяет по ней, returns.returnable отдаёт её экрану.

   ── Что такое «доставлено» ──────────────────────────────────────────────────
   Вернуть можно только то, что реально доехало до магазина. Сравнение раньше
   шло с ЗАКАЗАННЫМ количеством: курьер, отдавший 4 из 10 и отметивший это как
   частичный возврат, уже вернул 6 единиц на склад, а order_items.quantity
   оставалась десяткой — и документ на все 10 проходил проверку. При
   проведении те же 6 зачислялись на склад второй раз, а из долга вычиталась
   стоимость десяти при заказе, стоящем как четыре.

   deliveredQuantity пусто у заказов, доставленных без построчного учёта, —
   там заказанное и есть отгруженное. Тот же COALESCE стоит в deliveredQty()
   и в heldQuantity().

   ── Что такое «уже возвращено» ──────────────────────────────────────────────
   Все возвраты этого заказа, кроме отклонённых. Отклонённого не было: товар
   назад не приняли, и он не должен мешать законному возврату того же товара.
   На рассмотрении, одобренный и проведённый — считаются: эти возвращают (или
   уже вернули) товар.

   ── Про дроби ───────────────────────────────────────────────────────────────
   Количество бывает дробным (килограммы). 1.2 + 1.3 в числах с плавающей
   точкой — это 2.5000000000000004, и сравнение «больше доставленного»
   отвергало бы ровно доставленное. Сравниваем в тысячных — это точность
   колонки количества в базе.
   ═══════════════════════════════════════════════════════════════════════════ */
import { and, eq, ne, sql } from "drizzle-orm";
import { orderItems, orders, returnItems, returns } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface ReturnableLine {
  productId: number;
  /** Доставлено магазину: deliveredQuantity, а без построчного учёта — заказанное. */
  shipped: number;
  /** Уже в возвратах этого заказа, кроме отклонённых. */
  returned: number;
  /** Сколько ещё можно вернуть; не меньше нуля. */
  left: number;
  /**
   * Цена единицы, которую магазин заплатил: цена строки за вычетом доли
   * скидки заказа. По ней и возврат.
   *
   * Стояла цена строки ДО скидки. Скидка хранится на заказе (orders.discount),
   * а не в строке, поэтому заказ 100 шт × 10 000 со скидкой 20% (к оплате
   * 800 000) возвращался целиком на 1 000 000 — лишние 200 000 гасили другие
   * долги магазина и занижали выручку (бизнес-аудит 19.11.2026, п. 7).
   * Частичная доставка долю скидки уже пересчитывала, возврат — нет.
   */
  unitPrice: number;
}

/** Тысячные — точность колонки количества (decimal(…, 3)). */
const milli = (n: number) => Math.round(n * 1000);

/**
 * Строки заказа с остатком к возврату, по товару. Товара нет в Map — его нет
 * в заказе. Организация — в условии по заказу: чужой заказ даёт пустоту,
 * даже если вызывающий забыл проверить его сам.
 */
export async function returnableLines(db: Db, tenantId: number, orderId: number): Promise<Map<number, ReturnableLine>> {
  const [lines, back] = await Promise.all([
    db.select({
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      deliveredQuantity: orderItems.deliveredQuantity,
      unitPrice: orderItems.unitPrice,
      orderSubtotal: orders.subtotal,
      orderDiscount: orders.discount,
    }).from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orderItems.orderId, orderId), eq(orders.tenantId, tenantId)))
      .orderBy(orderItems.id),
    db.select({
      productId: returnItems.productId,
      total: sql<string>`COALESCE(SUM(${returnItems.quantity}), 0)`,
    }).from(returnItems)
      .innerJoin(returns, eq(returnItems.returnId, returns.id))
      .where(and(eq(returns.orderId, orderId), eq(returns.tenantId, tenantId), ne(returns.status, "rejected")))
      .groupBy(returnItems.productId),
  ]);

  const out = new Map<number, ReturnableLine>();
  // Товар дважды в одном заказе — берётся первая строка, как и раньше в create.
  for (const l of lines) {
    const productId = Number(l.productId);
    if (out.has(productId)) continue;
    const shipped = Number(l.deliveredQuantity ?? l.quantity);
    const subtotal = Number(l.orderSubtotal);
    const kept = subtotal > 0 ? Math.max(0, 1 - Number(l.orderDiscount) / subtotal) : 1;
    const paid = Math.round(Number(l.unitPrice) * kept * 100) / 100;
    out.set(productId, { productId, shipped, returned: 0, left: shipped, unitPrice: paid });
  }
  for (const b of back) {
    const line = out.get(Number(b.productId));
    if (!line) continue;
    line.returned = Number(b.total);
    line.left = Math.max(0, milli(line.shipped) - milli(line.returned)) / 1000;
  }
  return out;
}

/** Вписать ещё quantity — больше, чем осталось к возврату? */
export function exceedsReturnable(line: ReturnableLine, quantity: number): boolean {
  return milli(line.returned) + milli(quantity) > milli(line.shipped);
}

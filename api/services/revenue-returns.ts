/* ═══════════════════════════════════════════════════════════════════════════
   Возвраты, уменьшающие выручку.

   ── Чего не хватало ─────────────────────────────────────────────────────────

   Слова «возврат» в расчёте прибыли не было вовсе. Проведённый возврат
   возвращал товар на склад и уменьшал долг магазина — обе эти стороны
   работали, — а выручка оставалась полной. Организация, у которой возвраты
   случаются регулярно, видела прибыль выше настоящей ровно на их сумму, и
   узнать об этом было неоткуда: расхождение нигде не проявлялось числом.

   ── Почему это не двойной счёт ──────────────────────────────────────────────

   Товар может вернуться двумя путями, и они не складываются:

     • заказ целиком помечают «отменён» или «возвращён» — тогда он выпадает из
       выручки полностью, потому что выручкой считается только «доставлен»;
     • по доставленному заказу проводят документ возврата — заказ остаётся
       доставленным и своей полной суммой в выручке, а вернувшаяся часть не
       вычиталась ниоткуда.

   Провести документ по отменённому или возвращённому заказу нельзя — это
   отдельно запрещено в returns-router, — так что пути не пересекаются. Но
   заказ можно перевести в «отменён» ПОСЛЕ проведения возврата, и тогда
   вычитать возврат уже нельзя: сумма заказа и так ушла из выручки целиком.

   Поэтому здесь стоит ровно тот же отбор заказов, что и у самой выручки
   (revenueOrderConditions). Ровно та же ошибка — похожее, но не совпадающее
   условие — уже стоила расхождений в долге магазина.

   ── Про даты ────────────────────────────────────────────────────────────────

   Возврат уменьшает выручку ТОГО месяца, когда он проведён, а не того, когда
   продали. Иначе закрытый месяц менялся бы задним числом каждый раз, когда
   магазин что-то возвращает. Это обычная встречная запись, и по ней период
   сходится сам с собой.

   ── Про себестоимость ───────────────────────────────────────────────────────

   У строки возврата своей себестоимости нет — только цена продажи. Берётся
   себестоимость, записанная в СТРОКЕ ЗАКАЗА по тому же товару: именно она
   попала в COGS при продаже, и вычесть надо ровно её. Если строки нет
   (возврат по товару, которого в заказе не было), берётся текущая
   себестоимость товара, а если нет и её — ноль: занизить возврат
   себестоимости безопаснее, чем выдумать её.
   ═══════════════════════════════════════════════════════════════════════════ */
import { and, eq, sql, inArray } from "drizzle-orm";
import { returns, returnItems, orderItems, products, orders } from "@db/schema";
import { revenueOrderConditions } from "../lib/order-status";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface ReturnedValue {
  /** Сумма продажи, вернувшаяся магазину. Вычитается из выручки. */
  amount: number;
  /** Себестоимость вернувшегося товара. Вычитается из COGS. */
  cost: number;
}

export const NOTHING_RETURNED: ReturnedValue = { amount: 0, cost: 0 };

export interface ReturnRow extends ReturnedValue {
  /** Месяц проведения, «ГГГГ-ММ» — для месячного графика. */
  month: string;
  /** Способ оплаты ЗАКАЗА — для разбивки «чем платят». */
  paymentMethod: string;
  agentId: number | null;
}

/**
 * Проведённые возвраты периода, по одной строке на документ.
 *
 * Разбирают их вызывающие: сложить всё, разложить по месяцам, разложить по
 * способу оплаты. Возвратов за период единицы, и складывать их в JS дешевле,
 * чем держать три почти одинаковых запроса с разной группировкой — а
 * разъезжаются между собой именно такие.
 */
export async function returnsInPeriod(
  db: Db, tenantId: number, from: string, to: string,
): Promise<ReturnRow[]> {
  const rows = await db.select({
    id:            returns.id,
    month:         sql<string>`DATE_FORMAT(${returns.createdAt}, '%Y-%m')`,
    amount:        returns.totalAmount,
    paymentMethod: orders.paymentMethod,
    agentId:       orders.agentId,
  })
    .from(returns)
    // innerJoin, а не leftJoin: возврат без заказа выручку не уменьшает —
    // ей не из чего вычитаться, такой возврат живёт только в долге магазина.
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .where(and(
      eq(returns.tenantId, tenantId),
      eq(returns.status, "completed"),
      sql`${returns.createdAt} >= ${from}`,
      sql`${returns.createdAt} <= ${to + " 23:59:59"}`,
      // Тот же отбор, что у выручки: доставлен, не удалён.
      ...revenueOrderConditions(tenantId),
    ));

  if (rows.length === 0) return [];

  /*
    Себестоимость отдельным запросом и суммой в JS — тот же приём, что в
    services/order.ts у возвращённых количеств. Соединять три таблицы и
    группировать ради десятка строк незачем, а запрос остаётся внутри того
    куска построителя, который умеют служебные заглушки.
  */
  const ids = rows.map(r => Number(r.id));
  const costRows = await db.select({
    returnId:  returnItems.returnId,
    quantity:  returnItems.quantity,
    orderCost: orderItems.costPrice,
    productCost: products.costPrice,
  })
    .from(returnItems)
    .leftJoin(returns, eq(returns.id, returnItems.returnId))
    .leftJoin(orderItems, and(
      eq(orderItems.orderId, returns.orderId),
      eq(orderItems.productId, returnItems.productId),
    ))
    .leftJoin(products, eq(products.id, returnItems.productId))
    .where(inArray(returnItems.returnId, ids));

  const costByReturn = new Map<number, number>();
  for (const c of costRows) {
    const unit = Number(c.orderCost ?? c.productCost ?? 0) || 0;
    const key = Number(c.returnId);
    costByReturn.set(key, (costByReturn.get(key) ?? 0) + Number(c.quantity) * unit);
  }

  return rows.map(r => ({
    month:         r.month,
    paymentMethod: r.paymentMethod ?? "unknown",
    agentId:       r.agentId ?? null,
    amount:        Number(r.amount) || 0,
    cost:          costByReturn.get(Number(r.id)) ?? 0,
  }));
}

/** Сложить строки в одну величину. */
export function totalReturned(rows: ReturnRow[]): ReturnedValue {
  return rows.reduce<ReturnedValue>(
    (acc, r) => ({ amount: acc.amount + r.amount, cost: acc.cost + r.cost }),
    { ...NOTHING_RETURNED },
  );
}

/** Разложить строки по ключу: месяц, способ оплаты — что понадобится. */
export function groupReturned(
  rows: ReturnRow[], key: (r: ReturnRow) => string,
): Map<string, ReturnedValue> {
  const out = new Map<string, ReturnedValue>();
  for (const r of rows) {
    const k = key(r);
    const prev = out.get(k) ?? { ...NOTHING_RETURNED };
    out.set(k, { amount: prev.amount + r.amount, cost: prev.cost + r.cost });
  }
  return out;
}

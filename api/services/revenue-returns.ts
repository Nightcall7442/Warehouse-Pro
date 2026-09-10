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

   ── Про даты: одна база на весь продукт ─────────────────────────────────────

   Возврат уменьшает выручку ТОГО месяца, когда он проведён, а не того, когда
   продали. Иначе закрытый месяц менялся бы задним числом каждый раз, когда
   магазин что-то возвращает. Это обычная встречная запись, и по ней период
   сходится сам с собой.

   База обязана быть ОДНА на весь продукт, и раньше её не было. Прибыль
   вычитала возвраты по дате возврата, комиссия агента и выручка в KPI — по
   дате ЗАКАЗА, а доля возвратов в той же карточке KPI — снова по дате
   возврата. Три экрана про одного человека за один месяц давали три разных
   ответа, и балл KPI считался с одного из них, а премия — с другого.

   Хуже того, у всех этих запросов не было отбора по статусу заказа. Возврат
   вычитался и тогда, когда заказ потом отменили, — а отменённый заказ и так
   выпал из выручки целиком. Те же деньги вычитались дважды: у агента с одной
   отменой месяц уходил в ноль на ровном месте.

   Поэтому отбор здесь один и на всех: по дате ПРОВЕДЕНИЯ и только против
   заказов, которые сами считаются выручкой (revenueOrderConditions).

   ── Долг — это другой вопрос ────────────────────────────────────────────────

   Здесь считают «сколько вернулось ЗА ПЕРИОД». Долгу нужно «сколько вернулось
   ПО ЭТОМУ ЗАКАЗУ», без периода вовсе, и это правило живёт в
   services/shop-debt.ts. Смешивать их нельзя: у долга нет отчётного месяца, а
   у выручки нет отдельного заказа.

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
  /**
   * Сколько документов возврата.
   *
   * Нужен доле возвратов в KPI. Считался отдельным запросом с ДРУГИМ отбором —
   * по дате самого возврата и по `returns.agentId`, тогда как сумма в той же
   * карточке бралась по дате заказа и по `orders.agentId`. Числитель и
   * знаменатель одной дроби жили в разных периодах и относились к разным
   * людям.
   */
  count: number;
}

export const NOTHING_RETURNED: ReturnedValue = { amount: 0, cost: 0, count: 0 };

/**
 * Один документ возврата.
 *
 * Наследовать ReturnedValue было бы удобнее на вид, но неверно по смыслу: там
 * есть `count` — сколько документов сложено, — а в одном документе считать
 * нечего. Складывают строки функции ниже, и только они знают счёт.
 */
export interface ReturnRow {
  /** Месяц проведения, «ГГГГ-ММ» — для месячного графика. */
  month: string;
  /** Способ оплаты ЗАКАЗА — для разбивки «чем платят». */
  paymentMethod: string;
  agentId: number | null;
  /** Сумма продажи, вернувшаяся магазину. */
  amount: number;
  /** Себестоимость вернувшегося товара. */
  cost: number;
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
    .leftJoin(products, and(eq(products.id, returnItems.productId), eq(products.tenantId, tenantId)))
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

const plus = (a: ReturnedValue, b: ReturnedValue): ReturnedValue => ({
  amount: a.amount + b.amount,
  cost:   a.cost + b.cost,
  count:  a.count + b.count,
});

const ONE = (r: ReturnRow): ReturnedValue => ({ amount: r.amount, cost: r.cost, count: 1 });

/** Сложить строки в одну величину. */
export function totalReturned(rows: ReturnRow[]): ReturnedValue {
  return rows.reduce<ReturnedValue>((acc, r) => plus(acc, ONE(r)), { ...NOTHING_RETURNED });
}

/** Разложить строки по ключу: месяц, способ оплаты — что понадобится. */
export function groupReturned(
  rows: ReturnRow[], key: (r: ReturnRow) => string,
): Map<string, ReturnedValue> {
  const out = new Map<string, ReturnedValue>();
  for (const r of rows) {
    const k = key(r);
    out.set(k, plus(out.get(k) ?? NOTHING_RETURNED, ONE(r)));
  }
  return out;
}

/**
 * Разложить по агенту, ЧЬЯ ПРОДАЖА вернулась.
 *
 * Агент берётся из заказа, а не из документа возврата. Это разные люди:
 * `returns.agentId` — кто ОФОРМИЛ возврат, им может быть оператор или другой
 * агент, оказавшийся в точке. Комиссия и выручка уменьшаются у того, чью
 * продажу отменили, иначе один человек теряет деньги за чужую работу, а другой
 * их сохраняет.
 *
 * Возврат без заказа сюда не попадает вовсе: `returnsInPeriod` соединяет с
 * заказом внутренним соединением — такому возврату нечего уменьшать в выручке,
 * он живёт только в долге магазина.
 */
export function returnedByAgent(rows: ReturnRow[]): Map<number, ReturnedValue> {
  const out = new Map<number, ReturnedValue>();
  for (const r of rows) {
    if (r.agentId == null) continue;
    out.set(r.agentId, plus(out.get(r.agentId) ?? NOTHING_RETURNED, ONE(r)));
  }
  return out;
}

/** Что вернулось у одного агента — ноль, если ничего. */
export function returnedOf(byAgent: Map<number, ReturnedValue>, agentId: number): ReturnedValue {
  return byAgent.get(agentId) ?? NOTHING_RETURNED;
}

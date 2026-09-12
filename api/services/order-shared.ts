import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { applyStockEffect, releaseStock, reserveStock, shipStock } from "./stock-ledger";
import { alias } from "drizzle-orm/mysql-core";
import { orders, orderItems, warehouseStock, users, products, warehouses, payments, debtReminders, orderAdjustments, returns, returnItems } from "@db/schema";
import { recalcShopDebt } from "./shop-debt";
import { ORDER_STATUS_LABELS, holdsStock, deductsStock } from "../lib/order-status";
import { FIELD_EDITABLE_ORDER_STATUSES } from "@contracts/constants";
import { NotificationService } from "./NotificationService";
import { logger } from "../lib/logger";
import { badRequest } from "../lib/errors";
import { TRPCError } from "@trpc/server";
import { isDuplicateOf } from "../lib/db-errors";

/*
  Общее для служб заказа: типы, права, доступ, склад-дельта, следы в
  журнале, платёж и доставка по частям. Разнесено из одного файла на
  2 800 строк: order-read / order-create / order-status / order-items /
  order-settlement, а order.ts — только фасад OrderService.
*/

/** Second reference to `users` for courier joins alongside the agent join. */
export const couriers = alias(users, "couriers");

/**
 * Запрос на доставку обязан перечислять ВСЕ позиции заказа.
 *
 * Вынесено отдельной функцией, чтобы это правило можно было проверить само по
 * себе. Внутри applyPartialDelivery оно окружено блокировкой строки, сырым SQL
 * по остаткам и пересчётом долга — проверять его там значит проверять
 * поддельную базу, а не правило.
 *
 * Почему правило именно такое. Непереданная позиция исчезала дважды. Из денег:
 * сумма заказа пересобирается из присланных строк и записывается в
 * orders.total, поэтому заказ из двух позиций по 10 000, проведённый по одной,
 * становился заказом на 8 000 — магазин недоплачивал 10 000, и пересчёт долга
 * честно повторял эту цифру. Из склада: резерв освобождается только по
 * присланным позициям, а заказ получает статус delivered, после которого ни
 * отмена, ни удаление к нему уже неприменимы — товар оставался заперт навсегда.
 *
 * Додумать пропущенную позицию нельзя: «не указана» одинаково читается и как
 * «доставлена полностью», и как «полностью возвращена», а это противоположные
 * проводки и по деньгам, и по остаткам. Поэтому отказ с объяснением.
 *
 * Обычный клиент под правило уже подходит: окно завершения заказа в вебе
 * строит список из всех позиций, а курьерское приложение сюда не обращается —
 * у него свой путь через courier.completeDelivery.
 */
export function assertDeliveryCoversAllLines(
  orderLineIds: number[],
  items: Array<{ itemId: number }>,
): void {
  const sent = new Set<number>();
  for (const item of items) {
    if (sent.has(item.itemId)) {
      throw badRequest(`Позиция заказа #${item.itemId} передана в запросе дважды`);
    }
    sent.add(item.itemId);
  }

  // Чужой идентификатор ловится здесь, а не в цикле обработки: там он всплыл
  // бы уже после того, как часть позиций записана, и откат зависел бы от
  // транзакции. Отказать до первой записи дешевле и понятнее.
  const known = new Set(orderLineIds);
  const foreign = [...sent].filter(id => !known.has(id));
  if (foreign.length > 0) {
    throw badRequest(`Позиция заказа #${foreign[0]} не относится к этому заказу`);
  }

  const missing = orderLineIds.filter(id => !sent.has(id));
  if (missing.length > 0) {
    throw badRequest(
      `В доставке указаны не все позиции заказа: не хватает ${missing.length} из ${orderLineIds.length}. ` +
      `Укажите по каждой позиции, сколько доставлено — в том числе по тем, что доставлены полностью.`,
    );
  }
}

export type Db = ReturnType<typeof import("../queries/connection").getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Every stock movement in an order's lifecycle must target the same warehouse.
 * The order row does not record one, so the default warehouse is the single
 * source of truth: reservation on create, release on cancel/delete, deduction on
 * completion. An explicit non-default warehouseId is rejected rather than
 * silently reserved in one warehouse and released from another.
 */
/**
 * Схлопнуть повторяющиеся товары в одну строку.
 *
 * Клиент вправе прислать один товар дважды — так устроены и корзина, и офлайн-
 * очередь, где строки накапливаются по мере добавления. Ошибкой это не
 * является, и отказывать незачем: два ряда по 60 значат 120.
 *
 * А вот дальше по коду это уже ошибка. Резерв склада собирается одним UPDATE с
 * `CASE WHEN product_id = ...`, и MySQL берёт первый совпавший WHEN: в
 * order_items ложилось 120 единиц, а в reserved уходило 60. Проверка достатка
 * пропускала обе строки, потому что сверяла каждую с одним и тем же available.
 * Результат — заказ на товар, которого нет, и завышенный остаток, который
 * следующий заказ тоже продаст.
 *
 * Порядок сохраняется по первому появлению товара: агент видит позиции в том
 * порядке, в каком складывал их в корзину.
 */
export function mergeDuplicateItems<T extends { productId: number; quantity: string }>(items: T[]): T[] {
  const byProduct = new Map<number, T>();
  for (const item of items) {
    const seen = byProduct.get(item.productId);
    if (!seen) {
      byProduct.set(item.productId, { ...item });
      continue;
    }
    seen.quantity = String(Number(seen.quantity) + Number(item.quantity));
  }
  return [...byProduct.values()];
}

export async function resolveOrderWarehouse(tx: Tx, tenantId: number, requested?: number): Promise<number> {
  const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  const whId = defaultWh?.id;
  if (!whId) throw new Error("Склад по умолчанию не найден");
  if (requested !== undefined && requested !== whId) {
    throw new Error("Заказ можно оформить только со склада по умолчанию");
  }
  return whId;
}

/**
 * Anything below that changes what a shop owes — a status move, a payment, an
 * edit to an order's lines — finishes by calling this. It re-derives the
 * balance from the orders and payments themselves rather than nudging it by a
 * delta, so callers never have to reason about what the balance was before
 * their change, and can't leave it half-adjusted. See services/shop-debt.ts.
 */
export async function settleShopDebt(tx: Tx, tenantId: number, shopId: number): Promise<void> {
  await recalcShopDebt(tx, tenantId, shopId);
}

/** Status that releases stock (goods returned to warehouse). */
export function releasesStock(status: string): boolean {
  return status === "cancelled" || status === "returned";
}

/**
 * Следующий порядковый номер заказа для организации: «№149», «№150», …
 *
 * Считается внутри транзакции создания, чтобы не разъезжаться с одновременными
 * вставками; окончательную защиту от совпадения даёт уникальный индекс
 * uq_order_number_tenant, а вызывающий на его ошибку берёт следующий номер.
 *
 * Отсчёт продолжает уже существующие заказы, а не начинается с единицы: берётся
 * большее из общего числа заказов организации и максимума среди выданных
 * №-номеров. Первое нужно, чтобы у бизнеса со ста сорока восемью старыми
 * заказами (их номера — куски UUID вида ORD-B650EBBC369B) следующий получил
 * №149, а не №1. Второе — чтобы после удаления заказов номера не поехали назад
 * и не столкнулись с уже выданными.
 */
export async function nextOrderNumber(tx: Tx, tenantId: number): Promise<string> {
  const [row] = await tx.select({
    total: sql<number>`COUNT(*)`,
    maxNumbered: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${orders.orderNumber}, 2) AS UNSIGNED)), 0)`,
  })
    .from(orders)
    .where(eq(orders.tenantId, tenantId));

  const total = Number(row?.total ?? 0);
  const maxNumbered = Number(row?.maxNumbered ?? 0);
  return `№${Math.max(total, maxNumbered) + 1}`;
}

/**
 * Сколько по каждому товару уже возвращено ПРОВЕДЁННЫМИ возвратами по заказу.
 *
 * Только completed: заявленный или отклонённый возврат товара не двигал, и
 * учитывать его — значит вычесть дважды.
 */
export async function returnedQuantitiesByProduct(
  tx: Tx, tenantId: number, orderId: number,
): Promise<Map<number, number>> {
  const byProduct = new Map<number, number>();
  const completedReturns = await tx.select({ id: returns.id })
    .from(returns)
    .where(and(
      eq(returns.orderId, orderId),
      eq(returns.tenantId, tenantId),
      eq(returns.status, "completed"),
    ));
  if (completedReturns.length === 0) return byProduct;

  const returnedRows = await tx.select({
    productId: returnItems.productId,
    quantity: returnItems.quantity,
  })
    .from(returnItems)
    .where(inArray(returnItems.returnId, completedReturns.map(r => Number(r.id))));

  for (const r of returnedRows) {
    const pid = Number(r.productId);
    byProduct.set(pid, (byProduct.get(pid) ?? 0) + Number(r.quantity));
  }
  return byProduct;
}

/**
 * Сколько единиц строка заказа ДЕЙСТВИТЕЛЬНО держит на складе сейчас.
 *
 * Это не orderItems.quantity. Строка, прошедшая частичную доставку, физически
 * подвинула только deliveredQuantity — недовезённый остаток уже вернулся в
 * available, а не ждёт отгрузки. И проведённый возврат тоже уже вернул своё.
 *
 * Разницу считал только updateStatus, а cancel(), delete() и restore() брали
 * сырое quantity — то есть отдавали назад БОЛЬШЕ, чем занимали. Ни в cancel, ни
 * в delete не было и клампа GREATEST, поэтому reserved просто уходил в минус:
 * молча аннулировался резерв ДРУГИХ открытых заказов, а available становился
 * больше физического остатка, и система разрешала продать несуществующий товар.
 * Инвариант current = available + reserved при этом сохранялся, так что ни одна
 * проверка целостности этого не замечала.
 *
 * Проверено на движке-двойнике: заказ на 10, возврат на 4, откат в new —
 * cancel() освобождал 10 вместо 6 и оставлял reserved = -4, available = 104
 * при current = 100.
 */
export function heldQuantity(
  item: { productId: number; quantity: unknown; deliveredQuantity?: unknown },
  returnedByProduct: Map<number, number>,
): number {
  const base = item.deliveredQuantity != null
    ? Number(item.deliveredQuantity)
    : Number(item.quantity);
  const alreadyReturned = returnedByProduct.get(item.productId) ?? 0;
  return Math.max(0, base - alreadyReturned);
}

/**
 * What one unit of an order line has done to warehouse stock by the time the
 * order sits in `status`, counted from "the order does not exist":
 *
 *   open (new/processing/shipped/pending) — held for the order: available−1, reserved+1
 *   delivered                             — gone from the building: available−1, current−1
 *   cancelled / returned                  — everything given back: no effect
 *
 * Moving between statuses applies the *difference* of the two effects, so every
 * direction works out on its own — including going backwards. Rolling a
 * delivered order back to "new" yields current+1, reserved+1: the goods return
 * to the shelf and are held for the order again.
 */
export function stockEffect(status: string): { current: number; reserved: number; available: number } {
  if (deductsStock(status)) return { current: -1, reserved: 0, available: -1 };
  if (releasesStock(status)) return { current: 0, reserved: 0, available: 0 };
  return { current: 0, reserved: 1, available: -1 };
}

/**
 * How an order's items currently affect warehouse stock, which decides what an
 * edit has to move:
 *  - "reserve"  — units are held for the order (available↓, reserved↑)
 *  - "consumed" — units already left the building (current_stock↓)
 *  - "none"     — order gave everything back, its items own no stock
 */
export function stockModeFor(status: string): "reserve" | "consumed" | "none" {
  if (deductsStock(status)) return "consumed";
  if (holdsStock(status)) return "reserve";
  return "none";
}

/**
 * Имена товаров для отказа — вместо номеров строк в базе.
 *
 * «Недостаточно товара на складе: 417, 902» кладовщику не говорит ничего:
 * номер товара не написан ни на коробке, ни в накладной, и, чтобы понять,
 * чего не хватило, приходилось лезть в базу. Оформление заказа имена уже
 * называло — остальные четыре отказа остались с номерами.
 *
 * Запрос уходит только на пути отказа, то есть в редком случае.
 */
export async function productNames(tx: Tx | Db, tenantId: number, productIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (productIds.length === 0) return map;
  try {
    const rows = await tx.select({ id: products.id, name: products.name }).from(products)
      .where(and(
        sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
        eq(products.tenantId, tenantId),
      ));
    for (const r of rows) map.set(r.id, r.name);
  } catch {
    /* имя — украшение сообщения, из-за него отказ не должен превратиться в сбой */
  }
  return map;
}

/** Имя товара, а если его не нашли — хотя бы номер. */
export async function productLabel(tx: Tx | Db, tenantId: number, productId: number): Promise<string> {
  return (await productNames(tx, tenantId, [productId])).get(productId) ?? `#${productId}`;
}

/**
 * Moves warehouse stock to match a change of `delta` units on an order line,
 * according to what that order's status already did to stock. Positive delta
 * means the order now wants more units than before.
 */
export async function applyStockDelta(
  tx: Tx, tenantId: number, warehouseId: number, productId: number,
  delta: number, mode: "reserve" | "consumed" | "none",
): Promise<void> {
  if (delta === 0 || mode === "none") return;

  if (mode === "reserve") {
    const [stock] = await tx.select({ available: warehouseStock.available })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId)))
      .limit(1);

    // Нет строки склада — писать некуда, и UPDATE ниже не задел бы ни одной.
    // При уменьшении позиции это проходило незамеченным: состав заказа менялся,
    // склад — нет.
    if (!stock) {
      throw new Error(`Товар «${await productLabel(tx, tenantId, productId)}» ещё не заводился на этом складе`);
    }
    if (delta > 0 && Number(stock.available) < delta) {
      throw new Error(`Недостаточно товара: «${await productLabel(tx, tenantId, productId)}» — доступно ${Number(stock.available)}, нужно ещё ${delta}`);
    }

    // Ограничение снизу применяется к ОБЕИМ колонкам, иначе инвариант
    // current_stock = available + reserved разъезжается молча.
    //
    // Было: `reserved = GREATEST(0, reserved + delta), available = available - delta`.
    // Пока reserved + delta >= 0, всё сходится. Но как только ограничение
    // срабатывает — а срабатывает оно, когда позицию уменьшают на больше, чем
    // реально зарезервировано, — reserved останавливается на нуле, а available
    // прибавляет всю величину delta. Остаток становится больше физического, и
    // система разрешает продать то, чего нет. Ошибки при этом не будет: строка
    // выглядит правдоподобной, а инвариант не проверяет никто.
    //
    /*
      Знак дельты решает, какая это операция: положительная откладывает,
      отрицательная снимает. Ветвление здесь, а не в двери, — она отказывается
      принимать знак нарочно: иначе один и тот же вызов означал бы
      противоположные вещи, и знаковая дельта, попавшая туда по ошибке, тихо
      выполнила бы операцию наоборот.

      Прежняя запись `available -= GREATEST(0, reserved + delta) - reserved`
      равна LEAST(|delta|, reserved) при отрицательной дельте и просто |delta|
      при положительной — то есть ровно тому, что делают reserveStock и
      releaseStock. Свободный остаток дверь выводит сама.
    */
    const items = [{ productId, quantity: Math.abs(delta) }];
    if (delta >= 0) await reserveStock(tx, { tenantId, warehouseId, items });
    else await releaseStock(tx, { tenantId, warehouseId, items });
    return;
  }

  // "consumed" — the goods are already gone; more units means less on hand.
  if (delta > 0) {
    const [stock] = await tx.select({ currentStock: warehouseStock.currentStock })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId)))
      .limit(1);
    if (Number(stock?.currentStock ?? 0) < delta) {
      throw new Error(`Недостаточно товара: «${await productLabel(tx, tenantId, productId)}» — остаток ${Number(stock?.currentStock ?? 0)}, нужно ещё ${delta}`);
    }
  }
  // The units are leaving (or coming back to) the warehouse outright: this
  // order's status already released its reservation, so they move between
  // "on hand" and "gone" — never through `reserved`. Both counters have to
  // move together, or current_stock stops equalling available + reserved.
  /*
    Заказ уже отгружен, его резерв давно снят: единицы идут прямо между «на
    складе» и «ушло», минуя reserved. Направление задаёт знак дельты, поэтому
    ветвление здесь, а не в двери: она отказывается принимать знак нарочно —
    иначе один и тот же вызов означал бы противоположные вещи.
  */
  await applyStockEffect(tx, {
    tenantId, warehouseId,
    items: [{ productId, quantity: Math.abs(delta) }],
    shift: { onHand: delta > 0 ? -1 : 1, held: 0 },
    reason: "order_edit",
    notes: "Корректировка состава выполненного заказа",
  });
}

/**
 * Records a partial (or full) payment against an already-delivered order.
 * Runs on the caller's transaction so it can be composed with
 * applyPartialDelivery into one atomic operation (see recordDeliveryAndPayment).
 *
 * The order's own status always becomes "delivered" here — the goods left the
 * warehouse, full stop. Payment completeness (partial vs. paid) and any
 * remaining debt are tracked on the payments row and shops.debt, not on the
 * order status, so a partly-paid delivery still counts toward delivered/revenue
 * KPIs (which filter status IN ('delivered','completed')).
 */
/**
 * Права на чужой заказ. Три правила, намеренно рядом.
 *
 * ── Почему рядом ────────────────────────────────────────────────────────────
 *
 * «Кого пускать в список» лежало безымянным массивом внутри OrderService.list
 * и getById, а «кому можно провести заказ» — отдельной константой сотней строк
 * выше. Списки разошлись на супервайзера, и никто этого не заметил, потому что
 * увидеть расхождение можно было, только держа оба места перед глазами.
 *
 * Обошлось это дорого. Супервайзер видел все заказы, открывал окно завершения —
 * сумма показывалась верно, ЧТЕНИЕ ему разрешено, — вводил оплату и получал
 * «Заказ не найден» про заказ, который был у него перед глазами. Со стороны это
 * читается как поломка данных, и искать шли не там. В боевой базе с 28 августа
 * 2026 не записалось ни одной частичной оплаты.
 *
 * Расхождение сохранено — так решил владелец, — но теперь оно НАМЕРЕННОЕ и
 * видно с одного экрана. И отказ объясняет причину: см. orderAccessError ниже.
 */

/** Кто видит ЛЮБОЙ заказ организации: список, карточка, окно завершения. */
export const ORDER_VIEWERS = ["ceo", "operator", "supervisor", "superadmin"];

/**
 * Кто вправе ПРОВЕСТИ любой заказ: принять оплату, оформить доставку.
 *
 * Уже, чем ORDER_VIEWERS: супервайзера здесь нет. Он смотрит за работой, но
 * деньги и склад по чужим заказам не двигает — это делают оператор,
 * руководитель или сам автор заказа.
 *
 * Разница с видимостью не случайна, поэтому отказ обязан её ОБЪЯСНЯТЬ: человек
 * видит заказ на экране, и молчаливое «не найден» отправляет его искать
 * несуществующую поломку.
 */
export const ORDER_SETTLERS = ["ceo", "operator", "superadmin"];

/**
 * Кто вправе ОТМЕНИТЬ любой заказ.
 *
 * Тот же список, что у проводки: отменить заказ и провести по нему деньги —
 * операции одного веса. Правка состава и удаление закрыты ещё жёстче, на уровне
 * процедур (operatorQuery в api/order-router.ts).
 */
export const ORDER_CANCELLERS = ORDER_SETTLERS;

/** Видит ли эта роль чужие заказы. */
export function canSeeAnyOrder(role: string): boolean {
  return ORDER_VIEWERS.includes(role);
}

/** Может ли эта роль провести чужой заказ — оплата и доставка. */
export function canSettleAnyOrder(role: string): boolean {
  return ORDER_SETTLERS.includes(role);
}

/** Может ли эта роль отменить чужой заказ. */
export function canCancelAnyOrder(role: string): boolean {
  return ORDER_CANCELLERS.includes(role);
}

/**
 * Условие «заказ принадлежит этому человеку», если роль не даёт чужих.
 *
 * ── Чего здесь не было ──────────────────────────────────────────────────────
 *
 * Три процедуры денежного пути — recordPartialPayment, recordPartialDelivery и
 * recordDeliveryAndPayment — объявлены на fieldSalesQuery, то есть доступны
 * агенту, мерчандайзеру и супервайзеру. А выборка заказа фильтровалась только
 * по id и организации: владелец не проверялся вовсе.
 *
 * Значит, любой из них, зная (или перебрав) номер заказа, мог провести чужой
 * заказ: списать остаток со склада, вписать приём наличных на всю сумму и
 * обнулить долг магазина — при том, что денег никто не приносил. Обратный ход
 * ещё хуже: доставка с нулевым количеством по всем позициям обрезает сумму
 * заказа до нуля и переводит его в «доставлен», после чего заказ уже не
 * отменить и не доставить — проверка статуса не пустит.
 *
 * Для мерчандайзера это вообще новая способность: собственных заказов у него
 * нет, поэтому любой заказ, который он проводит, — заведомо чужой.
 *
 * Условие возвращается массивом, чтобы попасть ВНУТРЬ того же
 * SELECT ... FOR UPDATE: проверка вне блокировки — это уже другая ошибка.
 */
/**
 * Почему заказ не дался: его нет — или он чужой.
 *
 * Раньше оба случая отвечали «Заказ не найден», потому что условие владельца
 * стоит ВНУТРИ выборки: не свой заказ просто не возвращается. Для человека,
 * который видит этот заказ в списке и держит его открытым на экране, такой
 * ответ не значит ничего — искать он идёт в данные, а дело в правах. Именно так
 * потерялось несколько дней на разборе жалобы тенанта.
 *
 * Ответ — TRPCError, а не голый Error: в проде errorFormatter подменяет текст
 * любой INTERNAL-ошибки на «Внутренняя ошибка сервера», и объяснение до
 * человека не доходит (api/middleware.ts).
 */
/**
 * Заказ виден этому человеку?
 *
 * Список и карточка заказа сужаются до своих через ownerScope, а всё, что
 * висит на заказе сбоку — оплаты, правки состава, комментарии, — читалось
 * по одному номеру заказа кем угодно из полевых. То есть агент, подставив
 * чужой номер, видел платежи по чужому магазину и мог оставить там
 * комментарий.
 *
 * Бросает то же самое, что и остальные пути: «оформил другой сотрудник»
 * либо «не найден», не выдавая существование чужого заказа больше, чем
 * нужно.
 */
export async function assertOrderVisible(
  db: Db, tenantId: number, orderId: number, actor: Actor, action = "Открыть",
): Promise<void> {
  const [own] = await db.select({ id: orders.id }).from(orders)
    .where(and(
      eq(orders.id, orderId),
      eq(orders.tenantId, tenantId),
      isNull(orders.deletedAt),
      ...ownerScope(actor),
    ))
    .limit(1);
  if (!own) throw await orderAccessError(db as unknown as Tx, tenantId, orderId, action);
}

/**
 * Статусы, в которых ПОЛЕВОЙ сотрудник ещё вправе править состав своего заказа.
 *
 * Заказ живёт так: оформили («new»), собрали («processing», «pending»),
 * отдали курьеру («shipped»), довезли («delivered»).
 *
 * Агенту открыто всё до отгрузки, и граница проходит именно здесь. «shipped»
 * значит, что курьер уже везёт КОНКРЕТНЫЙ набор коробок: допиши агент строку —
 * резерв вырастет, накладная разойдётся с тем, что в машине, и разбираться
 * будут в точке. «delivered» ещё жёстче: товар отдан, долг магазина посчитан, и
 * правка состава двигает и склад, и деньги задним числом — это решение офиса, а
 * не того, кто оформил заказ.
 *
 * Офиса (ORDER_SETTLERS) это не касается: там правку состава в поздних
 * состояниях делают осознанно и отвечают за неё.
 */
/* Список общий с экранами — см. @contracts/constants: сервер по нему
   отказывает, экран по нему решает, показывать ли кнопку. */
export const FIELD_EDITABLE_STATUSES = FIELD_EDITABLE_ORDER_STATUSES;

/**
 * Может ли ЭТОТ человек менять состав ЭТОГО заказа прямо сейчас.
 *
 * Отдельно от assertOrderVisible: та отвечает «чей заказ», а эта — «не поздно
 * ли». Оба отказа человек получает по-разному и чинит по-разному, поэтому и
 * тексты разные.
 */
export async function assertItemsEditableBy(
  db: Db, tenantId: number, orderId: number, actor: Actor,
): Promise<void> {
  if (canSettleAnyOrder(actor.role)) return;

  const [row] = await db.select({ status: orders.status }).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" });

  if (!(FIELD_EDITABLE_STATUSES as readonly string[]).includes(row.status)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      // Названо, ЧТО делать дальше: «нельзя» без выхода отправляет человека
      // звонить в офис и объяснять на словах.
      message: row.status === "shipped"
        ? "Заказ уже у курьера — состав менять нельзя. Позвоните оператору: он поправит или оформит возврат."
        : "Заказ уже закрыт — состав менять нельзя. Изменения по нему оформляются возвратом.",
    });
  }
}

export async function orderAccessError(
  tx: Tx, tenantId: number, orderId: number, action = "Провести",
): Promise<TRPCError> {
  const [exists] = await tx.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
    .limit(1);
  return exists
    ? new TRPCError({
        code: "FORBIDDEN",
        message: `Этот заказ оформил другой сотрудник. ${action} его может автор заказа, оператор или руководитель.`,
      })
    : new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" });
}

/**
 * От чьего имени смотрят заказы.
 *
 * Раньше это был необязательный opts: не передал — выборка не сужается.
 * Поведение удобное (внутренние вызовы им и пользуются), но забыть его на
 * пути от человека значит молча отдать чужие заказы, и компилятор об этом
 * не скажет ни слова — что и случилось с четырьмя процедурами вокруг
 * карточки заказа.
 *
 * Теперь довод обязателен, а «изнутри системы» называется словом. Смысл
 * прежний: SYSTEM_VIEW не сужает ничего, ровно как отсутствующий opts.
 */
export const SYSTEM_VIEW = "system-internal" as const;
export type OrderViewer = { userId: number; userRole: string } | typeof SYSTEM_VIEW;

/** Сужение выборки для зрителя: у системы и начальства — никакого. */
export function viewerScope(viewer: OrderViewer) {
  if (viewer === SYSTEM_VIEW) return [];
  return canSeeAnyOrder(viewer.userRole) ? [] : [eq(orders.agentId, viewer.userId)];
}

export function ownerScope(actor: Actor) {
  return canSettleAnyOrder(actor.role) ? [] : [eq(orders.agentId, actor.id)];
}

/** Кто выполняет операцию: идентификатор для записи авторства и роль для прав. */
export type Actor = { id: number; role: string };
/** Кто делает правку — для журнала действий. Необязателен: крон и вебхуки без человека. */
export type AuditActor = { id: number; role: string; name?: string };

/**
 * След правки заказа, меняющей выручку или долг.
 *
 * Удаление, восстановление, правка скидки и способа оплаты, переписывание
 * строк — операции, которые убирают доставленный долговой заказ из
 * дебиторки или меняют его сумму, — не оставляли ни записи в журнале, ни
 * автора. Долг магазина можно было уменьшить или стереть без ответа «кто и
 * когда». Пишется ПОСЛЕ транзакции: журнал не должен уметь отменить правку.
 */
export async function traceOrderChange(
  db: Db, tenantId: number, orderId: number, action: string, actor: AuditActor | undefined, meta: Record<string, unknown>,
): Promise<void> {
  const { recordAudit } = await import("./audit-log");
  await recordAudit(db, {
    tenantId, actorId: actor?.id, actorName: actor?.name, action, targetType: "order", targetId: orderId,
    meta: { ...meta, actorRole: actor?.role },
  });
}

/*
  След от того, кто уменьшил долг магазина.

  Долг гасится двумя путями: записали оплату или отменили долговый заказ.
  Оба пути открыты полевому агенту, и оба уменьшают то, что магазин должен, —
  а деньги при этом на руках у агента. Ни один из них раньше не оставлял
  следа: оплаты в журнал действий не писались вовсе, отмена — тем более, и
  офис узнавал об изменении долга только если сам заходил и сравнивал цифры.

  Теперь остаётся и запись в журнале, и уведомление операторам с
  руководителем. Запись — чтобы можно было спросить потом, уведомление —
  чтобы заметили сразу. Ни то, ни другое агент удалить не может: процедур
  удаления оплат и записей журнала в системе нет.

  Оба действия делаются «мимо» основной сделки и не должны её ронять: не
  записалось уведомление — заказ всё равно оформлен, деньги всё равно
  учтены. Поэтому ошибки здесь только логируются.
*/
export async function traceDebtChange(
  db: Db,
  tenantId: number,
  actor: Actor,
  entry: {
    action: "order.payment_recorded" | "order.cancelled";
    orderId: number;
    orderNumber: string;
    shopId: number;
    shopName: string;
    amount: number;
    remaining?: number;
    method?: string;
  },
): Promise<void> {
  const { recordAudit } = await import("./audit-log");
  await recordAudit(db, {
    tenantId,
    actorId: actor.id,
    action: entry.action,
    targetType: "order",
    targetId: entry.orderId,
    meta: {
      orderNumber: entry.orderNumber,
      shopId: entry.shopId,
      shopName: entry.shopName,
      amount: entry.amount,
      remaining: entry.remaining,
      method: entry.method,
      actorRole: actor.role,
    },
  });

  /*
    Уведомляем только о том, что сделал ПОЛЕВОЙ сотрудник. Оператор и
    руководитель и так сидят в этой системе — слать им уведомление о
    собственном действии значит приучить не читать уведомления вовсе.
  */
  if (canSettleAnyOrder(actor.role)) return;

  try {
    const office = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));
    if (office.length === 0) return;

    const money = entry.amount.toLocaleString("ru");
    const title = entry.action === "order.payment_recorded"
      ? `Агент собрал долг: ${money} сум`
      : `Агент отменил долговый заказ ${entry.orderNumber}`;
    const message = entry.action === "order.payment_recorded"
      ? `${entry.shopName} · заказ ${entry.orderNumber}` + (entry.remaining != null ? ` · остаток ${entry.remaining.toLocaleString("ru")} сум` : "")
      : `${entry.shopName} · долг ${money} сум списан отменой`;

    await NotificationService.createBulk(db, {
      tenantId,
      userIds: office.map(o => o.id),
      type: "order",
      title,
      message,
      link: `/orders/${entry.orderId}`,
    });
  } catch (err) {
    logger.error("Не удалось уведомить офис об изменении долга", { orderId: entry.orderId, error: String(err) });
  }
}
/** Тип платежа по заказу — один для всех трёх денежных процедур. */
export type OrderPaymentInput = {
  orderId: number; paidAmount: string; method: "cash" | "card" | "transfer";
  debtDueDate?: string; notes?: string;
  /**
   * Ключ повтора. Клиент делает его один раз при открытии окна оплаты и шлёт
   * тот же при каждой попытке. Без ключа обрыв связи после commit давал два
   * платежа: агент вносит 400 из 1 000, ответ теряется, вводит снова — в базе
   * 800, долг занижен на 400, а наличных на 400 меньше, чем учтено. Ловится
   * только ручной сверкой кассы. Уникальный индекс uq_payments_idempotency
   * стоял в базе с самого начала — им пользовался shop.addPayment, а этот
   * путь нет.
   */
  idempotencyKey?: string;
};

/** Деньги сравниваются в тийинах, а не в double: см. проверку остатка ниже. */
export const tiyin = (x: number) => Math.round(x * 100);

export async function applyPartialPayment(
  tx: Tx, tenantId: number, actor: Actor,
  input: OrderPaymentInput,
): Promise<void> {
  const userId = actor.id;
  const paid = Number(input.paidAmount);
  if (paid <= 0) throw new Error("Сумма оплаты должна быть положительной");

  // Locked for the rest of this function: a second, concurrent call for the
  // same order (a network retry, a double-tap, two devices) queues on this
  // lock rather than reading the same pre-payment total this one did, which
  // is what let two simultaneous payments each think the order was unpaid
  // and jointly overpay it.
  const [order] = await tx.select({
    id: orders.id, status: orders.status, total: orders.total,
    shopId: orders.shopId, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...ownerScope(actor)))
    .for("update")
    .limit(1);
  if (!order) throw await orderAccessError(tx, tenantId, input.orderId);
  // A cancelled/returned order has already given its stock and any charge
  // back; a stray or retried payment call must not resurrect it as delivered.
  if (order.status === "cancelled" || order.status === "returned") {
    throw new Error(`Нельзя принять оплату по заказу в статусе «${ORDER_STATUS_LABELS[order.status]}»`);
  }

  const total = Number(order.total);

  // Sum of payments already recorded for this order, before this one — needed
  // to compute the true remaining balance across multiple partial payments,
  // and to know how much of it is already reflected in shops.debt (see below).
  // Read only after the lock above, so it reflects any payment a just-committed
  // concurrent call already inserted.
  const [{ priorPaid: priorPaidRaw }] = await tx.select({
    priorPaid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
  }).from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
  const priorPaid = Number(priorPaidRaw);

  // В целых тийинах. В double точный остаток отвергался примерно в 11 %
  // случаев с копейками (любой заказ с процентной скидкой): 0.1 + 0.2 > 0.3.
  // Оператор закрывал пачку «все оплачены» — часть заказов уходила
  // доставленными без записи оплаты.
  if (tiyin(priorPaid) + tiyin(paid) > tiyin(total)) throw new Error("Сумма оплаты не может превышать сумму заказа");

  const debt = total - priorPaid - paid;

  // Record payment
  await tx.insert(payments).values({
    tenantId,
    shopId: order.shopId,
    orderId: order.id,
    amount: paid.toFixed(2),
    type: "payment",
    paymentMethod: input.method,
    status: debt > 0 ? "partially_paid" : "paid",
    totalOrderAmount: total.toFixed(2),
    paidAmount: paid.toFixed(2),
    debtAmount: Math.max(0, debt).toFixed(2),
    // `debt_due_date` is a `date` column, so drizzle types it as Date, but the
    // due date arrives (and is compared in SQL) as a "YYYY-MM-DD" string —
    // handing the driver a Date instead would shift the stored day by the
    // server's UTC offset. Same reasoning as services/kpi.ts.
    debtDueDate: input.debtDueDate != null ? sql`${input.debtDueDate}` : null,
    paidAt: new Date(),
    notes: input.notes ?? null,
    createdBy: userId,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  // Create debt reminder if there's remaining debt and a due date
  if (debt > 0 && input.debtDueDate) {
    await tx.insert(debtReminders).values({
      tenantId,
      shopId: order.shopId,
      orderId: order.id,
      amount: debt.toFixed(2),
      dueDate: sql`${input.debtDueDate}`,
      status: "pending",
    });
  }

  // Update order status — goods were delivered; remaining debt lives on
  // payments.status / shops.debt, not on this status field.
  //
  // Отметка доставки — вместе со статусом: см. updateStatus о том, почему без
  // неё показатели курьера меряли экран, а не работу.
  await tx.update(orders).set({
    status: "delivered",
    deliveryStatus: "delivered",
    deliveredAt: new Date(),
  }).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId)));

  // Log adjustment
  await tx.insert(orderAdjustments).values({
    tenantId,
    orderId: order.id,
    adjustedBy: userId,
    type: "partial_payment",
    oldValue: { status: order.status, total: order.total },
    newValue: { status: "delivered", paid: paid.toFixed(2), debt: Math.max(0, debt).toFixed(2) },
    reason: input.notes ?? null,
  });

  // The payment row and the "delivered" status are both written now, so the
  // balance can be re-derived from them.
  await recalcShopDebt(tx, tenantId, order.shopId);
}

/**
 * Adjusts an order's items/total down to what was actually delivered and
 * returns the undelivered quantity to warehouse stock. Runs on the caller's
 * transaction so it can be composed with applyPartialPayment (see
 * recordDeliveryAndPayment).
 */
export async function applyPartialDelivery(
  tx: Tx, tenantId: number, actor: Actor,
  input: { orderId: number; items: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>; photos?: string[] },
): Promise<void> {
  const userId = actor.id;
  if (input.items.length === 0) throw badRequest("Выберите хотя бы один товар");

  // Locked for the rest of this function — see the identical comment in
  // applyPartialPayment for why a concurrent call must queue here rather than
  // read the same pre-delivery state this one did.
  const [order] = await tx.select({
    id: orders.id, status: orders.status, total: orders.total,
    subtotal: orders.subtotal, discount: orders.discount,
    shopId: orders.shopId, orderNumber: orders.orderNumber,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...ownerScope(actor)))
    .for("update")
    .limit(1);
  if (!order) throw await orderAccessError(tx, tenantId, input.orderId);
  // A cancelled/returned order already released its stock; recording a
  // delivery against it here would consume stock a second time for goods
  // that were already given back.
  //
  // delivered — зеркало той же дыры со стороны курьера. Курьерский
  // completeDelivery ставит orders.status='delivered', и если после этого
  // оператор проведёт частичную доставку по тому же заказу (например, нажмёт
  // «Выполнен» на устаревшей строке списка — она закеширована, а проверка
  // на клиенте сравнивает со СТАРЫМ статусом), остаток спишется второй раз.
  // Обе операции при этом возвращают успех, и оператор ничего не замечает.
  if (order.status === "cancelled" || order.status === "returned" || order.status === "delivered") {
    throw badRequest(`Нельзя оформить доставку по заказу в статусе «${ORDER_STATUS_LABELS[order.status]}»`);
  }

  // Доставка закрывает заказ целиком, поэтому в запросе обязаны быть ВСЕ его
  // позиции — включая доставленные полностью.
  //
  // Без этого условия непереданная позиция исчезала дважды. Из денег: ниже
  // сумма заказа пересобирается из присланных строк и записывается в
  // orders.total, так что заказ из двух позиций по 10 000, проведённый по
  // одной, становился заказом на 8 000 — магазин недоплачивал 10 000, и
  // recalcShopDebt честно повторял эту цифру в долге. Из склада: резерв
  // освобождается только внутри цикла по присланным позициям, а заказ при этом
  // получает статус delivered, после которого ни отмена, ни удаление к нему
  // уже неприменимы — товар оставался заперт в reserved навсегда.
  //
  // Молчаливо додумать пропущенную позицию нельзя: «не указана» одинаково
  // читается и как «доставлена полностью», и как «полностью возвращена», а это
  // противоположные проводки и по деньгам, и по остаткам. Поэтому отказ с
  // объяснением, а не догадка.
  //
  // Обычный клиент под это условие уже подходит: окно завершения заказа в вебе
  // строит список из всех позиций. Курьерское приложение сюда не обращается —
  // у него свой путь через courier.completeDelivery.
  const orderLines = await tx.select({ id: orderItems.id }).from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  assertDeliveryCoversAllLines(orderLines.map(l => l.id), input.items);

  let newSubtotal = 0;
  const oldItems: Array<{ id: number; quantity: string; subtotal: string }> = [];
  const newItems: Array<{ id: number; quantity: string; subtotal: string }> = [];

  const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);

  for (const item of input.items) {
    const [orderItem] = await tx.select({
      id: orderItems.id, quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
      productId: orderItems.productId, deliveredQuantity: orderItems.deliveredQuantity,
    }).from(orderItems)
      .where(and(eq(orderItems.id, item.itemId), eq(orderItems.orderId, order.id)))
      .limit(1);
    if (!orderItem) throw badRequest(`Позиция заказа #${item.itemId} не найдена`);
    // Idempotency guard: this item has already gone through a partial-delivery
    // pass (deliveredQuantity was set). Re-running would return the same stock
    // to the warehouse and shave the same amount off shop debt a second time.
    if (orderItem.deliveredQuantity !== null) {
      throw badRequest(`«${await productLabel(tx, tenantId, orderItem.productId)}» уже проведён частичной доставкой по этому заказу`);
    }

    const orderedQty = Number(orderItem.quantity);
    const deliveredQty = item.deliveredQuantity;
    if (deliveredQty > orderedQty) throw badRequest(`Нельзя передать больше заказанного (${orderedQty})`);

    const returnedQty = orderedQty - deliveredQty;
    const unitPrice = Number(orderItem.unitPrice);
    const newLineSubtotal = unitPrice * deliveredQty;
    newSubtotal += newLineSubtotal;

    oldItems.push({ id: orderItem.id, quantity: orderItem.quantity, subtotal: orderItem.subtotal });

    // Update order item
    await tx.update(orderItems).set({
      deliveredQuantity: deliveredQty.toFixed(2),
      returnReason: item.returnReason ?? null,
      subtotal: newLineSubtotal.toFixed(2),
    }).where(eq(orderItems.id, orderItem.id));

    newItems.push({ id: orderItem.id, quantity: deliveredQty.toFixed(2), subtotal: newLineSubtotal.toFixed(2) });

    // Release the full reservation held since order creation: the delivered
    // portion is now consumed (current_stock drops, matching the "open →
    // delivered" stockEffect delta — this used to only run when something
    // was returned, so a fully-delivered order never released its reservation
    // or decremented current_stock at all); the undelivered portion goes back
    // to available (matching "open → returned"). Either way `reserved` drops
    // by the full original order quantity.
    if (defaultWh) {
      /*
        С резерва снимается всё, что держал заказ, со склада уходит только
        увезённое, а невывезенная часть возвращается в свободный остаток —
        дверь выводит его от новых значений, и подбирать выражение
        `available − увезено + LEAST(отложено, reserved)` больше не нужно.

        Движение пишет она же и только на увезённое: невывезенное никуда не
        ехало, и запись о нём развела бы журнал с полкой. Почему часть
        вернулась, видно на строке заказа (deliveredQuantity / returnReason)
        и в журнале правок.
      */
      await shipStock(tx, {
        tenantId, warehouseId: defaultWh.id,
        items: [{
          productId: orderItem.productId,
          orderedQuantity: orderedQty,
          deliveredQuantity: deliveredQty,
        }],
        reason: "order_delivery",
        referenceId: order.id,
        notes: returnedQty > 0
          ? `Доставлено по заказу ${order.orderNumber} (не доставлено ${returnedQty}: ${item.returnReason ?? "причина не указана"})`
          : `Доставлено по заказу ${order.orderNumber}`,
      });
    }
  }

  // Recalculate order totals. The discount was granted as a percentage of the
  // original sale, not a fixed sum, so it's rescaled to the smaller subtotal
  // the same way OrderService.updateItems does — subtracting the original
  // absolute discount unchanged could outweigh a subtotal that partial
  // delivery just shrank and drive the total negative.
  const originalSubtotal = Number(order.subtotal);
  const discountPct = originalSubtotal > 0 ? (Number(order.discount) / originalSubtotal) * 100 : 0;
  const newDiscount = newSubtotal * (discountPct / 100);
  const newTotal = Math.max(0, newSubtotal - newDiscount);

  // The order is delivered — what came back was already subtracted from its
  // lines and total, and the returned units went back to stock above. The
  // partial nature lives in order_items.deliveredQuantity and the adjustment
  // log, not in a separate status.
  await tx.update(orders).set({
    subtotal: newSubtotal.toFixed(2),
    discount: newDiscount.toFixed(2),
    total: newTotal.toFixed(2),
    status: "delivered",
    // Частичная доставка — тоже доставка: товар довезли, часть вернулась.
    deliveryStatus: "delivered",
    deliveredAt: new Date(),
  }).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId)));

  // Log adjustment
  await tx.insert(orderAdjustments).values({
    tenantId,
    orderId: order.id,
    adjustedBy: userId,
    type: "partial_delivery",
    oldValue: { total: order.total, items: oldItems },
    newValue: { total: newTotal.toFixed(2), items: newItems },
    reason: input.items.map(i => i.returnReason).filter(Boolean).join(", "),
    photos: input.photos ?? null,
  });

  // The order's new total and "delivered" status are written; re-derive.
  // (When composed with applyPartialPayment this runs twice — harmless,
  // since re-deriving is idempotent.)
  await recalcShopDebt(tx, tenantId, order.shopId);
}

/**
 * Дубликат именно по ключу идемпотентности, а не по номеру заказа.
 *
 * У orders два уникальных индекса, и оба дают один и тот же код ER_DUP_ENTRY:
 * uq_order_number_tenant (номер занят — надо взять следующий и повторить) и
 * uq_orders_idempotency (заказ уже создан — надо вернуть существующий). Имя
 * индекса драйвер кладёт в sqlMessage: «Duplicate entry '…' for key
 * 'orders.uq_orders_idempotency'».
 *
 * Если имени в сообщении нет (другой драйвер, урезанный текст ошибки),
 * считаем дубликат коллизией номера: тогда вставка повторится с новым номером
 * и, если дело всё-таки было в ключе, упрётся в тот же индекс — внешний
 * обработчик найдёт заказ по ключу и вернёт его. Обратное умолчание хуже: оно
 * отключает ретрай номера и останавливает офлайн-очередь.
 *
 * Именно так она и вставала. Раньше в create эти два случая различались по
 * наличию input.idempotencyKey: раз ключ передан — значит дубликат по ключу, и
 * ретрай номера отключался. Агент возвращается в сеть с пятью заказами,
 * syncAll шлёт их параллельно, все пять считают один и тот же «№150», первая
 * транзакция коммитится, остальные четыре падают на uq_order_number_tenant.
 * Ретрай выключен, внешний обработчик по ключу ничего не находит и отдаёт 500,
 * мобилка помечает записи retryable:false — автосинк их больше не трогает,
 * пока агент вручную не нажмёт «Повторить» по каждой.
 */
export function isIdempotencyDuplicate(err: unknown): boolean {
  // Разбор — общий (lib/db-errors): ошибка приезжает завёрнутой в drizzle, и
  // читать её надо по всей цепочке cause, а не с верхнего уровня. Пока читали
  // с верхнего, эта проверка давала false всегда.
  return isDuplicateOf(err, "uq_orders_idempotency");
}

/**
 * Уже ли записан платёж с этим ключом у этой организации.
 *
 * Нужен recordDeliveryAndPayment: на повторе первой отказывает доставка
 * («заказ уже доставлен»), до INSERT платежа дело не доходит, и уникальный
 * индекс сработать не успевает. Тогда ответ на вопрос «это повтор?» даёт сама
 * таблица платежей.
 */
export async function isRepeatOfCompletedDelivery(db: Db, tenantId: number, idempotencyKey: string): Promise<boolean> {
  const [row] = await db.select({ id: payments.id }).from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey)))
    .limit(1);
  return !!row;
}

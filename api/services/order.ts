import { eq, and, or, desc, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { orders, orderItems, warehouseStock, shops, users, products, notifications, warehouses, payments, loadingLists, loadingListOrders, debtReminders, orderAdjustments, territories, returns, returnItems } from "@db/schema";
import { recalcShopDebt } from "./shop-debt";
import { OPEN_ORDER_STATUSES, CLOSED_ORDER_STATUSES, holdsStock, deductsStock } from "../lib/order-status";
import { recordStockMovement } from "./stock-ledger";

/** Second reference to `users` for courier joins alongside the agent join. */
const couriers = alias(users, "couriers");
import { cache, CacheKeys } from "../lib/cache";
import { logger } from "../lib/logger";

import { affectedRows } from "../lib/db-rows";
import { TRPCError } from "@trpc/server";
import { isDuplicateEntry, isDuplicateOf } from "../lib/db-errors";

/**
 * Ошибка, которую оператор должен увидеть и может исправить сам.
 *
 * Обычный `throw new Error` до него не доходит: tRPC считает такое внутренним
 * сбоем, и в проде форматтер подменяет текст на «Внутренняя ошибка сервера,
 * попробуйте позже» (api/middleware.ts). Для настоящего сбоя это правильно —
 * незачем показывать наружу устройство системы. Но «не указаны все позиции» и
 * «нельзя передать больше заказанного» — не сбой, а разговор с человеком, и
 * подмена превращает поправимую ситуацию в тупик: оператор видит одно и то же
 * непонятное сообщение и повторяет то же действие.
 */
function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

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

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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

async function resolveOrderWarehouse(tx: Tx, tenantId: number, requested?: number): Promise<number> {
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
async function settleShopDebt(tx: Tx, tenantId: number, shopId: number): Promise<void> {
  await recalcShopDebt(tx, tenantId, shopId);
}

/** Status that releases stock (goods returned to warehouse). */
function releasesStock(status: string): boolean {
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
async function nextOrderNumber(tx: Tx, tenantId: number): Promise<string> {
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
async function returnedQuantitiesByProduct(
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
function heldQuantity(
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
function stockEffect(status: string): { current: number; reserved: number; available: number } {
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
function stockModeFor(status: string): "reserve" | "consumed" | "none" {
  if (deductsStock(status)) return "consumed";
  if (holdsStock(status)) return "reserve";
  return "none";
}

/**
 * Moves warehouse stock to match a change of `delta` units on an order line,
 * according to what that order's status already did to stock. Positive delta
 * means the order now wants more units than before.
 */
async function applyStockDelta(
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
      throw new Error(`Нет строки склада для товара ID ${productId} на складе ${warehouseId}`);
    }
    if (delta > 0 && Number(stock.available) < delta) {
      throw new Error(`Недостаточно товара на складе (товар ID ${productId}: доступно ${Number(stock.available)}, нужно +${delta})`);
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
    // Считается фактически применённое изменение: GREATEST(0, reserved + delta)
    // − reserved. В обычном случае это ровно delta, при ограничении — только
    // то, что действительно было зарезервировано. available двигается на ту же
    // величину, и равенство сохраняется.
    //
    // ПОРЯДОК ПРИСВОЕНИЙ НЕСУЩИЙ. MySQL вычисляет SET слева направо и в правых
    // частях видит уже ОБНОВЛЁННЫЕ значения предыдущих колонок. Поэтому
    // available считается первым, пока reserved ещё хранит старое значение;
    // поменяй их местами — разница посчитается от самой себя и выйдет нулём.
    await tx.execute(sql`
      UPDATE warehouse_stock
      SET available = available - (GREATEST(0, reserved + ${delta}) - reserved),
          reserved  = GREATEST(0, reserved + ${delta})
      WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
    `);
    return;
  }

  // "consumed" — the goods are already gone; more units means less on hand.
  if (delta > 0) {
    const [stock] = await tx.select({ currentStock: warehouseStock.currentStock })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId)))
      .limit(1);
    if (Number(stock?.currentStock ?? 0) < delta) {
      throw new Error(`Недостаточно товара на складе (товар ID ${productId}: остаток ${Number(stock?.currentStock ?? 0)}, нужно +${delta})`);
    }
  }
  // The units are leaving (or coming back to) the warehouse outright: this
  // order's status already released its reservation, so they move between
  // "on hand" and "gone" — never through `reserved`. Both counters have to
  // move together, or current_stock stops equalling available + reserved.
  await tx.execute(sql`
    UPDATE warehouse_stock
    SET current_stock = current_stock - ${delta}, available = available - ${delta}
    WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
  `);
  await recordStockMovement(tx, {
    tenantId, warehouseId, productId,
    type: delta > 0 ? "out" : "in", quantity: delta,
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
const ORDER_VIEWERS = ["ceo", "operator", "supervisor", "superadmin"];

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
const ORDER_SETTLERS = ["ceo", "operator", "superadmin"];

/**
 * Кто вправе ОТМЕНИТЬ любой заказ.
 *
 * Тот же список, что у проводки: отменить заказ и провести по нему деньги —
 * операции одного веса. Правка состава и удаление закрыты ещё жёстче, на уровне
 * процедур (operatorQuery в api/order-router.ts).
 */
const ORDER_CANCELLERS = ORDER_SETTLERS;

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
async function orderAccessError(
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

function ownerScope(actor: Actor) {
  return canSettleAnyOrder(actor.role) ? [] : [eq(orders.agentId, actor.id)];
}

/** Кто выполняет операцию: идентификатор для записи авторства и роль для прав. */
type Actor = { id: number; role: string };

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
async function traceDebtChange(
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

    await db.insert(notifications).values(office.map(o => ({
      tenantId,
      userId: o.id,
      type: "order" as const,
      title,
      message,
      link: `/orders/${entry.orderId}`,
    })));
  } catch (err) {
    logger.error("Не удалось уведомить офис об изменении долга", { orderId: entry.orderId, error: String(err) });
  }
}
async function applyPartialPayment(
  tx: Tx, tenantId: number, actor: Actor,
  input: { orderId: number; paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string },
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
    throw new Error(`Нельзя принять оплату по заказу в статусе «${order.status}»`);
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

  if (priorPaid + paid > total) throw new Error("Сумма оплаты не может превышать сумму заказа");

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
  await tx.update(orders).set({
    status: "delivered",
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
async function applyPartialDelivery(
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
    throw badRequest(`Нельзя оформить доставку по заказу в статусе «${order.status}»`);
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
      throw badRequest(`Позиция заказа #${item.itemId} уже обработана как частичная доставка`);
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
      // available выводится из инварианта, а не подбирается: чтобы
      // current_stock = available + reserved сохранилось при снятии резерва не
      // больше, чем там лежит, нужно
      //   available' = available − deliveredQty + LEAST(orderedQty, reserved).
      // Без перекоса это даёт ровно `+ returnedQty`, как и было задумано.
      //
      // Прежняя запись прибавляла available полное returnedQty независимо от
      // того, сколько удалось снять с резерва: при просевшем резерве reserved
      // замирал на нуле, а свободный остаток получал единицы, которых на складе
      // нет. available стоит первым — MySQL вычисляет SET слева направо и видит
      // уже обновлённые колонки.
      await tx.execute(sql`
        UPDATE warehouse_stock
        SET available = available - ${deliveredQty} + LEAST(${orderedQty}, reserved),
            current_stock = current_stock - ${deliveredQty},
            reserved = GREATEST(0, reserved - ${orderedQty})
        WHERE product_id = ${orderItem.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${defaultWh.id}
      `);

      // Only the delivered portion left the warehouse. The undelivered part
      // was reserved but never shipped, so it moves from `reserved` back to
      // `available` without touching current_stock — no goods travelled, and
      // recording it would put the ledger out of step with the shelf. Why it
      // came back is already on the order line (deliveredQuantity /
      // returnReason) and in the adjustment log.
      await recordStockMovement(tx, {
        tenantId, warehouseId: defaultWh.id, productId: orderItem.productId,
        type: "out", quantity: deliveredQty,
        reason: "order_delivery", referenceId: order.id,
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

export const OrderService = {
  async list(db: Db, tenantId: number, filters: Record<string, unknown>, opts?: { userId: number; userRole: string }) {
    const f = filters as { status?: string; archived?: boolean; agentId?: number; agentIds?: number[]; page?: number; pageSize?: number; search?: string; showDeleted?: boolean; dateFrom?: string; dateTo?: string; paymentMethod?: string };
    const page = f.page ?? 1;
    const limit = f.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (f.status) {
      conditions.push(eq(orders.status, f.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned"));
    }
    if (f.archived !== undefined) {
      // Archive holds everything that is out of play, so nothing can fall out
      // of both tabs: orders that reached an end state, and deleted ones
      // whatever status they were in when deleted. A deleted order is not
      // active — it used to keep its "new" status and so either sat among live
      // work or vanished from the page entirely.
      //
      // This composes with the status filter rather than being overridden by
      // it: picking a status while on a tab narrows *within* that tab, which
      // is the only reading under which a deleted "new" order is reachable at
      // all now that it belongs to the archive.
      conditions.push(f.archived
        ? or(inArray(orders.status, CLOSED_ORDER_STATUSES), isNotNull(orders.deletedAt))!
        : and(inArray(orders.status, OPEN_ORDER_STATUSES), isNull(orders.deletedAt))!);
    }
    // Both forms are supported: the by-agent view drills into one agent at a
    // time, while the toolbar filter compares several at once. An empty array
    // means the same as omitting the filter, matching how every other optional
    // filter here treats an absent value.
    if (f.agentIds?.length) conditions.push(inArray(orders.agentId, f.agentIds));
    else if (f.agentId) conditions.push(eq(orders.agentId, f.agentId));
    if (f.paymentMethod) conditions.push(eq(orders.paymentMethod, f.paymentMethod as "cash" | "card" | "transfer" | "debt"));
    // P0-14 FIX: Implement search filter
    if (f.search) conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + f.search + '%'} OR ${shops.name} LIKE ${'%' + f.search + '%'})`);
    // P0-14 FIX: Implement date filters
    if (f.dateFrom) conditions.push(sql`${orders.createdAt} >= ${f.dateFrom}`);
    if (f.dateTo) conditions.push(sql`${orders.createdAt} <= ${f.dateTo + ' 23:59:59'}`);
    // Hide deleted orders unless explicitly requested — except in the archive,
    // which is where they belong and already selects them above. Applying it
    // there would cancel that out and leave deleted orders in neither tab.
    if (!f.showDeleted && f.archived !== true) conditions.push(isNull(orders.deletedAt));
    // P0-14 FIX: Non-privileged users see only their own orders
    if (opts && !canSeeAnyOrder(opts.userRole)) {
      conditions.push(eq(orders.agentId, opts.userId));
    }

    // users is already joined for the agent; the courier is the same table
    // again and needs its own alias or the two collapse into one another.
    const courier = alias(users, "courier");

    const baseQuery = db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      total: orders.total,
      subtotal: orders.subtotal,
      discount: orders.discount,
      notes: orders.notes,
      createdAt: orders.createdAt,
      shopId: orders.shopId,
      agentId: orders.agentId,
      shopName: shops.name,
      agentName: users.name,
      paymentMethod: orders.paymentMethod,
      deletedAt: orders.deletedAt,
      territoryName: territories.name,
      // Fields the table can show as optional columns. All of them already sat
      // on the row — the list simply never selected them, so the Orders page
      // had no way to offer a column for something the record plainly knows.
      updatedAt: orders.updatedAt,
      priority: orders.priority,
      deliveryStatus: orders.deliveryStatus,
      deliveredAt: orders.deliveredAt,
      courierName: courier.name,
      // Correlated count rather than a join: joining order_items would multiply
      // the order's row once per line and inflate nothing here but confuse the
      // pagination count next to it.
      itemCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(courier, eq(orders.courierId, courier.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .where(and(...conditions));

    const [data, countResult] = await Promise.all([
      baseQuery.orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async getById(db: Db, tenantId: number, orderId: number, opts?: { userId: number; userRole: string }) {
    // Роль вызывающего принималась параметром и не использовалась (_opts).
    // Из-за этого ограничение списка обходилось одним запросом по id: агент или
    // мерчендайзер перебирал order.getById({id: 1..N}) и по каждому чужому
    // заказу организации получал сумму, скидку, состав с ценами, имя ведущего
    // агента и блок shop — телефон, ФИО владельца и текущий долг магазина.
    // У мерчендайзера своих заказов нет вовсе, поэтому для него это открывало
    // весь портфель компании.
    //
    // Список привилегированных ролей — тот же, что в list выше: карточка и
    // строка списка показывают один и тот же заказ, и разойдись эти два списка,
    // заказ было бы видно в одном месте и не видно в другом.
    const scope = opts && !canSeeAnyOrder(opts.userRole)
      ? [eq(orders.agentId, opts.userId)]
      : [];

    const [order] = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
      notes: orders.notes, createdAt: orders.createdAt, updatedAt: orders.updatedAt,
      shopId: orders.shopId, agentId: orders.agentId,
      courierId: orders.courierId, deliveryStatus: orders.deliveryStatus,
      deliveredAt: orders.deliveredAt, deletedAt: orders.deletedAt,
      paymentMethod: orders.paymentMethod, invoicePrintedAt: orders.invoicePrintedAt,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...scope)).limit(1);
    if (!order) return null;

    const [items, [shop], [agent]] = await Promise.all([
      db.select({
        id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
        deliveredQuantity: orderItems.deliveredQuantity,
        returnReason: orderItems.returnReason,
        productName: products.name, productCode: products.code, unit: products.unit,
      }).from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, orderId)),
      db.select({ id: shops.id, name: shops.name, address: shops.address, city: shops.city, phone: shops.phone, debt: shops.debt, ownerName: shops.ownerName, territoryName: territories.name })
        .from(shops)
        .leftJoin(territories, eq(shops.territoryId, territories.id))
        .where(and(eq(shops.id, order.shopId), eq(shops.tenantId, tenantId))).limit(1),
      order.agentId
        ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, order.agentId)).limit(1)
        : Promise.resolve([]),
    ]);

    return { ...order, items, shop: shop ?? null, shopName: shop?.name ?? null, agent: agent ?? null };
  },

  async myOrders(db: Db, tenantId: number, agentId: number) {
    const conditions = [eq(orders.tenantId, tenantId), eq(orders.agentId, agentId)];
    const [data, countResult] = await Promise.all([
      db.select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        subtotal: orders.subtotal,
        discount: orders.discount,
        notes: orders.notes,
        createdAt: orders.createdAt,
        shopId: orders.shopId,
        agentId: orders.agentId,
        paymentMethod: orders.paymentMethod,
      }).from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(500),
      db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions)),
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0) };
  },

  async create(db: Db, tenantId: number, agentId: number, input: { shopId: number; warehouseId?: number; items: Array<{ productId: number; quantity: string }>; notes?: string; discount?: string; idempotencyKey?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt" }) {
    // discount is a percentage (0-100) entered by the user — converted to a
    // money amount below and stored as such (orders.discount stays a money
    // column so revenue/P&L reports that SUM it keep meaning "money discounted").
    const discountPercent = Number(input.discount ?? "0");
    // Порядок важен: NaN не меньше нуля и не больше ста, поэтому обе проверки
    // ниже он проходил насквозь — и «abc» превращалось в сумму «NaN».
    if (!Number.isFinite(discountPercent)) throw new Error("Скидка должна быть числом");
    if (discountPercent < 0) throw new Error("Скидка не может быть отрицательной");
    if (discountPercent > 100) throw new Error("Скидка не может превышать 100%");

    // Повторы товара схлопываются до всего остального: ниже и проверка
    // достатка, и резерв склада, и вставка строк исходят из того, что товар в
    // заказе встречается один раз.
    const items = mergeDuplicateItems(input.items);

    // P0-1 FIX: Validate shop belongs to this tenant
    const [shop] = await db.select({ id: shops.id }).from(shops)
      .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId))).limit(1);
    if (!shop) throw new Error("Магазин не найден в вашей организации");

    // #FIX1-IDEMPOTENCY: Check for existing order with same key
    if (input.idempotencyKey) {
      const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(and(
          eq(orders.tenantId, tenantId),
          eq(orders.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (existing) {
        return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
      }
    }

    let orderId: number;
    let orderTotal: number;
    // Номер присваивается внутри транзакции (см. nextOrderNumber) и возвращается
    // наружу: он нужен и для уведомлений, и в ответе клиенту.
    let orderNumber: string;
    try {
      const txResult = await db.transaction(async (tx) => {
      // #FIX1: Look up prices from the database, never trust client
      const productIds = items.map(i => i.productId);
      const productRows = await tx.select({ id: products.id, name: products.name, unitPrice: products.unitPrice, costPrice: products.costPrice })
        .from(products)
        .where(and(
          sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
          eq(products.tenantId, tenantId),
          eq(products.status, "active"),
        ));
      const priceMap = new Map<number, string>();
      const costMap = new Map<number, string>();
      // Имена — чтобы отказ по остатку называл товар, а не номер строки в базе.
      const nameMap = new Map<number, string>();
      for (const p of productRows) {
        priceMap.set(p.id, p.unitPrice);
        costMap.set(p.id, p.costPrice);
        nameMap.set(p.id, p.name);
      }

      // Validate all products exist and are active
      for (const item of items) {
        if (!priceMap.has(item.productId)) {
          throw new Error(`Товар #${item.productId} не найден или неактивен`);
        }
      }

      // Calculate subtotal from server-side prices
      let subtotal = 0;
      for (const item of items) {
        const unitPrice = Number(priceMap.get(item.productId)!);
        subtotal += unitPrice * Number(item.quantity);
      }
      const discount = subtotal * (discountPercent / 100);
      const total = subtotal - discount;

      // Reserve from one explicit warehouse. Without this filter a product with
      // stock rows in several warehouses yielded an arbitrary row for the
      // availability check and a different one for the reservation.
      const reserveWarehouseId = await resolveOrderWarehouse(tx, tenantId, input.warehouseId);

      // SELECT stock rows with row-level locking to prevent race conditions
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`,
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, reserveWarehouseId),
        ))
        .for("update");

      const stockMap = new Map<number, typeof stockRows[number]>();
      for (const row of stockRows) stockMap.set(row.productId, row);

      /*
        Отказ называет товар по имени.

        Здесь стояло «Недостаточно товара на складе (доступно: 0, запрошено:
        2)» — без единого признака, о каком товаре речь. Агент стоит у
        прилавка с корзиной из десяти позиций и не знает, какую убрать.
        Соседняя проверка называла товар номером строки в базе — «товар ID
        417», — что для человека ничем не лучше.

        Имена берём из тех же товаров, что уже загружены выше для цен:
        лишнего запроса не нужно.
      */
      for (const item of items) {
        const stock = stockMap.get(item.productId);
        const available = Number(stock?.available ?? 0);
        const name = nameMap.get(item.productId) ?? `товар #${item.productId}`;
        if (available < 0) {
          throw new Error(`Некорректный остаток на складе: «${name}» (доступно: ${available}). Обратитесь к администратору.`);
        }
        if (available < Number(item.quantity)) {
          throw new Error(`«${name}»: на складе ${available}, а в заказе ${item.quantity}`);
        }
      }

      // Номер заказа — порядковый в пределах организации: №149, №150, …
      //
      // Раньше он был куском случайного UUID (ORD-B650EBBC369B): не читается,
      // не называется вслух по телефону, ничего не говорит о порядке. Старые
      // номера остаются как есть — их печатали на накладных, и менять их задним
      // числом значит разойтись с бумагой на руках.
      //
      // Отсчёт продолжает существующие заказы, а не начинается с №1: у бизнеса
      // со ста сорока восемью заказами свежий заказ под номером один выглядел бы
      // ошибкой. Поэтому берётся большее из числа заказов организации и
      // максимума среди уже выданных №-номеров.
      let number = await nextOrderNumber(tx, tenantId);
      let id = 0;
      for (let attempt = 0; ; attempt++) {
        try {
          const [result] = await tx.insert(orders).values({
            tenantId, orderNumber: number, shopId: input.shopId, agentId, status: "new",
            subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
            notes: input.notes,
            idempotencyKey: input.idempotencyKey ?? null,
            paymentMethod: input.paymentMethod ?? "cash",
          });
          id = Number(result.insertId);
          break;
        } catch (err: unknown) {
          // Два заказа, оформленные в одну секунду, посчитают один и тот же
          // следующий номер. Уникальный индекс uq_order_number_tenant отклонит
          // второго — берём следующий и пробуем снова. Дубликат по ключу
          // идемпотентности здесь не наш случай: его разбирает обработчик
          // снаружи транзакции, поэтому такую ошибку пробрасываем как есть.
          // Раньше случаи различались по наличию ключа, и офлайн-очередь агента
          // вставала на первой же коллизии номера — см. isIdempotencyDuplicate.
          const isNumberClash = isDuplicateEntry(err) && !isIdempotencyDuplicate(err);
          if (!isNumberClash || attempt >= 4) throw err;
          number = `№${Number(number.slice(1)) + 1}`;
        }
      }

      await tx.insert(orderItems).values(items.map(item => {
        const unitPrice = Number(priceMap.get(item.productId)!);
        return {
          orderId: id, productId: item.productId, quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
          costPrice: costMap.get(item.productId) ?? "0.00",
          subtotal: (unitPrice * Number(item.quantity)).toFixed(2),
        };
      }));

      if (items.length > 0) {
        // P0-2 FIX: Include warehouse_id in UPDATE to prevent cross-warehouse corruption
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET
            reserved = reserved + CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
            ), sql`\n`)} ELSE 0 END,
            available = available - CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
            ), sql`\n`)} ELSE 0 END
          WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${reserveWarehouseId}
        `);
      }

      // A credit order owes from the moment it exists; re-derive so the shop's
      // balance picks it up.
      await recalcShopDebt(tx, tenantId, input.shopId);

      return { id, total, number };
    });
      orderId = txResult.id;
      orderTotal = txResult.total;
      orderNumber = txResult.number;
    } catch (err: unknown) {
      // Гонка по ключу идемпотентности: заказ уже создан параллельным
      // запросом — находим его и возвращаем как свой.
      if (input.idempotencyKey && isDuplicateEntry(err)) {
        const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, input.idempotencyKey)))
          .limit(1);
        if (existing) {
          return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
        }
      }
      throw err;
    }

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    // Notify operators/CEO about new order (in-app + push)
    try {
      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, input.shopId)).limit(1);
      const operators = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

      // Batch insert notifications (N+1 fix)
      if (operators.length > 0) {
        await db.insert(notifications).values(operators.map(op => ({
          tenantId,
          userId: op.id,
          type: "order" as const,
          title: `Новый заказ ${orderNumber}`,
          message: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
          link: `/orders/${orderId}`,
        })));
      }

      // Send push notifications
      const { sendPushToRole } = await import("./push-service");
      const pushMsg = {
        title: `Новый заказ ${orderNumber}`,
        body: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
        data: { type: "order", orderId },
      };
      await Promise.all([
        sendPushToRole(tenantId, "ceo", pushMsg),
        sendPushToRole(tenantId, "operator", pushMsg),
        sendPushToRole(tenantId, "supervisor", pushMsg),
      ]);
    } catch (e) {
      logger.warn("Order notification failed", { error: String(e) });
    }

    // total возвращается наружу, чтобы клиент мог сверить его с суммой,
    // которую агент назвал владельцу магазина.
    //
    // Заказ, оформленный офлайн, уходит на сервер спустя часы, а цены сервер
    // берёт из базы на момент отправки — свои, не присланные. Если за это
    // время подняли прайс, накладная приходит на другую сумму, чем записано
    // на бумаге у владельца, и разбираться с этим агенту у двери магазина.
    // Зная итог, приложение сообщает о расхождении сразу после отправки.
    return { id: orderId, orderNumber, total: orderTotal };
  },

  async cancel(db: Db, tenantId: number, orderId: number, opts: { userId: number; userRole: string }) {
    /*
      Заполняется внутри транзакции, читается после её успеха: писать след
      изнутри нельзя — откат отменил бы и его, а запись о несостоявшемся
      списании хуже её отсутствия.

      Держатель, а не простая переменная: анализ потока не видит присваивания
      внутри замыкания транзакции и считает переменную по-прежнему пустой, а
      поля внутри ветки — недоступными.
    */
    const cancelled: { debt: { total: number; shopId: number } | null } = { debt: null };
    await db.transaction(async (tx) => {
      const isPrivileged = canCancelAnyOrder(opts.userRole);
      const conditions = [eq(orders.id, orderId), eq(orders.tenantId, tenantId)];
      // Non-privileged users can only cancel their own orders
      if (!isPrivileged) {
        conditions.push(eq(orders.agentId, opts.userId));
      }
      // A soft-deleted order has already had its stock released — cancelling it
      // again would credit the warehouse twice.
      conditions.push(isNull(orders.deletedAt));
      // Locked so a second concurrent cancel for the same order queues here
      // instead of also passing the status check below and releasing the same
      // reserved stock a second time once the first call's release commits.
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        total: orders.total, paymentMethod: orders.paymentMethod,
      }).from(orders).where(and(...conditions)).for("update").limit(1);
      // «Заказ не найден» значило и «нет такого», и «чужой». Права не
      // меняются — меняется объяснение.
      if (!order) throw await orderAccessError(tx, tenantId, orderId, "Отменить");
      if (order.status !== "new") throw new Error("Можно отменить только новые заказы");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      // Освобождаем ровно то, что строка действительно держит: частичная
      // доставка и проведённый возврат уже вернули своё, поэтому отдать назад
      // полное quantity значит аннулировать резерв чужих заказов.
      const cancelReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);
      if (items.length > 0) {
        const cancelWhId = await resolveOrderWarehouse(tx, tenantId);

        // Lock stock rows to prevent race conditions
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, cancelWhId)))
            .for("update");
        }
        // Товар не уезжал — current_stock не меняется, резерв возвращается в
        // свободный остаток. Вернуть можно ровно столько, сколько там лежит:
        // LEAST(held, reserved). Прежняя запись прибавляла available полное
        // held независимо от резерва, и при просевшем резерве свободный остаток
        // получал единицы, которых на складе нет.
        //
        // available идёт ПЕРВЫМ: MySQL вычисляет SET слева направо и видит уже
        // обновлённые колонки, а LEAST нужен от старого резерва.
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET
            available = CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN available + LEAST(${heldQuantity(i, cancelReturned)}, reserved)`
            ), sql`\n`)} ELSE available END,
            reserved = CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN GREATEST(0, reserved - ${heldQuantity(i, cancelReturned)})`
            ), sql`\n`)} ELSE reserved END
          WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${cancelWhId}
        `);
      }
      await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.status, "new")));
      await settleShopDebt(tx, tenantId, order.shopId);

      /*
        Отмена долгового заказа — это списание долга, а не мелочь.

        Долговый заказ должен деньгами с момента оформления, ещё до отгрузки
        (services/shop-debt.ts). Значит агент может взять с магазина наличные
        и вместо оплаты отменить заказ: долг исчезнет, деньги останутся на
        руках, а в системе не будет ни строки. Отмена не писалась ни в
        журнал, ни в уведомления — узнать об этом было неоткуда.

        Обычную отмену (заказ ещё не в долг) это не трогает: там нечего
        списывать, и шуметь незачем.
      */
      if (order.paymentMethod === "debt") {
        cancelled.debt = { total: Number(order.total ?? 0), shopId: order.shopId };
      }
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    const debtTrace = cancelled.debt;
    if (debtTrace) {
      const [shop] = await db.select({ name: shops.name }).from(shops)
        .where(and(eq(shops.id, debtTrace.shopId), eq(shops.tenantId, tenantId))).limit(1);
      const [row] = await db.select({ orderNumber: orders.orderNumber }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      await traceDebtChange(db, tenantId, { id: opts.userId, role: opts.userRole }, {
        action: "order.cancelled",
        orderId,
        orderNumber: String(row?.orderNumber ?? orderId),
        shopId: debtTrace.shopId,
        shopName: String(shop?.name ?? "Магазин"),
        amount: debtTrace.total,
      });
    }

    return { success: true };
  },

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned") {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        agentId: orders.agentId, total: orders.total, subtotal: orders.subtotal,
        deliveryStatus: orders.deliveryStatus, paymentMethod: orders.paymentMethod,
      }).from(orders)
        // Soft-deleted orders already gave their stock back; moving them through
        // the lifecycle again would double-count it. Locked so two concurrent
        // status changes for the same order serialize instead of both reading
        // the same starting status and each applying their own stock delta on
        // top of it — the second call now sees the first's already-committed
        // status and computes its delta from there.
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
        .for("update")
        .limit(1);
      if (!order) throw new Error("Заказ не найден");

      // Nothing to do when the status is unchanged — and re-applying the stock
      // move would double-count it.
      if (order.status === newStatus) return { success: true };

      // Any status may follow any other. Operators legitimately correct
      // mistakes both ways ("delivered by accident" → back to new), and the
      // stock/debt deltas below are computed from the difference between the
      // two statuses, so every direction settles correctly on its own.
      const before = stockEffect(order.status);
      const after = stockEffect(newStatus);
      const d = {
        current: after.current - before.current,
        reserved: after.reserved - before.reserved,
        available: after.available - before.available,
      };

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

      // Units this order already handed back through a completed return
      // document ("Возвраты"). That flow has its own stock credit, so those
      // units are physically on the shelf again. Counting them here as well
      // would credit the same goods a second time — the two return paths are
      // both allowed, so they have to compose rather than each assume it is
      // the only one.
      // Two plain selects and a sum in JS rather than a join + GROUP BY: the
      // volume here is a handful of rows, and it keeps this query inside the
      // subset of the builder the service-level test doubles implement.
      const returnedByProduct = await returnedQuantitiesByProduct(tx, tenantId, orderId);

      // A line that already went through partial delivery moved only
      // `deliveredQuantity` physically, not the full ordered `quantity` — the
      // undelivered remainder was released back to `available`, not held as
      // stock waiting to move again. Every stock delta below must be sized off
      // what's actually still in play for this line, or a later status change
      // (e.g. correcting "delivered" back to "cancelled") fabricates stock for
      // units that were never there.
      const effectiveQty = (i: (typeof items)[number]) => heldQuantity(i, returnedByProduct);
      // The courier flow already moved the stock for this delivery; replaying
      // the same move here would deduct it a second time.
      const courierAlreadySettled = order.deliveryStatus === "delivered" && deductsStock(newStatus);

      if (items.length > 0 && !courierAlreadySettled && (d.current || d.reserved || d.available)) {
        const whId = await resolveOrderWarehouse(tx, tenantId);

        // Lock every affected row in one query before reading or writing.
        const stockRows = await tx.select({
          productId: warehouseStock.productId,
          currentStock: warehouseStock.currentStock,
          available: warehouseStock.available,
        })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.tenantId, tenantId),
            eq(warehouseStock.warehouseId, whId),
            sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`
          ))
          .for("update");

        // Refuse the move if it would drive any counter below zero, rather than
        // writing it and unwinding afterwards.
        const short = items.filter(i => {
          const row = stockRows.find(r => Number(r.productId) === i.productId);
          if (!row) return d.current < 0 || d.available < 0;
          const qty = effectiveQty(i);
          return (d.current < 0 && Number(row.currentStock) + d.current * qty < 0)
            || (d.available < 0 && Number(row.available) + d.available * qty < 0);
        });
        if (short.length > 0) {
          throw new Error(`Недостаточно товара на складе: ${short.map(i => `${i.productId}`).join(", ")}`);
        }

        // Each delta is −1, 0 or +1 per unit, so the sign travels inside the
        // number and every column is a plain "col = col + delta".
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET current_stock = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN current_stock + ${d.current * effectiveQty(i)}`
              ), sql`\n`)} ELSE current_stock END,
              reserved = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN reserved + ${d.reserved * effectiveQty(i)}`
              ), sql`\n`)} ELSE reserved END,
              available = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN available + ${d.available * effectiveQty(i)}`
              ), sql`\n`)} ELSE available END
          WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${whId}
        `);

        // Only a change in current_stock is goods actually moving; a status
        // that merely reserves or frees them shuffles the other two columns
        // and belongs in no ledger.
        if (d.current !== 0) {
          for (const item of items) {
            await recordStockMovement(tx, {
              tenantId, warehouseId: whId, productId: item.productId,
              type: d.current < 0 ? "out" : "in",
              quantity: effectiveQty(item),
              reason: d.current < 0 ? "order_delivery" : "order_return",
              referenceId: orderId,
              notes: `Заказ: ${order.status} → ${newStatus}`,
            });
          }
        }
      }
      const [statusUpdateResult] = await tx.update(orders).set({ status: newStatus })
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.status, order.status)));
      if ((statusUpdateResult as { affectedRows?: number }).affectedRows !== 1) {
        throw new Error("Статус заказа уже был изменён другим действием");
      }
      await settleShopDebt(tx, tenantId, order.shopId);
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    // Notify agent about status change (non-blocking)
    try {
      const [orderRow] = await db.select({ orderNumber: orders.orderNumber, agentId: orders.agentId, shopId: orders.shopId })
        .from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      if (orderRow?.agentId) {
        const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, orderRow.shopId)).limit(1);
        const statusLabels: Record<string, string> = { completed: "выполнен", cancelled: "отменён", processing: "в обработке" };
        const label = statusLabels[newStatus] ?? newStatus;
        const { sendPushToUser } = await import("./push-service");
        await sendPushToUser(orderRow.agentId, {
          title: `Заказ ${orderRow.orderNumber}`,
          body: `Статус изменён: ${label}${shop?.name ? ` (${shop.name})` : ""}`,
          data: { type: "order.status_changed", orderId },
        }).catch(() => {});
      }
    } catch (e) {
      logger.warn("Status change notification failed", { error: String(e) });
    }

    return { success: true };
  },

  async delete(db: Db, tenantId: number, orderId: number) {
    await db.transaction(async (tx) => {
      // Locked for the same reason as cancel() above: without it, two
      // concurrent deletes both pass the `deletedAt IS NULL` check and each
      // release the same reserved stock back to `available`.
      const [order] = await tx.select({
        id: orders.id,
        status: orders.status,
        deletedAt: orders.deletedAt,
        shopId: orders.shopId,
        total: orders.total,
        paymentMethod: orders.paymentMethod,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).for("update").limit(1);
      if (!order) throw new Error("Заказ не найден или уже удалён");

      // Release reserved stock if order is new or processing
      if (holdsStock(order.status)) {
        const items = await tx.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          // Нужно heldQuantity: строка после частичной доставки держит только
          // доставленное, а не заказанное.
          deliveredQuantity: orderItems.deliveredQuantity,
        }).from(orderItems).where(eq(orderItems.orderId, orderId));
        if (items.length > 0) {
          const deleteWhId = await resolveOrderWarehouse(tx, tenantId);
          // См. heldQuantity: отдаём назад ровно то, что строка держит сейчас.
          const deleteReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);

          // Lock stock rows before releasing
          for (const item of items) {
            await tx.select({ id: warehouseStock.id }).from(warehouseStock)
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, deleteWhId)))
              .for("update");
          }
          // Как и при отмене: возвращается только то, что действительно лежит
          // в резерве, — LEAST(held, reserved). Иначе при просевшем резерве
          // available прибавлял бы единицы, которых на складе нет, и
          // current_stock = available + reserved расходилось бы молча.
          //
          // available первым — MySQL вычисляет SET слева направо.
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET
              available = available + LEAST(CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${heldQuantity(i, deleteReturned)}`
              ), sql`\n`)} ELSE 0 END, reserved),
              reserved = GREATEST(0, reserved - CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${heldQuantity(i, deleteReturned)}`
              ), sql`\n`)} ELSE 0 END)
            WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
              AND tenant_id = ${tenantId}
              AND warehouse_id = ${deleteWhId}
          `);
        }
      }

      // Soft delete — a deleted order is excluded from the balance, so this
      // withdraws whatever it was contributing.
      await tx.update(orders).set({ deletedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
      await settleShopDebt(tx, tenantId, order.shopId);
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async update(
    db: Db, tenantId: number, orderId: number,
    data: { notes?: string; discount?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt" },
  ) {
    // discount is a percentage (0-100), same contract as OrderService.create.
    if (data.discount !== undefined) {
      const pct = Number(data.discount);
      // NaN не меньше нуля и не больше ста — без этой строки он проходил обе
      // проверки, и заказ пересчитывался в «NaN».
      if (!Number.isFinite(pct)) throw new Error("Скидка должна быть числом");
      if (pct < 0) throw new Error("Скидка не может быть отрицательной");
      if (pct > 100) throw new Error("Скидка не может превышать 100%");
    }

    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id,
        status: orders.status,
        subtotal: orders.subtotal,
        total: orders.total,
        shopId: orders.shopId,
        paymentMethod: orders.paymentMethod,
        deletedAt: orders.deletedAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден");

      const updates: Record<string, unknown> = {};
      if (data.notes !== undefined) updates.notes = data.notes;

      let newTotal = Number(order.total);
      if (data.discount !== undefined) {
        const subtotal = Number(order.subtotal);
        const discount = subtotal * (Number(data.discount) / 100);
        newTotal = subtotal - discount;
        updates.discount = discount.toFixed(2);
        updates.total = newTotal.toFixed(2);
      }
      if (data.paymentMethod !== undefined) updates.paymentMethod = data.paymentMethod;

      if (Object.keys(updates).length > 0) {
        await tx.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
      }
      // Re-discounting and switching to/from "в долг" both change what this
      // order owes; re-deriving covers either without case analysis.
      await settleShopDebt(tx, tenantId, order.shopId);
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  /**
   * Rewrites an order's lines: quantities, unit prices, added and removed
   * products. Lines are matched by `itemId`; an entry without one adds a new
   * product, and `quantity: 0` drops the line.
   *
   * Editing is allowed in any status, so stock is moved according to what the
   * current status already did to it (see stockModeFor): a "new" order shifts
   * its reservation, while a delivered one adjusts stock actually on hand.
   * Omitting `items` entirely leaves the lines untouched.
   */
  async updateItems(
    db: Db, tenantId: number, orderId: number,
    data: { items: Array<{ itemId?: number; productId?: number; quantity: number; unitPrice?: string }> },
  ) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        subtotal: orders.subtotal, total: orders.total, discount: orders.discount,
        paymentMethod: orders.paymentMethod, deletedAt: orders.deletedAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден");

      const mode = stockModeFor(order.status);
      const whId = await resolveOrderWarehouse(tx, tenantId);
      const existingItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const existingById = new Map(existingItems.map(i => [i.id, i]));

      // Состав частично доставленного заказа этой функцией не правится.
      //
      // Здесь считается только quantity — заказанное. У заказа, по которому
      // курьер отдал часть и часть вернул, доставленное лежит отдельно, в
      // delivered_quantity, и оно тут не читается вовсе. Поэтому сохранение —
      // даже без единой правки, просто «открыл и нажал сохранить», а веб
      // отправляет все строки целиком — пересчитывало сумму заказа по
      // ЗАКАЗАННОМУ и возвращало магазину в долг стоимость товара, который он
      // уже вернул. Попытка исправить это руками, поставив доставленное
      // количество, зачисляла возвращённые единицы на склад второй раз:
      // applyStockDelta в режиме consumed трактует уменьшение как возврат.
      //
      // Правильный инструмент для такого заказа — документ возврата или
      // повторная отметка доставки, где доставленное и есть предмет разговора.
      // Отказ здесь честнее, чем попытка угадать намерение в функции с пятью
      // ветками: цифры расходятся молча, а разбирать их потом по бумагам.
      const partiallyDelivered = existingItems.find(i => i.deliveredQuantity !== null);
      if (partiallyDelivered) {
        throw new Error(
          "Заказ уже частично доставлен — состав менять нельзя. " +
          "Оформите возврат или переотметьте доставку: там учитывается доставленное количество.",
        );
      }

      // Validate that every new product belongs to this tenant before touching
      // anything — an unknown id must not leave the order half-rewritten.
      const newProductIds = data.items.filter(i => i.itemId === undefined).map(i => i.productId);
      if (newProductIds.some(id => id === undefined)) {
        throw new Error("Для новой позиции нужно указать товар");
      }
      const productPrices = new Map<number, { costPrice: string }>();
      if (newProductIds.length > 0) {
        const found = await tx.select({ id: products.id, costPrice: products.costPrice })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), inArray(products.id, newProductIds as number[])));
        for (const p of found) productPrices.set(Number(p.id), { costPrice: p.costPrice });
        for (const id of newProductIds as number[]) {
          if (!productPrices.has(id)) throw new Error(`Товар #${id} не найден в вашей организации`);
        }
      }

      // Lock every stock row this edit can touch, in one pass, before any write.
      const touchedProductIds = [...new Set([
        ...existingItems.map(i => i.productId),
        ...(newProductIds as number[]),
      ])];
      for (const productId of touchedProductIds) {
        await tx.select({ id: warehouseStock.id }).from(warehouseStock)
          .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, whId)))
          .for("update");
      }

      const keptItemIds = new Set<number>();
      let newSubtotal = 0;

      for (const line of data.items) {
        if (line.quantity < 0) throw new Error("Количество не может быть отрицательным");

        // ── Existing line ──
        if (line.itemId !== undefined) {
          const item = existingById.get(line.itemId);
          if (!item) throw new Error(`Позиция заказа #${line.itemId} не найдена`);

          const oldQty = Number(item.quantity);
          const unitPrice = line.unitPrice !== undefined ? Number(line.unitPrice) : Number(item.unitPrice);
          if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

          if (line.quantity === 0) {
            await applyStockDelta(tx, tenantId, whId, item.productId, -oldQty, mode);
            await tx.delete(orderItems).where(eq(orderItems.id, item.id));
            continue;
          }

          keptItemIds.add(item.id);
          await applyStockDelta(tx, tenantId, whId, item.productId, line.quantity - oldQty, mode);
          await tx.update(orderItems).set({
            quantity: String(line.quantity),
            unitPrice: unitPrice.toFixed(2),
            subtotal: (unitPrice * line.quantity).toFixed(2),
          }).where(eq(orderItems.id, item.id));

          newSubtotal += unitPrice * line.quantity;
          continue;
        }

        // ── New line ──
        if (line.quantity === 0) continue;
        const productId = line.productId as number;
        const unitPrice = Number(line.unitPrice ?? 0);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

        // Товар, который в заказе уже есть, второй строкой не заводится.
        //
        // Второй ряд с тем же product_id ломает всё, что двигает склад по
        // заказу: и здесь, и в updateStatus, cancel, delete, restore резерв
        // собирается одним UPDATE с `CASE WHEN product_id = ...`, а MySQL берёт
        // первый совпавший WHEN — вторая строка молча не резервируется. С
        // миграции 0043 такую пару отвергает и уникальный индекс, но отказ базы
        // выглядел бы как непонятная поломка, поэтому причина называется здесь.
        //
        // Отказ, а не слияние — сознательно. Слить пришлось бы с учётом того,
        // что ту же строку мог править другой элемент этого же вызова (по
        // itemId), и тогда количество считалось бы от устаревшей копии, а сумма
        // задваивалась. В функции с пятью ветками правильнее назвать конфликт,
        // чем угадывать намерение: у вызывающего уже есть itemId нужной строки.
        const already = existingItems.find(i => i.productId === productId);
        if (already) {
          throw new Error(
            `Товар уже есть в заказе — измените количество существующей позиции (itemId ${already.id}), а не добавляйте вторую`,
          );
        }

        await applyStockDelta(tx, tenantId, whId, productId, line.quantity, mode);
        await tx.insert(orderItems).values({
          orderId,
          productId,
          quantity: String(line.quantity),
          unitPrice: unitPrice.toFixed(2),
          costPrice: productPrices.get(productId)?.costPrice ?? "0.00",
          subtotal: (unitPrice * line.quantity).toFixed(2),
        });

        newSubtotal += unitPrice * line.quantity;
      }

      // Lines the caller did not mention stay as they are and still count.
      for (const item of existingItems) {
        if (keptItemIds.has(item.id)) continue;
        if (data.items.some(l => l.itemId === item.id)) continue; // removed above
        newSubtotal += Number(item.unitPrice) * Number(item.quantity);
      }

      if (newSubtotal <= 0) throw new Error("В заказе должна остаться хотя бы одна позиция");

      // Keep the discount proportional to the order's new size.
      const discountPct = Number(order.subtotal) > 0 ? (Number(order.discount) / Number(order.subtotal)) * 100 : 0;
      const newDiscount = newSubtotal * (discountPct / 100);
      const newTotal = newSubtotal - newDiscount;

      await tx.update(orders).set({
        subtotal: newSubtotal.toFixed(2),
        discount: newDiscount.toFixed(2),
        total: newTotal.toFixed(2),
      }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

      await settleShopDebt(tx, tenantId, order.shopId);
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
    return { success: true };
  },

  async restore(db: Db, tenantId: number, orderId: number) {
    await db.transaction(async (tx) => {
      // Читаем заказ ВНУТРИ транзакции и под блокировкой — первым же запросом.
      //
      // Раньше проверка «заказ удалён» читалась снаружи, без лока, а UPDATE
      // снимал deletedAt безусловно. Два одновременных восстановления (двойной
      // клик, повтор по таймауту) оба видели удалённый заказ и оба выполняли
      // резервирование: на полке в 100 единиц заказ на 10 оставлял reserved=20,
      // available=80. Освобождает потом заказ только свои 10 — вторые 10
      // остаются в резерве навсегда, без заказа, который бы их объяснял.
      // cancel() и delete() рядом делают это правильно; restore был единственным
      // из трёх без защиты.
      const [order] = await tx.select({
        id: orders.id, deletedAt: orders.deletedAt, status: orders.status,
        shopId: orders.shopId, total: orders.total, paymentMethod: orders.paymentMethod,
      }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
        .for("update")
        .limit(1);
      if (!order) throw new Error("Заказ не найден");
      if (!order.deletedAt) throw new Error("Заказ не удалён");

      // Mirror of delete(): the order counts again, and so does what it owes.
      // Условие isNotNull — вторая половина защиты: даже если проверка выше
      // окажется по устаревшим данным, снять пометку сможет только тот вызов,
      // который застал её на месте.
      const restored = affectedRows(await tx.update(orders).set({ deletedAt: null })
        .where(and(
          eq(orders.id, orderId),
          eq(orders.tenantId, tenantId),
          isNotNull(orders.deletedAt),
        )));
      if (restored === 0) throw new Error("Заказ уже восстановлен");

      await settleShopDebt(tx, tenantId, order.shopId);

      // Re-reserve stock if order was new/processing when deleted
      if (holdsStock(order.status)) {
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const restoreWhId = await resolveOrderWarehouse(tx, tenantId);
        const restoreReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);

        // Блокируем и СРАЗУ читаем available той же выборкой. Прежде остаток
        // читался вторым, обычным SELECT: под REPEATABLE READ он обслуживается
        // из снимка, зафиксированного первым чтением транзакции, то есть ДО
        // взятия блокировки, — проверка «хватает ли товара» могла одобрить
        // резерв против остатка, уже израсходованного соседней транзакцией.
        const stockRows = await tx.select({
          productId: warehouseStock.productId,
          available: warehouseStock.available,
        })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.tenantId, tenantId),
            eq(warehouseStock.warehouseId, restoreWhId),
            inArray(warehouseStock.productId, items.map(i => i.productId)),
          ))
          .for("update");

        for (const item of items) {
          const qty = heldQuantity(item, restoreReturned);
          if (qty === 0) continue;
          const row = stockRows.find(r => Number(r.productId) === item.productId);
          const available = Number(row?.available ?? 0);
          if (available < qty) {
            throw new Error(`Недостаточно товара на складе для восстановления (товар ID ${item.productId}: доступно ${available}, нужно ${qty})`);
          }
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET available = available - ${qty}, reserved = reserved + ${qty}
            WHERE product_id = ${item.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${restoreWhId}
          `);
        }
      }
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  // ── Batch operations ──────────────────────────────────────────────────────

  async batchGetOrdersForPrint(db: Db, tenantId: number, orderIds: number[]) {
    if (orderIds.length === 0) return [];
    if (orderIds.length > 50) throw new Error("Максимум 50 заказов за раз");

    const ordersData = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
      notes: orders.notes, createdAt: orders.createdAt,
      shopId: orders.shopId, agentId: orders.agentId,
      paymentMethod: orders.paymentMethod,
      invoicePrintedAt: orders.invoicePrintedAt,
      shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
      shopPhone: shops.phone, shopDebt: shops.debt,
      agentName: users.name,
      territoryName: territories.name,
      courierName: couriers.name,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .leftJoin(couriers, eq(orders.courierId, couriers.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

    // Fetch items for all orders in one query
    const allItems = await db.select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      costPrice: orderItems.costPrice,
      subtotal: orderItems.subtotal,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(inArray(orderItems.orderId, orderIds));

    // Fetch payment history for all shops
    const shopIds = [...new Set(ordersData.map(o => o.shopId))];
    const allPayments = await db.select({
      shopId: payments.shopId,
      amount: payments.amount,
      type: payments.type,
      createdAt: payments.createdAt,
    }).from(payments)
      .where(and(
        eq(payments.tenantId, tenantId),
        inArray(payments.shopId, shopIds),
        sql`${payments.createdAt} >= NOW() - INTERVAL 30 DAY`,
      ))
      .orderBy(desc(payments.createdAt));

    // Group items and payments by order/shop
    const itemsByOrder = new Map<number, typeof allItems>();
    for (const item of allItems) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    const paymentsByShop = new Map<number, typeof allPayments>();
    for (const p of allPayments) {
      const list = paymentsByShop.get(p.shopId) ?? [];
      list.push(p);
      paymentsByShop.set(p.shopId, list);
    }

    return ordersData.map(o => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
      shopDebtAmount: Number(o.shopDebt ?? 0),
      paymentHistory: paymentsByShop.get(o.shopId) ?? [],
    }));
  },

  async markInvoicesPrinted(db: Db, tenantId: number, orderIds: number[]) {
    if (orderIds.length === 0) return;
    await db.update(orders)
      .set({ invoicePrintedAt: new Date() })
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));
  },

  async bulkUpdateStatus(
    db: Db, tenantId: number, orderIds: number[],
    newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
    actorId?: number, comment?: string,
  ) {
    if (orderIds.length === 0) return { updated: 0, failed: [] as Array<{ orderId: number; error: string }> };
    if (orderIds.length > 100) throw new Error("Максимум 100 заказов за раз");

    let updated = 0;
    const failed: Array<{ orderId: number; error: string }> = [];
    for (const orderId of orderIds) {
      try {
        await this.updateStatus(db, tenantId, orderId, newStatus);
        updated++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn("Bulk status update failed for order", { orderId, error: message });
        failed.push({ orderId, error: message });
      }
    }

    // Audit log
    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId, action: "order.bulk_status_change",
        targetType: "order", meta: { orderIds, newStatus, updated, failed, comment },
      });
    } catch { /* audit is non-blocking */ }

    return { updated, failed };
  },

  async bulkAssignAgent(db: Db, tenantId: number, orderIds: number[], agentId: number) {
    if (orderIds.length === 0) return { updated: 0 };

    // Verify agent exists and belongs to tenant
    const [agent] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId))).limit(1);
    if (!agent) throw new Error("Агент не найден");

    await db.update(orders)
      .set({ agentId })
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

    return { updated: orderIds.length };
  },

  // ── Loading Lists ─────────────────────────────────────────────────────────

  async createLoadingList(
    db: Db, tenantId: number, createdBy: number,
    input: {
      orderIds: number[];
      format: "aggregated" | "byOrder" | "byRoute";
      warehouseId?: number;
      options?: { includeBarcodes?: boolean; includeWeight?: boolean; includeTotalWeight?: boolean };
    },
  ) {
    if (input.orderIds.length === 0) throw new Error("Выберите хотя бы один заказ");

    const ordersData = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      shopId: orders.shopId, agentId: orders.agentId, total: orders.total,
      paymentMethod: orders.paymentMethod,
      shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
      shopPhone: shops.phone, shopGpsLat: shops.gpsLat, shopGpsLng: shops.gpsLng,
      shopDebt: shops.debt, agentName: users.name,
      territoryName: territories.name,
      courierName: couriers.name,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .leftJoin(couriers, eq(orders.courierId, couriers.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, input.orderIds)));

    if (ordersData.length === 0) throw new Error("Заказы не найдены");

    // Fetch items aggregated
    const items = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      unitWeight: products.unitWeight,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
      totalPrice: sql<string>`SUM(${orderItems.subtotal})`,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, products.unitWeight);

    // Fetch items grouped by (product, agent) for the route/agent-matrix format
    const itemsByAgent = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      agentId: orders.agentId,
      agentName: users.name,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, orders.agentId, users.name);

    const totalItems = items.reduce((s, i) => s + Number(i.totalQty), 0);
    const totalWeight = items.reduce((s, i) => s + Number(i.totalQty) * Number(i.unitWeight ?? 0), 0);

    // Generate list number
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const listNumber = `ZL-${date}-${rand}`;

    // Insert loading list
    const [result] = await db.insert(loadingLists).values({
      tenantId, listNumber,
      warehouseId: input.warehouseId ?? null,
      agentId: ordersData[0]?.agentId ?? null,
      status: "preparing",
      totalOrders: ordersData.length,
      totalItems,
      totalWeight: totalWeight.toFixed(3),
      createdBy,
    });
    const listId = Number(result.insertId);

    // Link orders to list
    await db.insert(loadingListOrders).values(
      input.orderIds.map(orderId => ({ listId, orderId }))
    );

    // Audit
    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId: createdBy, action: "loading_list.created",
        targetType: "loading_list", targetId: listId,
        meta: { listNumber, orderIds: input.orderIds, totalWeight, format: input.format },
      });
    } catch { /* non-blocking */ }

    return {
      listId, listNumber, orders: ordersData, items, itemsByAgent,
      totalOrders: ordersData.length, totalItems, totalWeight,
    };
  },

  async listLoadingLists(db: Db, tenantId: number, opts?: { page?: number; pageSize?: number; status?: string }) {
    const page = opts?.page ?? 1;
    const limit = opts?.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(loadingLists.tenantId, tenantId)];
    if (opts?.status) conditions.push(eq(loadingLists.status, opts.status as "preparing" | "ready" | "loading" | "loaded" | "delivered"));

    const [data, countResult] = await Promise.all([
      db.select({
        id: loadingLists.id,
        listNumber: loadingLists.listNumber,
        status: loadingLists.status,
        totalOrders: loadingLists.totalOrders,
        totalItems: loadingLists.totalItems,
        totalWeight: loadingLists.totalWeight,
        createdAt: loadingLists.createdAt,
        loadedAt: loadingLists.loadedAt,
        agentName: users.name,
      }).from(loadingLists)
        .leftJoin(users, eq(loadingLists.agentId, users.id))
        .where(and(...conditions))
        .orderBy(desc(loadingLists.createdAt))
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(loadingLists).where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async updateLoadingListStatus(db: Db, tenantId: number, listId: number, newStatus: string) {
    const validTransitions: Record<string, string[]> = {
      preparing: ["ready"],
      ready: ["loading"],
      loading: ["loaded"],
      loaded: ["delivered"],
    };

    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new Error("Загрузочный лист не найден");

    if (!validTransitions[list.status]?.includes(newStatus)) {
      throw new Error(`Невозможно перевести из "${list.status}" в "${newStatus}"`);
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "loaded") updates.loadedAt = new Date();
    if (newStatus === "delivered") updates.deliveredAt = new Date();

    await db.update(loadingLists).set(updates)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));

    return { success: true };
  },

  // ── Partial Payment ────────────────────────────────────────────────────────

  async recordPartialPayment(
    db: Db, tenantId: number, actor: Actor,
    input: {
      orderId: number;
      paidAmount: string;
      method: "cash" | "card" | "transfer";
      debtDueDate?: string;
      notes?: string;
    },
  ) {
    await db.transaction((tx) => applyPartialPayment(tx, tenantId, actor, input));
    cache.invalidate(CacheKeys.dashboardKpis(tenantId));

    /*
      След оставляем ПОСЛЕ успешной сделки, а не внутри неё: откат унёс бы
      запись вместе с оплатой, а запись о неслучившемся платеже хуже, чем её
      отсутствие. Сама оплата уже неудаляема — процедуры удаления платежей в
      системе нет.
    */
    try {
      const [info] = await db.select({
        orderNumber: orders.orderNumber,
        shopId: orders.shopId,
        shopName: shops.name,
        total: orders.total,
      }).from(orders)
        .leftJoin(shops, eq(shops.id, orders.shopId))
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId))).limit(1);

      const [sum] = await db.select({
        paid: sql`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
      }).from(payments)
        .where(and(eq(payments.orderId, input.orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));

      const remaining = Math.max(0, Number(info?.total ?? 0) - Number(sum?.paid ?? 0));
      await traceDebtChange(db, tenantId, actor, {
        action: "order.payment_recorded",
        orderId: input.orderId,
        orderNumber: String(info?.orderNumber ?? input.orderId),
        shopId: Number(info?.shopId ?? 0),
        shopName: String(info?.shopName ?? "Магазин"),
        amount: Number(input.paidAmount),
        remaining,
        method: input.method,
      });
    } catch (err) {
      logger.error("Не удалось записать след оплаты", { orderId: input.orderId, error: String(err) });
    }

    return { success: true };
  },

  // ── Partial Delivery ───────────────────────────────────────────────────────

  async recordPartialDelivery(
    db: Db, tenantId: number, actor: Actor,
    input: {
      orderId: number;
      items: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      photos?: string[];
    },
  ) {
    await db.transaction((tx) => applyPartialDelivery(tx, tenantId, actor, input));
    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

  // ── Combined Delivery + Payment ────────────────────────────────────────────
  // Both steps run inside a single transaction so a failed payment (e.g. bad
  // amount) rolls back the delivery adjustment too, instead of leaving the
  // order half-updated (stock already returned, debt already reduced, but no
  // payment recorded).

  // ── Bulk Complete + Full Payment ────────────────────────────────────────────
  /**
   * For a batch of orders the operator already knows are fully paid — closes
   * each one (goods delivered, stock consumed) and records a full-amount
   * payment in the same pass, so there's no debt left and no need to open
   * every order individually. Each order is processed independently so one
   * bad row (already cancelled, zero total, etc.) doesn't block the rest.
   */
  async bulkCompleteWithPayment(db: Db, tenantId: number, actor: Actor, orderIds: number[]) {
    if (orderIds.length === 0) return { updated: 0, failed: [] as Array<{ orderId: number; error: string }> };
    if (orderIds.length > 100) throw new Error("Максимум 100 заказов за раз");

    let updated = 0;
    const failed: Array<{ orderId: number; error: string }> = [];

    for (const orderId of orderIds) {
      try {
        const [order] = await db.select({
          id: orders.id, status: orders.status, total: orders.total, paymentMethod: orders.paymentMethod,
        }).from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
          .limit(1);
        if (!order) throw new Error("Заказ не найден");
        if (order.status === "cancelled" || order.status === "returned") {
          throw new Error("Заказ отменён или возвращён — оплатить нельзя");
        }
        const total = Number(order.total);
        if (total <= 0) throw new Error("Сумма заказа равна нулю");

        const [{ paid: alreadyPaid }] = await db.select({
          paid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
        }).from(payments).where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
        if (Number(alreadyPaid) >= total) {
          // Already fully paid from an earlier action — just make sure it's
          // marked delivered, nothing more to record.
          if (order.status !== "delivered") await this.updateStatus(db, tenantId, orderId, "delivered");
          updated++;
          continue;
        }

        if (order.status !== "delivered") {
          await this.updateStatus(db, tenantId, orderId, "delivered");
        }
        const remaining = total - Number(alreadyPaid);
        await db.transaction(tx => applyPartialPayment(tx, tenantId, actor, {
          orderId,
          paidAmount: remaining.toFixed(2),
          method: (order.paymentMethod === "debt" ? "cash" : order.paymentMethod) as "cash" | "card" | "transfer",
        }));
        updated++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn("Bulk complete-with-payment failed for order", { orderId, error: message });
        failed.push({ orderId, error: message });
      }
    }

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { updated, failed };
  },

  /**
   * Позиции нескольких заказов сразу — для окна массового завершения.
   *
   * Список заказов их не содержит: он отдаёт шапки, и подтягивать позиции по
   * одной означало бы полсотни запросов подряд на открытие окна. Здесь один
   * запрос на все выбранные заказы.
   *
   * Правило видимости то же, что у getById: кто не видит чужие заказы, тот
   * получает только свои. Иначе окно стало бы обходным путём к чужим данным.
   */
  async getManyForCompletion(db: Db, tenantId: number, orderIds: number[], opts?: { userId: number; userRole: string }) {
    if (orderIds.length === 0) return [];

    const scope = opts && !canSeeAnyOrder(opts.userRole) ? [eq(orders.agentId, opts.userId)] : [];
    const heads = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
      shopId: orders.shopId, shopName: shops.name, paymentMethod: orders.paymentMethod,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds), isNull(orders.deletedAt), ...scope));

    if (heads.length === 0) return [];

    const lines = await db.select({
      id: orderItems.id, orderId: orderItems.orderId, productId: orderItems.productId,
      quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
      deliveredQuantity: orderItems.deliveredQuantity,
      productName: products.name, productCode: products.code, unit: products.unit,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(inArray(orderItems.orderId, heads.map(h => h.id)));

    // Сколько уже принято по каждому заказу: окно показывает остаток, а не
    // полную сумму, иначе повторное завершение предложит взять деньги дважды.
    const paidRows = await db.select({
      orderId: payments.orderId,
      paid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
    }).from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), inArray(payments.orderId, heads.map(h => h.id))))
      .groupBy(payments.orderId);
    const paidByOrder = new Map(paidRows.map(r => [r.orderId, Number(r.paid)]));

    return heads.map(h => ({
      ...h,
      alreadyPaid: (paidByOrder.get(h.id) ?? 0).toFixed(2),
      items: lines.filter(l => l.orderId === h.id),
    }));
  },

  /**
   * Завершить несколько заказов, у каждого — своя оплата и свой возврат.
   *
   * Массовые действия до этого умели только крайности: «оплачено полностью»
   * или «не оплачено вовсе». Середины — магазин отдал часть денег, часть
   * товара вернул — не было, а именно так чаще всего и происходит. Из-за
   * этого пачку приходилось разбирать по одному заказу.
   *
   * Каждый заказ проводится в СВОЕЙ транзакции: сбой на одном не должен
   * отменять уже записанные деньги по остальным. Что не прошло — возвращается
   * списком с причиной, чтобы человек видел, к чему вернуться, а не гадал,
   * какая часть пачки применилась.
   */
  async bulkCompleteDetailed(
    db: Db, tenantId: number, actor: Actor,
    entries: Array<{
      orderId: number;
      deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      paidAmount: string;
      paymentMethod: "cash" | "card" | "transfer";
      notes?: string;
    }>,
  ) {
    let updated = 0;
    const failed: Array<{ orderId: number; error: string }> = [];

    for (const entry of entries) {
      try {
        const paid = Number(entry.paidAmount);
        if (!Number.isFinite(paid) || paid < 0) throw new Error("Неверная сумма оплаты");

        await db.transaction(async (tx) => {
          await applyPartialDelivery(tx, tenantId, actor, {
            orderId: entry.orderId,
            items: entry.deliveredItems,
          });
          // Ноль — законный случай: товар отдан, деньги не принесли, вся
          // сумма уходит в долг. applyPartialPayment такую оплату не
          // принимает и не должен: нулевая строка в платежах ничего не
          // значит. Долг при этом уже пересчитан внутри applyPartialDelivery.
          if (paid > 0) {
            await applyPartialPayment(tx, tenantId, actor, {
              orderId: entry.orderId,
              paidAmount: entry.paidAmount,
              method: entry.paymentMethod,
              notes: entry.notes,
            });
          }
        });
        updated++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn("Bulk detailed completion failed for order", { orderId: entry.orderId, error: message });
        failed.push({ orderId: entry.orderId, error: message });
      }
    }

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { updated, failed };
  },

  async recordDeliveryAndPayment(
    db: Db, tenantId: number, actor: Actor,
    input: {
      orderId: number;
      deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      payment: { paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string };
      photos?: string[];
    },
  ) {
    await db.transaction(async (tx) => {
      await applyPartialDelivery(tx, tenantId, actor, {
        orderId: input.orderId,
        items: input.deliveredItems,
        photos: input.photos,
      });
      await applyPartialPayment(tx, tenantId, actor, {
        orderId: input.orderId,
        paidAmount: input.payment.paidAmount,
        method: input.payment.method,
        debtDueDate: input.payment.debtDueDate,
        notes: input.payment.notes,
      });
    });

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

  // ── Get Order Adjustments ──────────────────────────────────────────────────

  async getAdjustments(db: Db, tenantId: number, orderId: number) {
    return db.select({
      id: orderAdjustments.id,
      type: orderAdjustments.type,
      oldValue: orderAdjustments.oldValue,
      newValue: orderAdjustments.newValue,
      reason: orderAdjustments.reason,
      photos: orderAdjustments.photos,
      createdAt: orderAdjustments.createdAt,
      adjustedByName: users.name,
    }).from(orderAdjustments)
      .leftJoin(users, eq(orderAdjustments.adjustedBy, users.id))
      .where(and(eq(orderAdjustments.orderId, orderId), eq(orderAdjustments.tenantId, tenantId)))
      .orderBy(desc(orderAdjustments.createdAt));
  },

  // ── Get Order Payments (extended) ──────────────────────────────────────────

  async getOrderPayments(db: Db, tenantId: number, orderId: number) {
    return db.select({
      id: payments.id,
      amount: payments.amount,
      type: payments.type,
      paymentMethod: payments.paymentMethod,
      status: payments.status,
      totalOrderAmount: payments.totalOrderAmount,
      paidAmount: payments.paidAmount,
      debtAmount: payments.debtAmount,
      debtDueDate: payments.debtDueDate,
      paidAt: payments.paidAt,
      notes: payments.notes,
      createdAt: payments.createdAt,
      createdByName: users.name,
    }).from(payments)
      .leftJoin(users, eq(payments.createdBy, users.id))
      .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt));
  },

};
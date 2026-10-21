import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { purchaseOrders, purchaseOrderItems, supplies, settings } from "@db/schema";
import { businessDay, businessDayStart } from "@contracts/business-time";
import { PURCHASE_ORDER_STATUS_LABEL } from "@contracts/entity-labels";
import { recordAudit } from "./audit-log";
import { productNames, type Db } from "./order-shared";

/*
  Приёмка по заказу поставщику: что происходит с заказом и с долгом, когда
  проводится приход, заведённый по заказу (ADR 0013).

  Отдельный файл, а не часть services/purchase-order.ts: приход зовёт эти
  функции изнутри своего проведения, а заказ сам заводит приход
  (insertArrivalTx). Положи всё в один файл — службы прихода и заказа
  импортировали бы друг друга по кругу. Здесь — то, что нужно приходу, и
  чистые правила, которые проверяются без базы.
*/

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const PO_STATUSES = ["draft", "pending_approval", "approved", "partially_received", "received", "closed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/**
 * Куда заказ может перейти из каждого состояния. Одна таблица на все
 * действия: проверка перехода — здесь, а не условием в каждой процедуре.
 *
 * Кто может сделать переход — решает процедура: согласует (в том числе
 * сразу из черновика) и отклоняет только директор (adminQuery). Правка
 * согласованного заказа возвращает его в черновик: согласовывали не это.
 * Отменить можно то, по чему ничего не принято; принятое частично —
 * только закрыть с недовозом.
 */
export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  draft:              ["pending_approval", "approved", "cancelled"],
  pending_approval:   ["approved", "draft", "cancelled"],
  approved:           ["draft", "partially_received", "received", "cancelled"],
  partially_received: ["received", "closed"],
  received:           [],
  closed:             [],
  cancelled:          [],
};

export function canTransition(from: PoStatus, to: PoStatus): boolean {
  return PO_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * По заказу в этих состояниях можно проводить приход. «Принят» — тоже:
 * второй приход, заведённый, пока заказ был открыт, уже на складе, и
 * отказать ему на разгрузке нельзя — излишек принимается и показывается.
 */
export const RECEIVING_STATUSES: readonly PoStatus[] = ["approved", "partially_received", "received"];

export function poStatusLabel(status: string): string {
  return PURCHASE_ORDER_STATUS_LABEL[status as PoStatus]?.ru.toLowerCase() ?? status;
}

/** Всё ли заказанное принято: да — «принят», нет — «принят частично». */
export function poStatusAfterReceipt(lines: Array<{ quantity: string | number; receivedQty: string | number }>): "received" | "partially_received" {
  // Полкопейки допуска: decimal(12,2) приходит строкой, сумма — числом.
  return lines.every(l => Number(l.receivedQty) >= Number(l.quantity) - 0.005) ? "received" : "partially_received";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Заказ в валюте организации: долг — по себестоимости прихода, а не по цене заказа. */
export function inTenantCurrency(orderCurrency: string, tenantCurrency: string | null | undefined): boolean {
  return orderCurrency === (tenantCurrency ?? "UZS").trim().toUpperCase();
}

/**
 * Цена заказа в валюте организации — то, что ляжет в себестоимость строки
 * прихода и дальше в карточку товара.
 *
 * Курс заказа — сумов за доллар. Пересчитать можно только пару сум–доллар;
 * для третьей валюты организации (рубль) вернётся null: себестоимость
 * впишут руками, а долг всё равно считается по цене заказа.
 */
export function priceInTenantCurrency(price: number, orderCurrency: string, tenantCurrency: string | null | undefined, rateToUzs: number | null): number | null {
  const tc = (tenantCurrency ?? "UZS").trim().toUpperCase();
  if (orderCurrency === tc) return round2(price);
  if (!(rateToUzs != null && rateToUzs > 0)) return null;
  if (orderCurrency === "USD" && tc === "UZS") return round2(price * rateToUzs);
  if (orderCurrency === "UZS" && tc === "USD") return round2(price / rateToUzs);
  return null;
}

/**
 * Срок оплаты: день прихода по Ташкенту плюс отсрочка. Строкой «ГГГГ-ММ-ДД»,
 * а не Date: колонка DATE хранит день, а Date драйвер развернул бы в поясе
 * сервера. Отсрочки нет — срока нет.
 */
export function dueDateAfter(day: string, days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  return businessDay(businessDayStart(day).getTime() + days * 86_400_000);
}

/** Себестоимость строки прихода — decimal(10,2): больше не влезет. */
export const MAX_ARRIVAL_COST = 99_999_999.99;

/** Сумма долга по приёмке — правило ADR 0013, без базы. */
export function receiptDebt(
  counted: Array<{ productId: number; quantity: string | number; costPrice?: string | number | null }>,
  lineByProduct: Map<number, { unitPrice: string | number }>,
  sameCurrency: boolean,
): number {
  let sum = 0;
  for (const it of counted) {
    const qty = Number(it.quantity);
    if (!(qty > 0)) continue;
    const price = sameCurrency ? Number(it.costPrice ?? 0) : Number(lineByProduct.get(it.productId)?.unitPrice ?? 0);
    sum += qty * price;
  }
  return round2(sum);
}

async function tenantCurrency(tx: Tx, tenantId: number): Promise<string> {
  const [cfg] = await tx.select({ currency: settings.currency }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return cfg?.currency ?? "UZS";
}

/** «Товар А», «Товар Б» — для отказа: человек ищет товар по имени, а не по номеру. */
async function namesOf(tx: Tx, tenantId: number, ids: number[]): Promise<string> {
  const names = await productNames(tx, tenantId, ids);
  return ids.map(id => `«${names.get(id) ?? `#${id}`}»`).join(", ");
}

/**
 * Строки прихода по заказу — перед записью (arrival.setItems).
 *
 * Товар не из заказа отказывается здесь, при правке строк, а не при
 * проведении: на проведении это остановило бы склад в худший момент —
 * машина разгружена, а провести нельзя. Лишнее оформляют отдельным приходом.
 *
 * У заказа в чужой валюте себестоимость строки — производная от цены
 * заказа и курса, и руками не правится: по ней же считается долг, и иначе
 * карточка товара и долг поставщику разъехались бы.
 */
export async function linkedArrivalItemsTx<T extends { productId: number; costPrice?: string }>(
  tx: Tx, tenantId: number, purchaseOrderId: number, items: T[],
): Promise<T[]> {
  const [po] = await tx.select({
    id: purchaseOrders.id, number: purchaseOrders.number, currency: purchaseOrders.currency, rateToUzs: purchaseOrders.rateToUzs,
  }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.tenantId, tenantId))).limit(1);
  if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Заказ поставщику не найден" });

  const lines = await tx.select({ productId: purchaseOrderItems.productId, unitPrice: purchaseOrderItems.unitPrice })
    .from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
  const byProduct = new Map(lines.map(l => [Number(l.productId), l]));

  const foreign = items.filter(i => !byProduct.has(i.productId)).map(i => i.productId);
  if (foreign.length > 0) {
    const list = await namesOf(tx, tenantId, foreign);
    throw new TRPCError({ code: "BAD_REQUEST", message: `В заказе ${po.number} нет товара ${list} — по заказу принимают только заказанное, остальное оформите отдельным приходом` });
  }

  const currency = await tenantCurrency(tx, tenantId);
  if (inTenantCurrency(po.currency, currency)) return items;
  const rate = po.rateToUzs == null ? null : Number(po.rateToUzs);
  return items.map(i => {
    const derived = priceInTenantCurrency(Number(byProduct.get(i.productId)!.unitPrice), po.currency, currency, rate);
    return derived == null ? i : { ...i, costPrice: derived.toFixed(2) };
  });
}

/**
 * Замок заказа на проведении прихода по нему — сразу за замком прихода, ДО
 * остатка.
 *
 * Порядок всегда этот: приход, потом заказ. И заказ — раньше склада и
 * карточек товара: два прихода по одному заказу везут одни и те же товары.
 * Когда замок заказа брался в конце, второй приход успевал вставить строку
 * остатка (проверка внешнего ключа ставит общий замок на товар) и ждал
 * первый на строке склада, а первый ждал его на карточке товара — MySQL
 * откатывал один из них как взаимную блокировку. Теперь второй ждёт на
 * заказе, ничего ещё не тронув.
 */
export async function lockReceivingOrderTx(tx: Tx, tenantId: number, purchaseOrderId: number) {
  const [po] = await tx.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
    supplierId: purchaseOrders.supplierId, currency: purchaseOrders.currency, rateToUzs: purchaseOrders.rateToUzs,
    paymentTermsDays: purchaseOrders.paymentTermsDays, updatedAt: purchaseOrders.updatedAt,
  }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.tenantId, tenantId)))
    .for("update").limit(1);
  if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Заказ поставщику не найден" });
  if (!RECEIVING_STATUSES.includes(po.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Заказ ${po.number}: ${poStatusLabel(po.status)} — приход по нему не проводится` });
  }
  return po;
}

export interface ReceiptArrival {
  id: number;
  arrivalNumber: string;
  /** День прихода «ГГГГ-ММ-ДД». */
  arrivalDay: string;
  purchaseOrderId: number;
}

export interface ReceiptActor { id: number; name: string; ip?: string }

/**
 * Приход по заказу проводится: заказ узнаёт, что принято, и рождается долг.
 *
 * Зовётся ИЗНУТРИ транзакции проведения (services/arrival.ts), после того
 * как товар лёг на склад, — одна сделка на остаток и на долг: нет одного без
 * другого. Замки прихода и заказа (lockReceivingOrderTx) вызывающий уже
 * держит; повторный FOR UPDATE здесь ничего не ждёт.
 *
 * Долг (ADR 0013) — на принятое количество:
 *  - заказ в валюте организации: Σ принято × себестоимость строки прихода
 *    (её правят по накладной, она же идёт в карточку товара);
 *  - заказ в другой валюте: Σ принято × цена заказа, по курсу заказа.
 * Излишек входит в долг: он на полке. Срок оплаты — день прихода плюс
 * отсрочка заказа. Не поставщика: заказ берёт её из карточки при заведении,
 * и договаривались на тех условиях; заказ без отсрочки — «по факту»,
 * срока нет. Подставлять сегодняшнюю отсрочку из карточки значило бы
 * молча менять условия уже согласованного заказа.
 *
 * Строка с ценой ноль не проводится: долг на неё не родился бы, а заказ
 * после приёмки уже не править — долг потом не добавить. Согласование
 * заказа без цены не пропускает (services/purchase-order.ts); здесь —
 * себестоимость, стёртая в строке прихода, и последний рубеж.
 */
export async function applyReceiptTx(
  tx: Tx, tenantId: number, arrival: ReceiptArrival,
  items: Array<{ productId: number; quantity: string | number; costPrice?: string | number | null }>,
  actor: ReceiptActor,
): Promise<{ status: PoStatus; supplyId: number | null; amount: number }> {
  const po = await lockReceivingOrderTx(tx, tenantId, arrival.purchaseOrderId);

  const lines = await tx.select({
    id: purchaseOrderItems.id, productId: purchaseOrderItems.productId, quantity: purchaseOrderItems.quantity,
    unitPrice: purchaseOrderItems.unitPrice, receivedQty: purchaseOrderItems.receivedQty,
  }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
  const byProduct = new Map(lines.map(l => [Number(l.productId), l]));

  const counted = items.filter(i => Number(i.quantity) > 0);
  // Строки правят только через setItems, а он чужой товар не пропускает;
  // здесь — последний рубеж на случай пути в обход.
  const foreign = counted.filter(i => !byProduct.has(i.productId)).map(i => i.productId);
  if (foreign.length > 0) {
    const list = await namesOf(tx, tenantId, foreign);
    throw new TRPCError({ code: "BAD_REQUEST", message: `В заказе ${po.number} нет товара ${list} — по заказу принимают только заказанное, остальное оформите отдельным приходом` });
  }

  const currency = await tenantCurrency(tx, tenantId);
  const sameCurrency = inTenantCurrency(po.currency, currency);
  const unpriced = [...new Set(counted
    .filter(i => !(Number(sameCurrency ? i.costPrice ?? 0 : byProduct.get(i.productId)!.unitPrice) > 0))
    .map(i => i.productId))];
  if (unpriced.length > 0) {
    const list = await namesOf(tx, tenantId, unpriced);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sameCurrency
        ? `Приход по заказу ${po.number}: у ${list} себестоимость ноль — впишите цену по накладной, по ней заводится долг поставщику; бесплатный товар оформите отдельным приходом`
        : `Приход по заказу ${po.number}: в заказе нет цены у ${list} — без неё долг поставщику не посчитать`,
    });
  }

  const added = new Map<number, number>();
  for (const it of counted) added.set(it.productId, (added.get(it.productId) ?? 0) + Number(it.quantity));
  for (const [productId, qty] of added) {
    const line = byProduct.get(productId)!;
    // Прибавка в самом запросе, а не «прочитал — записал»: замок заказа и так
    // держим, но выражение не даст потерять прибавку и без него.
    await tx.update(purchaseOrderItems)
      .set({ receivedQty: sql`${purchaseOrderItems.receivedQty} + ${qty.toFixed(2)}` })
      .where(eq(purchaseOrderItems.id, line.id));
  }

  const after = lines.map(l => ({ quantity: l.quantity, receivedQty: Number(l.receivedQty) + (added.get(Number(l.productId)) ?? 0) }));
  // Принятый заказ принятым и остаётся: принятое только растёт.
  const status: PoStatus = po.status === "received" ? "received" : poStatusAfterReceipt(after);
  // Версия документа двигается и без смены статуса: «принято» на экране
  // заказа изменилось, и открытый редактор должен это узнать.
  const version = new Date(Math.max(Date.now(), po.updatedAt.getTime() + 1000));
  await tx.update(purchaseOrders)
    .set({ status, updatedAt: version })
    .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.tenantId, tenantId)));

  // ── Долг ───────────────────────────────────────────────────────────────────
  const amount = receiptDebt(counted, byProduct, sameCurrency);
  const due = dueDateAfter(arrival.arrivalDay, po.paymentTermsDays);

  // Приход по заказу блока поставщика не принимает (createArrival), так что
  // поставки у него быть не должно; если она всё же есть — второй долг за
  // тот же товар не заводим.
  const [existing] = await tx.select({ id: supplies.id }).from(supplies)
    .where(and(eq(supplies.arrivalId, arrival.id), eq(supplies.tenantId, tenantId))).limit(1);
  let supplyId: number | null = existing ? Number(existing.id) : null;
  if (!existing && amount > 0) {
    const [res] = await tx.insert(supplies).values({
      tenantId,
      supplierId:   po.supplierId,
      arrivalId:    arrival.id,
      // Тот же хвост, что у номера прихода: это один документ (как у обычного прихода).
      supplyNumber: `SUP-${arrival.arrivalNumber.replace(/^ARR-/, "")}`,
      amount:       amount.toFixed(2),
      currency:     po.currency,
      rateToUzs:    po.currency === "USD" ? po.rateToUzs : undefined,
      supplyDate:   sql`${arrival.arrivalDay}`,
      dueDate:      due ? sql`${due}` : null,
      notes:        `По заказу ${po.number}`,
      createdBy:    actor.id,
    });
    supplyId = Number(res.insertId);
  }

  await recordAudit(tx as unknown as Db, {
    tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
    action: "purchase_order.received", targetType: "purchase_order", targetId: po.id,
    meta: {
      arrivalNumber: arrival.arrivalNumber, lines: added.size, status,
      debt: `${amount.toFixed(2)} ${po.currency}`, dueDate: due,
    },
  }, { strict: true });

  return { status, supplyId, amount };
}

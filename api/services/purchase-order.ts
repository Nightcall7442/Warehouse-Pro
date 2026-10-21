import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { purchaseOrders, purchaseOrderItems, products, suppliers, warehouses, arrivals, users, settings } from "@db/schema";
import { businessToday } from "@contracts/business-time";
import { isDuplicateOf } from "../lib/db-errors";
import { sanitizeString } from "../lib/sanitize";
import { invalidateReports } from "../lib/report-cache";
import { inBackground } from "../lib/graceful-shutdown";
import { recordAudit } from "./audit-log";
import { insertArrivalTx } from "./arrival";
import { NotificationService } from "./NotificationService";
import {
  canTransition, poStatusLabel, priceInTenantCurrency, MAX_ARRIVAL_COST, type PoStatus,
} from "./purchase-order-receipt";
import type { Db } from "./order-shared";

/*
  Заказ поставщику: завести, править, согласовать, отменить, принять.

  Заказ — договорённость, а не долг (ADR 0013): ни одна функция здесь не
  пишет поставку, платёж поставщику или остаток. Долг рождается при
  проведении прихода по заказу (purchase-order-receipt.applyReceiptTx), товар
  ложится на склад там же, через дверь остатка. Страж —
  purchase-order-never-touches-debt.test.ts.

  Каждое действие — под замком строки заказа: правка, согласование, отмена и
  приёмка не пересекаются. Приход по заказу при проведении запирает сначала
  себя, потом заказ; здесь заказ запирается первым только там, где замка
  прихода не берут вовсе, — порядок один, взаимной блокировки нет.
*/

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PurchaseOrderActor { id: number; name: string; ip?: string }

export interface PurchaseOrderLineInput {
  productId: number;
  quantity: string;
  unitPrice: string;
  note?: string | null;
}

export interface PurchaseOrderInput {
  supplierId: number;
  /** Пусто — основной склад. */
  warehouseId?: number;
  currency: "UZS" | "USD";
  rateToUzs?: string | null;
  /** undefined — отсрочка поставщика; null — без отсрочки. */
  paymentTermsDays?: number | null;
  /** «ГГГГ-ММ-ДД». */
  expectedDate?: string | null;
  notes?: string | null;
  source?: "manual" | "reorder";
  items: PurchaseOrderLineInput[];
}

const own = (id: number, tenantId: number) => and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId));

/** Версия документа — хотя бы на секунду вперёд: колонка хранит секунды. */
const nextVersion = (prev: Date) => new Date(Math.max(Date.now(), prev.getTime() + 1000));

/**
 * Следующий номер «PO-N» организации — как у заказов магазинов
 * (order-shared.nextOrderNumber): под транзакцией создания, окончательную
 * защиту даёт уникальный индекс, на его отказ берётся следующий.
 */
async function nextPurchaseOrderNumber(tx: Tx, tenantId: number): Promise<number> {
  const [row] = await tx.select({
    total: sql<number>`COUNT(*)`,
    maxNumbered: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${purchaseOrders.number}, 4) AS UNSIGNED)), 0)`,
  }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, tenantId));
  return Math.max(Number(row?.total ?? 0), Number(row?.maxNumbered ?? 0)) + 1;
}

async function lockOrder(tx: Tx, tenantId: number, id: number) {
  const [po] = await tx.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
    supplierId: purchaseOrders.supplierId, warehouseId: purchaseOrders.warehouseId,
    currency: purchaseOrders.currency, rateToUzs: purchaseOrders.rateToUzs,
    createdBy: purchaseOrders.createdBy, updatedAt: purchaseOrders.updatedAt,
  }).from(purchaseOrders).where(own(id, tenantId)).for("update").limit(1);
  if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Заказ поставщику не найден" });
  return po;
}

function assertTransition(po: { number: string; status: PoStatus }, to: PoStatus): void {
  if (!canTransition(po.status, to)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Заказ ${po.number}: ${poStatusLabel(po.status)} — перевести его в «${poStatusLabel(to)}» нельзя` });
  }
}

/**
 * Директор согласовывает ту версию, которую видел. Экран присылает её
 * (updatedAt из getById); заказ поменяли после — отказ: иначе «Согласовать»
 * со старого экрана согласовывало бы чужую правку, которую директор не
 * читал (оператор поправил количества — заказ снова черновик, а черновик
 * директор согласует сразу). Без версии (старая вкладка) — как раньше.
 */
function assertSeenVersion(po: { number: string; updatedAt: Date }, seenUpdatedAt?: Date): void {
  if (seenUpdatedAt && po.updatedAt.getTime() !== seenUpdatedAt.getTime()) {
    throw new TRPCError({ code: "CONFLICT", message: `Заказ ${po.number} изменили, пока вы его смотрели — обновите экран и проверьте заказ` });
  }
}

/** «А», «Б» и ещё 3 — отказ называет товары, но не простынёй. */
function namesList(names: string[]): string {
  const head = names.slice(0, 5).map(n => `«${n}»`).join(", ");
  return names.length > 5 ? `${head} и ещё ${names.length - 5}` : head;
}

/**
 * Строки без цены на согласование не идут.
 *
 * Ноль в цене — «цену ещё не знают» (черновик из «Дозаказа» ставит его,
 * когда прежних заказов и себестоимости нет). Черновик с нулём сохранить
 * можно, отправить и согласовать — нет: по цене заказа приёмка считает долг
 * (ADR 0013), и согласованный заказ с нулём принимался без долга, а у
 * долларового заказа ноль ещё и затирал себестоимость прихода.
 */
function assertPriced(po: { number: string }, lines: Array<{ unitPrice: string | number; name: string }>): void {
  const unpriced = lines.filter(l => !(Number(l.unitPrice) > 0)).map(l => l.name);
  if (unpriced.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `В заказе ${po.number} без цены: ${namesList(unpriced)} — впишите цену, по ней при приёмке считается долг поставщику` });
  }
}

/** Строки заказа с названием товара — для проверок перед отправкой и согласованием. */
async function linesWithNames(tx: Tx, tenantId: number, purchaseOrderId: number) {
  return tx.select({ productId: purchaseOrderItems.productId, unitPrice: purchaseOrderItems.unitPrice, name: products.name })
    .from(purchaseOrderItems)
    .innerJoin(products, and(eq(products.id, purchaseOrderItems.productId), eq(products.tenantId, tenantId)))
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))
    .orderBy(purchaseOrderItems.id);
}

/** Приходы по заказу, которые ещё не проведены, — первый по номеру. */
async function openArrival(tx: Tx, tenantId: number, purchaseOrderId: number): Promise<string | null> {
  const [row] = await tx.select({ n: arrivals.arrivalNumber }).from(arrivals)
    .where(and(eq(arrivals.purchaseOrderId, purchaseOrderId), eq(arrivals.tenantId, tenantId), ne(arrivals.status, "completed")))
    .limit(1);
  return row?.n ?? null;
}

/**
 * Шапка и строки — проверка до записи, одна для создания и правки.
 *
 * Поставщик, склад и товары — свои и не выключенные: заказ у выключенного
 * поставщика или на закрытый склад никто не ждёт, а чужой номер — утечка.
 * Один товар — одна строка: две строки одного товара делят приёмку
 * неизвестно как. Отказы называют товар, а не номер в базе.
 */
async function checkInput(tx: Tx, tenantId: number, input: PurchaseOrderInput) {
  const [supplier] = await tx.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status, terms: suppliers.paymentTermsDays })
    .from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, tenantId))).limit(1);
  if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "Поставщик не найден" });
  if (supplier.status !== "active") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Поставщик «${supplier.name}» выключен — включите его или выберите другого` });
  }

  const [warehouse] = input.warehouseId
    ? await tx.select({ id: warehouses.id, name: warehouses.name, status: warehouses.status }).from(warehouses)
      .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.tenantId, tenantId))).limit(1)
    : await tx.select({ id: warehouses.id, name: warehouses.name, status: warehouses.status }).from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  if (!warehouse) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });
  if (warehouse.status !== "active") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Склад «${warehouse.name}» выключен — выберите другой` });
  }

  const ids = input.items.map(i => i.productId);
  const rows = ids.length === 0 ? [] : await tx.select({ id: products.id, name: products.name, status: products.status })
    .from(products).where(and(inArray(products.id, [...new Set(ids)]), eq(products.tenantId, tenantId)));
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const seen = new Set<number>();
  for (const item of input.items) {
    const p = byId.get(item.productId);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: `Товар #${item.productId} не найден в вашей организации` });
    if (seen.has(item.productId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `«${p.name}» встречается в заказе дважды — объедините строки` });
    }
    seen.add(item.productId);
    if (p.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `«${p.name}» снят с продажи — верните его в каталог или уберите из заказа` });
    }
  }

  if (input.rateToUzs != null && input.rateToUzs !== "" && !(Number(input.rateToUzs) > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Курс — положительное число сумов за доллар" });
  }
  return { supplier, warehouse };
}

function headerValues(input: PurchaseOrderInput, supplierTerms: number | null, warehouseId: number) {
  return {
    supplierId:       input.supplierId,
    warehouseId,
    currency:         input.currency,
    rateToUzs:        input.rateToUzs ? input.rateToUzs : null,
    // undefined — «как у поставщика»; null — заказ явно без отсрочки.
    paymentTermsDays: input.paymentTermsDays === undefined ? supplierTerms : input.paymentTermsDays,
    // Строкой, а не Date: колонка DATE хранит день (см. arrival.insertItems).
    expectedDate:     input.expectedDate ? sql`${input.expectedDate}` : null,
    notes:            input.notes ? sanitizeString(input.notes) : null,
  };
}

async function insertLines(tx: Tx, purchaseOrderId: number, items: PurchaseOrderLineInput[]): Promise<void> {
  if (items.length === 0) return;
  await tx.insert(purchaseOrderItems).values(items.map(i => ({
    purchaseOrderId,
    productId: i.productId,
    quantity:  i.quantity,
    unitPrice: i.unitPrice,
    note:      i.note ? sanitizeString(i.note).slice(0, 255) : null,
  })));
}

export async function createPurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, input: PurchaseOrderInput) {
  return db.transaction(tx => createPurchaseOrderTx(tx, tenantId, actor, input));
}

/**
 * Заказ-черновик внутри чужой транзакции: заказ с экрана — одна, черновики
 * из «Дозаказа» — все в одной (или все, или ни одного).
 */
async function createPurchaseOrderTx(tx: Tx, tenantId: number, actor: PurchaseOrderActor, input: PurchaseOrderInput) {
  const { supplier, warehouse } = await checkInput(tx, tenantId, input);
  let n = await nextPurchaseOrderNumber(tx, tenantId);
  let id = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const [res] = await tx.insert(purchaseOrders).values({
        tenantId, number: `PO-${n}`, status: "draft", source: input.source ?? "manual",
        createdBy: actor.id,
        ...headerValues(input, supplier.terms ?? null, warehouse.id),
      });
      id = Number(res.insertId);
      break;
    } catch (e) {
      // Два заказа в одну секунду посчитают один номер — второй берёт следующий.
      if (!isDuplicateOf(e, "uq_po_number_tenant") || attempt >= 4) throw e;
      n += 1;
    }
  }
  await insertLines(tx, id, input.items);
  await recordAudit(tx as unknown as Db, {
    tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
    action: "purchase_order.created", targetType: "purchase_order", targetId: id,
    meta: {
      number: `PO-${n}`, supplier: supplier.name, lines: input.items.length, currency: input.currency,
      ...(input.source === "reorder" ? { fromReorder: true } : {}),
    },
  }, { strict: true });
  return { id, number: `PO-${n}`, supplierName: supplier.name };
}

export interface ReorderGroupInput {
  supplierId: number;
  items: Array<{ productId: number; quantity: string }>;
}

/**
 * Черновики заказов поставщикам из «Дозаказа» — по одному на поставщика.
 *
 * Группы одного поставщика сливаются в один заказ. Всё — одной транзакцией:
 * отказ по одному поставщику (выключен, товар снят с продажи) не оставляет
 * половину черновиков.
 *
 * Валюта — валюта организации (сумы или доллары; иная — сумы). Цена строки —
 * последняя цена этого товара у этого поставщика в этой валюте из прежних
 * заказов; нет такой — себестоимость товара, если она в той же валюте;
 * иначе ноль — «цену ещё не знают», её впишут в черновик. Долга черновик
 * не создаёт (ADR 0013), согласует его директор, как любой другой.
 */
export async function createPurchaseOrdersFromReorder(
  db: Db, tenantId: number, actor: PurchaseOrderActor,
  input: { warehouseId?: number; groups: ReorderGroupInput[] },
) {
  const bySupplier = new Map<number, ReorderGroupInput["items"]>();
  for (const g of input.groups) bySupplier.set(g.supplierId, [...(bySupplier.get(g.supplierId) ?? []), ...g.items]);

  return db.transaction(async (tx) => {
    const [cfg] = await tx.select({ currency: settings.currency }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
    const tenantCurrency = String(cfg?.currency ?? "UZS").toUpperCase();
    const currency: "UZS" | "USD" = tenantCurrency === "USD" ? "USD" : "UZS";

    const allIds = [...new Set(input.groups.flatMap(g => g.items.map(i => i.productId)))];
    const cost = new Map((allIds.length === 0 ? [] : await tx.select({ id: products.id, costPrice: products.costPrice }).from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, allIds))))
      .map(p => [Number(p.id), Number(p.costPrice ?? 0)]));

    const created: Array<{ id: number; number: string; supplierId: number; supplierName: string; lines: number }> = [];
    for (const [supplierId, items] of bySupplier) {
      const ids = items.map(i => i.productId);
      const history = await tx.select({ productId: purchaseOrderItems.productId, unitPrice: purchaseOrderItems.unitPrice })
        .from(purchaseOrderItems)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
        .where(and(
          eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.supplierId, supplierId), eq(purchaseOrders.currency, currency),
          ne(purchaseOrders.status, "cancelled"), sql`${purchaseOrderItems.unitPrice} > 0`, inArray(purchaseOrderItems.productId, ids),
        ))
        .orderBy(sql`${purchaseOrders.createdAt} DESC`, sql`${purchaseOrders.id} DESC`);
      const lastPrice = new Map<number, string>();
      for (const h of history) if (!lastPrice.has(Number(h.productId))) lastPrice.set(Number(h.productId), String(h.unitPrice));

      const order = await createPurchaseOrderTx(tx, tenantId, actor, {
        supplierId, warehouseId: input.warehouseId, currency, source: "reorder",
        items: items.map(i => {
          const own = cost.get(i.productId) ?? 0;
          const price = lastPrice.get(i.productId) ?? (currency === tenantCurrency && own > 0 ? own.toFixed(2) : "0.00");
          return { productId: i.productId, quantity: i.quantity, unitPrice: price };
        }),
      });
      created.push({ id: order.id, number: order.number, supplierId, supplierName: order.supplierName, lines: items.length });
    }
    return { orders: created };
  });
}

/**
 * Шапка и строки заказа — целиком, до приёмки.
 *
 * Согласованный или ждущий согласования заказ после правки возвращается в
 * черновик: директор согласовывал другие числа. Пока по заказу заведён
 * приход, правка закрыта — приход уже ждёт этих строк и этих цен.
 *
 * seenUpdatedAt — версия, с которой открыт документ; правка поверх чужой —
 * отказ, как у прихода.
 */
export async function updatePurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number, input: PurchaseOrderInput, seenUpdatedAt?: Date) {
  return db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    if (seenUpdatedAt && po.updatedAt.getTime() !== seenUpdatedAt.getTime()) {
      throw new TRPCError({ code: "CONFLICT", message: "Документ изменили, пока вы правили — обновите страницу" });
    }
    if (po.status !== "draft") assertTransition(po, "draft");
    const arrival = await openArrival(tx, tenantId, po.id);
    if (arrival) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `По заказу ${po.number} заведён приход ${arrival} — удалите его, чтобы править заказ` });
    }
    const { supplier, warehouse } = await checkInput(tx, tenantId, input);
    const version = nextVersion(po.updatedAt);
    await tx.update(purchaseOrders).set({
      ...headerValues(input, supplier.terms ?? null, warehouse.id),
      status: "draft",
      // Согласие было на прежние числа — снимается вместе с ними.
      approvedBy: null, approvedAt: null, submittedAt: null,
      updatedAt: version,
    }).where(own(po.id, tenantId));
    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
    await insertLines(tx, po.id, input.items);
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: "purchase_order.updated", targetType: "purchase_order", targetId: po.id,
      meta: { ...(po.status !== "draft" ? { from: po.status, to: "draft" } : {}), lines: input.items.length },
    }, { strict: true });
    return { success: true, status: "draft" as const, updatedAt: version };
  });
}

/** Активные директора — им уходит «заказ ждёт согласования». */
async function directors(db: Db, tenantId: number): Promise<number[]> {
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "ceo"), eq(users.status, "active")));
  return rows.map(r => Number(r.id));
}

/** На согласование директору. */
export async function submitPurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number) {
  const po = await db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    assertTransition(po, "pending_approval");
    const lines = await linesWithNames(tx, tenantId, po.id);
    if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: `В заказе ${po.number} нет ни одной строки` });
    // Директору — заказ с ценами: без них ему нечего согласовывать.
    assertPriced(po, lines);
    await tx.update(purchaseOrders).set({ status: "pending_approval", submittedAt: new Date(), rejectNote: null, updatedAt: nextVersion(po.updatedAt) })
      .where(own(po.id, tenantId));
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: "purchase_order.submitted", targetType: "purchase_order", targetId: po.id,
      meta: { from: po.status, to: "pending_approval" },
    }, { strict: true });
    return po;
  });
  // Колокольчик директору — после ответа: заказ уже на согласовании,
  // ждать записи уведомлений оператору незачем.
  inBackground(directors(db, tenantId).then(ids => NotificationService.createBulk(db, {
    tenantId, userIds: ids.filter(u => u !== actor.id), type: "stock",
    title: { ru: `Заказ поставщику ${po.number} ждёт согласования`, uz: `Yetkazib beruvchiga ${po.number} buyurtma kelishuvni kutmoqda` },
    message: { ru: `Отправил: ${actor.name}`, uz: `Yubordi: ${actor.name}` },
    link: `/purchase-orders/${po.id}`,
  })).catch(() => { /* уведомление — не согласование */ }));
  return { success: true, status: "pending_approval" as const };
}

/**
 * Согласовать — директор (adminQuery), в том числе сразу из черновика.
 * Ту версию, что он видел (seenUpdatedAt), и только с ценами в каждой строке.
 *
 * Долларовый заказ без курса не согласуется: по курсу заказа считается долг
 * при приёмке и себестоимость прихода. Себестоимость строки прихода —
 * decimal(10,2), и цена в долларах по курсу обязана в неё поместиться:
 * лучше узнать это сейчас, чем на разгрузке.
 */
export async function approvePurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number, seenUpdatedAt?: Date) {
  const po = await db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    assertSeenVersion(po, seenUpdatedAt);
    assertTransition(po, "approved");
    const lines = await linesWithNames(tx, tenantId, po.id);
    if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: `В заказе ${po.number} нет ни одной строки` });
    assertPriced(po, lines);
    const [supplier] = await tx.select({ name: suppliers.name, status: suppliers.status }).from(suppliers)
      .where(and(eq(suppliers.id, po.supplierId), eq(suppliers.tenantId, tenantId))).limit(1);
    if (supplier && supplier.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Поставщик «${supplier.name}» выключен — включите его или выберите другого` });
    }
    const rate = po.rateToUzs == null ? null : Number(po.rateToUzs);
    if (po.currency === "USD" && !(rate != null && rate > 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Для заказа ${po.number} в долларах укажите курс на день сделки` });
    }
    const [cfg] = await tx.select({ currency: settings.currency }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
    for (const l of lines) {
      const cost = priceInTenantCurrency(Number(l.unitPrice), po.currency, cfg?.currency, rate);
      if (cost != null && cost > MAX_ARRIVAL_COST) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `«${l.name}»: цена по курсу больше, чем помещается в себестоимость прихода — проверьте цену и курс` });
      }
    }
    await tx.update(purchaseOrders).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), rejectNote: null, updatedAt: nextVersion(po.updatedAt) })
      .where(own(po.id, tenantId));
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: "purchase_order.approved", targetType: "purchase_order", targetId: po.id,
      meta: { from: po.status, to: "approved" },
    }, { strict: true });
    return po;
  });
  if (po.createdBy && Number(po.createdBy) !== actor.id) {
    inBackground(NotificationService.create(db, {
      tenantId, userId: Number(po.createdBy), type: "stock",
      title: { ru: `Заказ поставщику ${po.number} согласован`, uz: `Yetkazib beruvchiga ${po.number} buyurtma kelishildi` },
      message: { ru: `Согласовал: ${actor.name}`, uz: `Kelishdi: ${actor.name}` },
      link: `/purchase-orders/${po.id}`,
    }));
  }
  return { success: true, status: "approved" as const };
}

/**
 * Вернуть в черновик с причиной — директор. И ждущий согласования, и уже
 * согласованный: согласие, данное по ошибке, снимается тем же действием,
 * пока по заказу не завели приход.
 */
export async function rejectPurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number, note: string, seenUpdatedAt?: Date) {
  const po = await db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    // Замечание — к той версии, которую директор читал, а не к чужой правке.
    assertSeenVersion(po, seenUpdatedAt);
    assertTransition(po, "draft");
    const arrival = await openArrival(tx, tenantId, po.id);
    if (arrival) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `По заказу ${po.number} заведён приход ${arrival} — сначала удалите его` });
    }
    const reason = sanitizeString(note).slice(0, 500);
    await tx.update(purchaseOrders).set({ status: "draft", rejectNote: reason, approvedBy: null, approvedAt: null, submittedAt: null, updatedAt: nextVersion(po.updatedAt) })
      .where(own(po.id, tenantId));
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: "purchase_order.rejected", targetType: "purchase_order", targetId: po.id,
      meta: { from: po.status, to: "draft", reason },
    }, { strict: true });
    return { ...po, reason };
  });
  if (po.createdBy && Number(po.createdBy) !== actor.id) {
    inBackground(NotificationService.create(db, {
      tenantId, userId: Number(po.createdBy), type: "stock",
      title: { ru: `Заказ поставщику ${po.number} возвращён`, uz: `Yetkazib beruvchiga ${po.number} buyurtma qaytarildi` },
      message: { ru: po.reason, uz: po.reason },
      link: `/purchase-orders/${po.id}`,
    }));
  }
  return { success: true, status: "draft" as const };
}

/**
 * Отменить или закрыть остаток.
 *
 * Ничего не принято — заказ отменяется. Принято частично — закрывается:
 * остальное больше не ждём. Поставок и платежей это не касается: долг —
 * только за принятое, и он уже заведён приёмкой.
 *
 * Пока по заказу есть непроведённый приход — отказ: иначе приход потом
 * провели бы в отменённый заказ.
 */
export async function cancelPurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number, reason?: string) {
  return db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    const to: PoStatus = po.status === "partially_received" ? "closed" : "cancelled";
    assertTransition(po, to);
    const arrival = await openArrival(tx, tenantId, po.id);
    if (arrival) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `По заказу ${po.number} есть непроведённый приход ${arrival} — проведите или удалите его, потом закрывайте заказ` });
    }
    await tx.update(purchaseOrders).set({ status: to, closedAt: new Date(), updatedAt: nextVersion(po.updatedAt) }).where(own(po.id, tenantId));
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: to === "closed" ? "purchase_order.closed" : "purchase_order.cancelled", targetType: "purchase_order", targetId: po.id,
      meta: { from: po.status, to, ...(reason ? { reason: sanitizeString(reason).slice(0, 500) } : {}) },
    }, { strict: true });
    return { success: true, status: to };
  });
}

/**
 * Принять: завести приход по заказу со строками «по накладной» — сколько ещё
 * ждём.
 *
 * Остаток к приёму считается под замком заказа, и приход заводится в той же
 * транзакции (insertArrivalTx): два одновременных «Принять» не заполнят один
 * и тот же остаток дважды. Ждём = заказано − принято − то, что уже ждёт в
 * непроведённых приходах по этому заказу.
 *
 * «Пришло» — нули: сколько приехало, кладовщик впишет при разгрузке.
 * Себестоимость — цена заказа в валюте организации; долга приход до
 * проведения не создаёт, поставщика у него нет — он у заказа.
 */
export async function receivePurchaseOrder(db: Db, tenantId: number, actor: PurchaseOrderActor, id: number, arrivalDate?: string) {
  const created = await db.transaction(async (tx) => {
    const po = await lockOrder(tx, tenantId, id);
    if (po.status !== "approved" && po.status !== "partially_received") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Заказ ${po.number}: ${poStatusLabel(po.status)} — принимать по нему нельзя` });
    }
    const lines = await tx.select({
      productId: purchaseOrderItems.productId, quantity: purchaseOrderItems.quantity,
      unitPrice: purchaseOrderItems.unitPrice, receivedQty: purchaseOrderItems.receivedQty,
    }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));

    // Что уже ждёт в непроведённых приходах: большее из «по накладной» и «пришло».
    const pendingRows = await tx.execute(sql`
      SELECT ai.product_id AS productId, SUM(GREATEST(COALESCE(ai.expected_quantity, 0), ai.quantity)) AS qty
      FROM arrival_items ai JOIN arrivals a ON a.id = ai.arrival_id
      WHERE a.purchase_order_id = ${po.id} AND a.tenant_id = ${tenantId} AND a.status <> 'completed'
      GROUP BY ai.product_id`);
    const [pendingList] = pendingRows as unknown as [Array<{ productId: number; qty: string }>, unknown];
    const pending = new Map((pendingList ?? []).map(r => [Number(r.productId), Number(r.qty)]));

    const [cfg] = await tx.select({ currency: settings.currency }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
    const rate = po.rateToUzs == null ? null : Number(po.rateToUzs);
    const items = lines.flatMap(l => {
      const left = Math.round((Number(l.quantity) - Number(l.receivedQty) - (pending.get(Number(l.productId)) ?? 0)) * 100) / 100;
      if (!(left > 0)) return [];
      const cost = priceInTenantCurrency(Number(l.unitPrice), po.currency, cfg?.currency, rate);
      return [{ productId: Number(l.productId), quantity: "0", expectedQuantity: left.toFixed(2), costPrice: cost == null ? "0.00" : cost.toFixed(2) }];
    });
    if (items.length === 0) {
      const waiting = await openArrival(tx, tenantId, po.id);
      if (waiting) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `По заказу ${po.number} всё, что ещё ждём, уже в приходе ${waiting} — откройте его` });
      }
      throw new TRPCError({ code: "BAD_REQUEST", message: `По заказу ${po.number} всё заказанное уже принято — закройте заказ` });
    }

    const arrival = await insertArrivalTx(tx, tenantId, actor.id, {
      arrivalDate: arrivalDate ?? businessToday(),
      fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      notes: `По заказу ${po.number}`,
      purchaseOrderId: po.id,
      warehouseId: Number(po.warehouseId),
      items,
    });
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, ip: actor.ip,
      action: "purchase_order.receiving", targetType: "purchase_order", targetId: po.id,
      meta: { arrivalNumber: arrival.arrivalNumber, lines: items.length },
    }, { strict: true });
    return { arrivalId: arrival.id, arrivalNumber: arrival.arrivalNumber };
  });
  // Как у обычного прихода: «Расходы прихода» считают по дате создания.
  await invalidateReports(tenantId, "arrival");
  return created;
}

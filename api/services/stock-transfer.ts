import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { warehouses, warehouseStock, stockTransfers, stockTransferDocs, products, settings, users, markdowns } from "@db/schema";
import {
  BatchPickError, NotMovableError, ensureStockRows, expiredByProduct, moveOut, receiveStock,
  type BatchPick, type BatchRef, type BatchSlice,
} from "./stock-ledger";
import { planBatchRows } from "./loading-list";
import { recordAudit } from "./audit-log";
import { badRequest } from "../lib/errors";
import { invalidateReports } from "../lib/report-cache";
import { isDuplicateEntry } from "../lib/db-errors";
import { assertProductsBelongToTenant } from "../lib/tenant-refs";
import { needsStockApproval } from "../lib/role-permissions";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Actor = { id: number; name?: string; role: string };

export type TransferMode = "instant" | "transit";

export interface TransferInput {
  fromWarehouseId: number;
  toWarehouseId: number;
  /**
   * Позиции. picks — партии, выбранные вручную (batchId null — остаток без
   * партии); количество тогда — их сумма. Без picks — FEFO.
   */
  items: Array<{ productId: number; quantity: number; picks?: BatchPick[] | null }>;
  notes?: string | null;
  /** Не задан — по настройке организации (settings.transfer_two_step). */
  mode?: TransferMode;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ПЕРЕМЕЩЕНИЕ МЕЖДУ СКЛАДАМИ — ДОКУМЕНТ

   ── Что было ────────────────────────────────────────────────────────────────

   До 16.09.2026 — по одному товару, «создать» → «принять», между шагами товар
   нигде, и только директор. Владелец: «цепочка раздражает» — стал документ в
   один шаг: много позиций, товар сразу на складе-получателе, делает и оператор
   с правом «warehouse.adjust».

   Но партии при этом терялись: со склада товар списывался по FEFO, а на
   склад-получатель ложился без партии и без срока («ponytail» в прежнем коде).
   Отчёт «что сгорает», FEFO и запрет продавать просрочку на складе-получателе
   этого товара не видели.

   ── Как теперь ──────────────────────────────────────────────────────────────

   Документ с номером («ПМ-12»). Строка — часть партии: дверь остатка отдаёт,
   какие партии ушли (moveOut), и каждая ложится на склад-получатель той же
   партией — с номером, сроком и себестоимостью. Партии можно выбрать вручную
   (например, увезти сгоревшую на склад списания); без выбора — FEFO, и
   просрочка по FEFO не уезжает.

   Два режима. instant — как решил владелец: товар сразу принят. transit — по
   настройке организации: товар ушёл со склада и «в пути», пока получатель не
   примет его по строкам (не больше отправленного). Недоехавшее остаётся на
   документе недостачей — в журнале, у директора в уведомлениях и в оценке
   склада. Отменить можно только то, что ещё в пути: товар вернётся на
   склад-отправитель теми же партиями.

   ── Порядок замков ──────────────────────────────────────────────────────────

   Документ → строки остатка (склад, товар — по возрастанию) → партии. Заказы
   берут заказ → остаток → магазин; с ними это не пересекается. Строки остатка
   обоих складов при мгновенном перемещении берутся ОДНИМ порядком: иначе
   встречные документы A→B и B→A одного товара ждали бы друг друга. Строки
   склада-получателя для этого заводятся заранее (ensureStockRows).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Режим по умолчанию — из настроек организации. */
export async function transferMode(db: Db | Tx, tenantId: number): Promise<TransferMode> {
  const [row] = await db.select({ twoStep: settings.transferTwoStep }).from(settings)
    .where(eq(settings.tenantId, tenantId)).limit(1);
  return row?.twoStep ? "transit" : "instant";
}

/**
 * Следующий номер документа: «ПМ-1», «ПМ-2», …
 *
 * Как у заказа (nextOrderNumber): большее из числа документов и максимума
 * выданных номеров — чтобы номера не поехали назад. Окончательную защиту от
 * совпадения даёт уникальный индекс, и вызывающий на его ошибку берёт
 * следующий номер.
 */
async function nextTransferNumber(tx: Tx, tenantId: number): Promise<number> {
  const [row] = await tx.select({
    total: sql<number>`COUNT(*)`,
    maxNumbered: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${stockTransferDocs.number}, 4) AS UNSIGNED)), 0)`,
  }).from(stockTransferDocs).where(eq(stockTransferDocs.tenantId, tenantId));
  return Math.max(Number(row?.total ?? 0), Number(row?.maxNumbered ?? 0)) + 1;
}

const PREFIX = "ПМ-";

/** Партия строки — для двери: без номера и срока это остаток без партии. */
function batchOf(line: { batchNumber: string | null; expiresAt: string | null; batchCost: string | null; arrivalItemId: number | null }): BatchRef | null {
  if (!line.batchNumber && !line.expiresAt) return null;
  return { batchNumber: line.batchNumber, expiresAt: line.expiresAt, costPrice: line.batchCost, arrivalItemId: line.arrivalItemId };
}

const sliceLine = (s: BatchSlice) => ({
  batchNumber: s.batchNumber, expiresAt: s.expiresAt, batchCost: s.costPrice, arrivalItemId: s.arrivalItemId,
});

/** Отказ двери — словами, с названием товара. */
function refusal(e: unknown, name: string): unknown {
  if (e instanceof NotMovableError) {
    if (e.expired > 0) {
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `«${name}»: на складе-отправителе свободно ${e.available}, из них ${e.expired} просрочено — переместить можно ${e.movable}, а в документе ${e.quantity}`,
      });
    }
    return badRequest(`Недостаточно товара на складе отправителе: ${name}`);
  }
  if (e instanceof BatchPickError) {
    return new TRPCError({ code: "BAD_REQUEST", message: `«${name}»: в выбранной партии ${e.has}, а выбрано ${e.want} — обновите список партий` });
  }
  return e;
}

/** Оба склада — свои и действующие. Чужой склад-получатель раньше не проверялся вовсе. */
async function ownWarehouses(db: Db | Tx, tenantId: number, ids: number[]): Promise<Map<number, string>> {
  const rows = await db.select({ id: warehouses.id, name: warehouses.name, status: warehouses.status }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, ids)));
  const byId = new Map(rows.map(w => [w.id, w]));
  for (const id of ids) {
    const w = byId.get(id);
    if (!w) throw badRequest("Склад не найден");
    if (w.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Склад «${w.name}» отключён — перемещать с него и на него нельзя` });
    }
  }
  return new Map(rows.map(w => [w.id, w.name]));
}

/** Строки остатка — под замком, по возрастанию товара. */
async function lockStock(tx: Tx, tenantId: number, warehouseId: number, productIds: number[]): Promise<void> {
  if (productIds.length === 0) return;
  await tx.select({ id: warehouseStock.id }).from(warehouseStock)
    .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId), inArray(warehouseStock.productId, productIds)))
    .orderBy(asc(warehouseStock.productId))
    .for("update");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Провести документ перемещения: товар уходит со склада-отправителя теми
 * партиями, которые взял, и — в режиме instant — сразу ложится на получателя
 * ими же; в режиме transit — остаётся «в пути» до приёмки.
 */
export async function transferStock(db: Db, tenantId: number, actor: Actor, input: TransferInput): Promise<{
  id: number; number: string; ids: number[]; count: number; fromName: string; toName: string; mode: TransferMode;
  status: "in_transit" | "received";
}> {
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Нельзя перемещать товар на тот же склад");
  // Одна позиция — одна строка: повтор товара в документе сложил бы его дважды.
  const seen = new Set<number>();
  for (const it of input.items) {
    if (seen.has(it.productId)) throw badRequest("Товар повторяется в документе");
    seen.add(it.productId);
  }
  const productIds = [...seen].sort((a, b) => a - b);

  const names = await ownWarehouses(db, tenantId, [input.fromWarehouseId, input.toWarehouseId]);
  const fromName = names.get(input.fromWarehouseId)!, toName = names.get(input.toWarehouseId)!;
  await assertProductsBelongToTenant(db, tenantId, productIds);
  const productRows = await db.select({ id: products.id, name: products.name }).from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)));
  const nameOf = new Map(productRows.map(p => [p.id, p.name]));

  // Выбранные партии в сумме — это и есть количество строки; расхождение — ошибка экрана, а не «возьмём сколько-нибудь».
  for (const it of input.items) {
    if (!it.picks || it.picks.length === 0) continue;
    const total = round2(it.picks.reduce((sum, p) => sum + p.quantity, 0));
    if (Math.abs(total - it.quantity) > 1e-9) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `«${nameOf.get(it.productId) ?? ""}»: выбранные партии в сумме ${total}, а в строке ${it.quantity}` });
    }
  }

  const mode = input.mode ?? await transferMode(db, tenantId);
  // Пустые строки получателя — до транзакции (см. ensureStockRows).
  await ensureStockRows(db, { tenantId, warehouseId: input.toWarehouseId, productIds });

  const done = await db.transaction(async (tx) => {
    let n = await nextTransferNumber(tx, tenantId);
    let docId = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const [res] = await tx.insert(stockTransferDocs).values({
          tenantId, number: `${PREFIX}${n}`, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId,
          mode, status: mode === "instant" ? "received" : "in_transit", notes: input.notes ?? null, createdBy: actor.id,
          receivedBy: mode === "instant" ? actor.id : null, receivedAt: mode === "instant" ? new Date() : null,
        });
        docId = Number(res.insertId);
        break;
      } catch (err) {
        // Два документа в одну секунду посчитают один номер — второй берёт следующий.
        if (!isDuplicateEntry(err) || attempt >= 4) throw err;
        n += 1;
      }
    }
    const number = `${PREFIX}${n}`;

    const lockOrder = mode === "instant" ? [input.fromWarehouseId, input.toWarehouseId].sort((a, b) => a - b) : [input.fromWarehouseId];
    for (const wh of lockOrder) await lockStock(tx, tenantId, wh, productIds);

    const ids: number[] = [];
    let total = 0;
    const items = [...input.items].sort((a, b) => a.productId - b.productId);
    for (const it of items) {
      const name = nameOf.get(it.productId) ?? "";
      let slices: BatchSlice[];
      try {
        slices = await moveOut(tx, {
          tenantId, warehouseId: input.fromWarehouseId, productId: it.productId, quantity: it.quantity,
          picks: it.picks ?? null, reason: "transfer_doc_out", referenceId: docId,
          notes: `${number}: на склад «${toName}»`,
        });
      } catch (e) {
        throw refusal(e, name);
      }
      total += it.quantity;

      for (const slice of slices) {
        const [line] = await tx.insert(stockTransfers).values({
          tenantId, docId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId,
          productId: it.productId, quantity: slice.quantity.toFixed(2), ...sliceLine(slice),
          // «pending» строке документа не ставится никогда: его провёл бы прежний completeTransfer.
          status: mode === "instant" ? "completed" : "in_transit",
          receivedQuantity: mode === "instant" ? slice.quantity.toFixed(2) : null,
          completedAt: mode === "instant" ? new Date() : null,
          notes: input.notes ?? null, createdBy: actor.id,
        });
        ids.push(Number(line.insertId));
        if (mode === "instant") {
          await receiveStock(tx, {
            tenantId, warehouseId: input.toWarehouseId, productId: it.productId, quantity: slice.quantity,
            reason: "transfer_doc_in", referenceId: docId, notes: `${number}: со склада «${fromName}»`,
            batch: batchOf(sliceLine(slice)),
          });
        }
      }
    }

    const meta = { number, fromWarehouse: fromName, toWarehouse: toName, items: input.items.length, quantity: round2(total), notes: input.notes ?? undefined };
    if (mode === "instant") {
      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_completed",
        targetType: "stock_transfer_doc", targetId: docId, meta,
      }, { strict: true });
    } else {
      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_shipped",
        targetType: "stock_transfer_doc", targetId: docId, meta,
      }, { strict: true });
    }

    return { id: docId, number, ids, count: input.items.length, fromName, toName, mode, status: mode === "instant" ? "received" as const : "in_transit" as const };
  });
  // Остаток основного склада — в каталоге агента (lib/cache: withTenantDataCache)
  // и в отчётах: после коммита, иначе ушедшее «в наличии» висело ещё три минуты.
  await invalidateReports(tenantId, "stock.transfer");
  return done;
}

/** Документ под замком; чужой и несуществующий — одно и то же «не найдено». */
async function lockDoc(tx: Tx, tenantId: number, docId: number) {
  const [doc] = await tx.select().from(stockTransferDocs)
    .where(and(eq(stockTransferDocs.id, docId), eq(stockTransferDocs.tenantId, tenantId)))
    .for("update").limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Перемещение не найдено" });
  if (doc.status !== "in_transit") {
    throw new TRPCError({ code: "CONFLICT", message: `Перемещение ${doc.number} уже принято или отменено — обновите список` });
  }
  return doc;
}

async function docLines(tx: Tx, tenantId: number, docId: number) {
  return tx.select({
    id: stockTransfers.id, productId: stockTransfers.productId, quantity: stockTransfers.quantity,
    batchNumber: stockTransfers.batchNumber, expiresAt: stockTransfers.expiresAt, batchCost: stockTransfers.batchCost,
    arrivalItemId: stockTransfers.arrivalItemId, name: products.name, costPrice: products.costPrice,
  }).from(stockTransfers)
    .innerJoin(products, and(eq(products.id, stockTransfers.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.docId, docId)))
    .orderBy(asc(stockTransfers.productId), asc(stockTransfers.id));
}

/**
 * Принять перемещение «в пути» на складе-получателе — по строкам.
 *
 * Принять можно не больше отправленного: лишнее на полке — это либо пересорт,
 * либо чужой товар, и разбирается оно инвентаризацией, а не приёмкой. Меньше —
 * можно: недоехавшее остаётся на документе недостачей (по себестоимости
 * партии, иначе карточки), уходит в журнал строгой записью и директору в
 * уведомления. Движения при этом честные: со склада-отправителя ушло
 * отправленное, на получатель пришло принятое.
 *
 * Недостача — то же списание, что ручная правка: товар уходит из учёта без
 * встречного документа. Поэтому оператор, которому директор закрыл
 * «проводить правку без утверждения» (warehouse.apply), её не проводит:
 * иначе «в пути» и «приехало 0» списывали бы мимо утверждения. Он принимает
 * документ, только если приехало всё; с недостачей его принимает директор
 * (или оператор с правом) — товар до тех пор виден «в пути».
 */
export async function receiveTransfer(db: Db, tenantId: number, actor: Actor, input: {
  docId: number; lines?: Array<{ lineId: number; receivedQuantity: number }>;
}): Promise<{ number: string; status: "received" | "received_short"; shortageQty: number; shortageCost: number }> {
  const mayWriteOff = !(await needsStockApproval(db, tenantId, actor.role));
  const result = await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, tenantId, input.docId);
    const lines = await docLines(tx, tenantId, doc.id);
    const names = await ownWarehouses(tx, tenantId, [doc.fromWarehouseId, doc.toWarehouseId]).catch(() => new Map<number, string>());
    const fromName = names.get(doc.fromWarehouseId) ?? "";

    const asked = new Map<number, number>();
    for (const l of input.lines ?? []) {
      if (!lines.some(x => x.id === l.lineId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "В документе нет такой строки — обновите список" });
      }
      asked.set(l.lineId, l.receivedQuantity);
    }

    // Сначала проверка всех строк — до первого движения.
    const plan = lines.map(line => {
      const shipped = Number(line.quantity);
      const got = round2(asked.get(line.id) ?? shipped);
      if (!(got >= 0) || got > shipped + 1e-9) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `«${line.name}»: принято ${got}, а отправлено ${shipped}. Больше отправленного принять нельзя — лишнее оформите инвентаризацией` });
      }
      return { line, shipped, got };
    });
    if (!mayWriteOff && plan.some(p => p.got < p.shipped - 1e-9)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Недостачу при приёмке проводит руководитель: ${doc.number} можно принять, только если приехало всё. Оставьте документ в пути и сообщите руководителю`,
      });
    }

    await lockStock(tx, tenantId, doc.toWarehouseId, [...new Set(lines.map(l => l.productId))].sort((a, b) => a - b));

    let shortageQty = 0, shortageCost = 0, received = 0;
    // Недоехавшее — по товарам: «15 ед.» из 10 кг сахара и 5 бутылок воды ничего не значит.
    const shortBy = new Map<string, number>();
    for (const { line, shipped, got } of plan) {
      if (got > 0) {
        await receiveStock(tx, {
          tenantId, warehouseId: doc.toWarehouseId, productId: line.productId, quantity: got,
          reason: "transfer_doc_in", referenceId: doc.id, notes: `${doc.number}: со склада «${fromName}»`,
          batch: batchOf(line),
        });
      }
      await tx.update(stockTransfers).set({ receivedQuantity: got.toFixed(2), status: "completed", completedAt: new Date() })
        .where(and(eq(stockTransfers.id, line.id), eq(stockTransfers.tenantId, tenantId)));
      received += got;
      const lost = round2(shipped - got);
      if (lost > 0) {
        shortageQty += lost;
        shortageCost += lost * Number(line.batchCost ?? line.costPrice ?? 0);
        shortBy.set(line.name, round2((shortBy.get(line.name) ?? 0) + lost));
      }
    }
    shortageQty = round2(shortageQty);
    shortageCost = round2(shortageCost);
    const status = shortageQty > 0 ? "received_short" as const : "received" as const;
    await tx.update(stockTransferDocs).set({
      status, receivedBy: actor.id, receivedAt: new Date(), shortageCost: shortageQty > 0 ? shortageCost.toFixed(2) : null,
    }).where(and(eq(stockTransferDocs.id, doc.id), eq(stockTransferDocs.tenantId, tenantId)));

    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_received",
      targetType: "stock_transfer_doc", targetId: doc.id,
      meta: {
        number: doc.number, fromWarehouse: fromName, toWarehouse: names.get(doc.toWarehouseId) ?? "",
        lines: lines.length, quantity: round2(received),
        shortageQty: shortageQty > 0 ? shortageQty : undefined, shortageCost: shortageQty > 0 ? shortageCost : undefined,
      },
    }, { strict: true });

    const short = [...shortBy].map(([name, qty]) => `${name}: ${qty}`);
    return { number: doc.number, status, shortageQty, shortageCost, short, fromName, toName: names.get(doc.toWarehouseId) ?? "" };
  });
  await invalidateReports(tenantId, "stock.transfer");

  if (result.shortageQty > 0) {
    // Уведомление — не приёмка: товар уже принят, и сбой колокольчика не должен выглядеть отказом.
    try {
      const ceo = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "ceo"), eq(users.status, "active")));
      if (ceo.length > 0) {
        const { NotificationService } = await import("./NotificationService");
        const sum = String(Math.round(result.shortageCost)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        await NotificationService.createBulk(db, {
          tenantId, userIds: ceo.map(u => u.id), type: "stock",
          title: { ru: `Недостача при перемещении ${result.number}`, uz: `${result.number} ko'chirishda kamomad` },
          message: {
            ru: `«${result.fromName}» → «${result.toName}»: не доехало на ${sum} по себестоимости — ${result.short.join("; ")}`.slice(0, 500),
            uz: `«${result.fromName}» → «${result.toName}»: tannarx bo'yicha ${sum} lik tovar yetib kelmadi — ${result.short.join("; ")}`.slice(0, 500),
          },
          link: "/warehouse?tab=transfers",
        });
      }
    } catch (e) {
      logger.warn("transfer shortage notification failed", { tenantId, number: result.number, error: String(e) });
    }
  }
  return { number: result.number, status: result.status, shortageQty: result.shortageQty, shortageCost: result.shortageCost };
}

/**
 * Отменить перемещение, которое ещё в пути: товар возвращается на
 * склад-отправитель теми же партиями, которыми ушёл.
 *
 * Принятое не отменяется: товар уже лежит на другом складе, и вернуть его —
 * это новое перемещение обратно, со своим документом.
 */
export async function cancelTransfer(db: Db, tenantId: number, actor: Actor, input: { docId: number }): Promise<{ number: string }> {
  const done = await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, tenantId, input.docId);
    const lines = await docLines(tx, tenantId, doc.id);
    await lockStock(tx, tenantId, doc.fromWarehouseId, [...new Set(lines.map(l => l.productId))].sort((a, b) => a - b));
    let quantity = 0;
    for (const line of lines) {
      await receiveStock(tx, {
        tenantId, warehouseId: doc.fromWarehouseId, productId: line.productId, quantity: line.quantity,
        reason: "transfer_doc_in", referenceId: doc.id, notes: `${doc.number}: отменено — товар вернулся`,
        batch: batchOf(line),
      });
      quantity += Number(line.quantity);
    }
    await tx.update(stockTransfers).set({ status: "cancelled" })
      .where(and(eq(stockTransfers.docId, doc.id), eq(stockTransfers.tenantId, tenantId)));
    await tx.update(stockTransferDocs).set({ status: "cancelled", cancelledBy: actor.id, cancelledAt: new Date() })
      .where(and(eq(stockTransferDocs.id, doc.id), eq(stockTransferDocs.tenantId, tenantId)));
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_cancelled",
      targetType: "stock_transfer_doc", targetId: doc.id,
      meta: { number: doc.number, lines: lines.length, quantity: round2(quantity) },
    }, { strict: true });
    return { number: doc.number };
  });
  await invalidateReports(tenantId, "stock.transfer");
  return done;
}

/**
 * Провести строку, застрявшую «в пути» до перехода на документы.
 *
 * Такие строки товар ещё не двигали, поэтому идут тем же путём, что и
 * документ: со склада — партиями, которые взяла дверь, на получатель — ими же.
 * Строки документов (doc_id задан) сюда не попадают никогда: у них свой путь.
 */
export async function completeLegacyTransfer(db: Db, tenantId: number, actor: Actor, transferId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Замок на строке: два одновременных вызова встают в очередь, и только
    // первый видит «pending».
    const [transfer] = await tx.select().from(stockTransfers)
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.tenantId, tenantId), isNull(stockTransfers.docId)))
      .for("update").limit(1);
    if (!transfer || transfer.status !== "pending") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Перемещение не найдено или уже выполнено" });
    }

    const [lockedStock] = await tx.select().from(warehouseStock)
      .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, transfer.fromWarehouseId), eq(warehouseStock.productId, transfer.productId)))
      .for("update");
    if (!lockedStock || Number(lockedStock.available) < Number(transfer.quantity)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Недостаточно товара на складе отправителе" });
    }

    let slices: BatchSlice[];
    try {
      slices = await moveOut(tx, {
        tenantId, warehouseId: transfer.fromWarehouseId, productId: transfer.productId, quantity: transfer.quantity,
        reason: "transfer_out", referenceId: transferId, notes: "Перемещение на другой склад",
      });
    } catch (e) {
      const [p] = await tx.select({ name: products.name }).from(products)
        .where(and(eq(products.id, transfer.productId), eq(products.tenantId, tenantId))).limit(1);
      throw refusal(e, p?.name ?? "");
    }
    for (const slice of slices) {
      await receiveStock(tx, {
        tenantId, warehouseId: transfer.toWarehouseId, productId: transfer.productId, quantity: slice.quantity,
        reason: "transfer_in", referenceId: transferId, notes: "Перемещение с другого склада",
        batch: batchOf(sliceLine(slice)),
      });
    }

    const [updateResult] = await tx.update(stockTransfers)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.status, "pending")));
    if ((updateResult as { affectedRows?: number }).affectedRows !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Перемещение уже было выполнено" });
    }
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_completed",
      targetType: "stock_transfer", targetId: transferId,
      meta: { fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, productId: transfer.productId, quantity: transfer.quantity },
    }, { strict: true });
  });
  await invalidateReports(tenantId, "stock.transfer");
}

export type TransferDocStatus = "in_transit" | "received" | "received_short" | "cancelled";

/**
 * Документы перемещений со строками — для раздела «Перемещения».
 *
 * Себестоимость партий здесь есть: раздел открыт директору и оператору, тем
 * же, кому её показывает список остатков.
 */
export async function listTransferDocs(db: Db, tenantId: number, input: { status: TransferDocStatus | "all"; limit: number }) {
  const creator = alias(users, "creator");
  const receiver = alias(users, "receiver");
  const conditions = [eq(stockTransferDocs.tenantId, tenantId)];
  if (input.status !== "all") conditions.push(eq(stockTransferDocs.status, input.status));
  const docs = await db.select({
    id: stockTransferDocs.id, number: stockTransferDocs.number,
    fromWarehouseId: stockTransferDocs.fromWarehouseId, toWarehouseId: stockTransferDocs.toWarehouseId,
    mode: stockTransferDocs.mode, status: stockTransferDocs.status, notes: stockTransferDocs.notes,
    shortageCost: stockTransferDocs.shortageCost,
    createdAt: stockTransferDocs.createdAt, receivedAt: stockTransferDocs.receivedAt, cancelledAt: stockTransferDocs.cancelledAt,
    createdByName: creator.name, receivedByName: receiver.name,
  }).from(stockTransferDocs)
    .leftJoin(creator, and(eq(creator.id, stockTransferDocs.createdBy), eq(creator.tenantId, tenantId)))
    .leftJoin(receiver, and(eq(receiver.id, stockTransferDocs.receivedBy), eq(receiver.tenantId, tenantId)))
    .where(and(...conditions))
    .orderBy(desc(stockTransferDocs.createdAt), desc(stockTransferDocs.id))
    .limit(input.limit);
  if (docs.length === 0) return [];

  const lines = await db.select({
    id: stockTransfers.id, docId: stockTransfers.docId, productId: stockTransfers.productId,
    productName: products.name, unit: products.unit,
    quantity: stockTransfers.quantity, receivedQuantity: stockTransfers.receivedQuantity,
    batchNumber: stockTransfers.batchNumber, expiresAt: stockTransfers.expiresAt, batchCost: stockTransfers.batchCost,
    costPrice: products.costPrice,
  }).from(stockTransfers)
    .innerJoin(products, and(eq(products.id, stockTransfers.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(stockTransfers.tenantId, tenantId), inArray(stockTransfers.docId, docs.map(d => d.id))))
    .orderBy(asc(products.name), asc(stockTransfers.id));

  const byDoc = new Map<number, typeof lines>();
  for (const l of lines) byDoc.set(Number(l.docId), [...(byDoc.get(Number(l.docId)) ?? []), l]);
  return docs.map(d => {
    const own = byDoc.get(d.id) ?? [];
    const quantity = round2(own.reduce((sum, l) => sum + Number(l.quantity), 0));
    const received = own.every(l => l.receivedQuantity != null)
      ? round2(own.reduce((sum, l) => sum + Number(l.receivedQuantity), 0)) : null;
    return {
      ...d,
      quantity,
      receivedQuantity: received,
      shortageQty: received == null ? 0 : round2(quantity - received),
      lines: own.map(l => ({
        id: l.id, productId: l.productId, productName: l.productName, unit: l.unit,
        quantity: Number(l.quantity), receivedQuantity: l.receivedQuantity == null ? null : Number(l.receivedQuantity),
        batchNumber: l.batchNumber, expiresAt: l.expiresAt,
        unitCost: l.batchCost != null ? Number(l.batchCost) : Number(l.costPrice ?? 0),
      })),
    };
  });
}

/**
 * Что уйдёт по FEFO — до проведения: партии, сроки, сколько годного.
 *
 * Тот же порядок, что у двери (planBatchRows): кладовщик видит ровно то, что
 * она возьмёт. И уценки партий этих товаров на складе-отправителе — чтобы
 * экран предупредил: уценка живёт, пока жива партия, и партия, ушедшая
 * целиком, уносит её с собой (цена вернётся к обычной).
 */
export async function previewTransfer(db: Db, tenantId: number, input: { fromWarehouseId: number; items: Array<{ productId: number; quantity: number }> }) {
  await ownWarehouses(db, tenantId, [input.fromWarehouseId]);
  const ids = [...new Set(input.items.map(i => i.productId))];
  await assertProductsBelongToTenant(db, tenantId, ids);
  if (ids.length === 0) return { items: [], markdowns: [] };

  const stock = await db.select({ productId: warehouseStock.productId, current: warehouseStock.currentStock, available: warehouseStock.available })
    .from(warehouseStock)
    .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, input.fromWarehouseId), inArray(warehouseStock.productId, ids)));
  const stockOf = new Map(stock.map(r => [r.productId, r]));
  const expired = await expiredByProduct(db, tenantId, input.fromWarehouseId, ids);
  const plan = await planBatchRows(db, tenantId, input.fromWarehouseId, new Map(input.items.map(i => [i.productId, i.quantity])));

  const marked = await db.execute(sql`
    SELECT m.batch_id AS batchId, m.product_id AS productId, m.price, DATE_FORMAT(m.ends_on, '%Y-%m-%d') AS endsOn, b.quantity AS batchQuantity
    FROM ${markdowns} m
    INNER JOIN stock_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id
    WHERE m.tenant_id = ${tenantId} AND b.warehouse_id = ${input.fromWarehouseId}
      AND m.product_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
  `);
  const [markRows] = marked as unknown as [Array<{ batchId: number; productId: number; price: string; endsOn: string; batchQuantity: string }>];

  return {
    items: input.items.map(i => {
      const st = stockOf.get(i.productId);
      const available = Number(st?.available ?? 0);
      const rotten = expired.get(i.productId) ?? 0;
      const planned = plan.get(i.productId) ?? [];
      const inPlan = round2(planned.reduce((sum, b) => sum + b.qty, 0));
      return {
        productId: i.productId,
        available,
        expired: rotten,
        movable: round2(Math.max(0, available - rotten)),
        planned: planned.map(b => ({
          batchId: b.batchId, batchNumber: b.batch, expiresAt: b.expires, quantity: b.qty,
          batchQuantity: b.batchQty, usesUp: b.qty + 1e-9 >= b.batchQty,
        })),
        // Не хватило годных партий — остальное по FEFO уйдёт из остатка без партии.
        untracked: round2(Math.max(0, i.quantity - inPlan)),
      };
    }),
    markdowns: (markRows ?? []).map(m => ({
      batchId: Number(m.batchId), productId: Number(m.productId), price: Number(m.price), endsOn: m.endsOn, batchQuantity: Number(m.batchQuantity),
    })),
  };
}

/**
 * Сколько товара сейчас «в пути» — по товарам; со складом — только едущее НА него.
 *
 * Нужно двум местам. Средняя себестоимость при приходе (arrival.ts) считается
 * от остатка по всем складам, а едущий товар со склада уже ушёл и ни на какой
 * ещё не пришёл — без этого числа он выпадал бы из среднего. И список остатков
 * показывает получателю, что к нему едет.
 */
export async function inTransitByProduct(db: Db | Tx, tenantId: number, productIds: number[], toWarehouseId?: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (productIds.length === 0) return out;
  const rows = await db.select({
    productId: stockTransfers.productId,
    qty: sql<string>`COALESCE(SUM(${stockTransfers.quantity}), 0)`,
  }).from(stockTransfers)
    .innerJoin(stockTransferDocs, and(eq(stockTransferDocs.id, stockTransfers.docId), eq(stockTransferDocs.tenantId, tenantId)))
    .where(and(
      eq(stockTransfers.tenantId, tenantId),
      eq(stockTransferDocs.status, "in_transit"),
      inArray(stockTransfers.productId, productIds),
      ...(toWarehouseId ? [eq(stockTransferDocs.toWarehouseId, toWarehouseId)] : []),
    ))
    .groupBy(stockTransfers.productId);
  for (const r of rows) out.set(Number(r.productId), Number(r.qty));
  return out;
}

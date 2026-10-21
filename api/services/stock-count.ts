import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { products, stockCountItems, stockCounts, users, warehouses, warehouseStock } from "@db/schema";
import {
  applyStockEffect, receiveStock, recordStockMovement, setStock, StockBelowReserveError,
  type StockMovementReason,
} from "./stock-ledger";
import { recordAudit } from "./audit-log";
import { cache } from "../lib/cache";
import { invalidateReports } from "../lib/report-cache";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Actor = { id: number; name: string };

/* ═══════════════════════════════════════════════════════════════════════════
   ИНВЕНТАРИЗАЦИЯ И ПРАВКА ОСТАТКА — С УТВЕРЖДЕНИЕМ ДИРЕКТОРА

   ── Что было ────────────────────────────────────────────────────────────────

   Остаток правил тот, кто нажал «Применить»: оператор пересчитал полку — и
   учёт стал таким, как он сказал. Списать «на бумаге» лишний мешок можно было
   одним нажатием. Директор мог только отобрать правку целиком (warehouse.adjust),
   и тогда склад оставался без человека, который считает.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Право warehouse.apply разделяет «считать» и «проводить». Без него оператор
   по-прежнему считает и правит, но остаток не трогает: документ уходит
   директору «на утверждение» (submitted). Ручная правка и начальные остатки
   из файла превращаются в такой же документ сразу — одна строка или строки
   из файла. Директор утверждает или возвращает с объяснением.

   ── Почему разница, а не число ──────────────────────────────────────────────

   Утверждают не сразу: от отправки до «Утвердить» проходит день, и за день
   продают. Число «на полке 7» через день уже неправда — поставить его значило
   бы вернуть на склад всё проданное за этот день. Поэтому при отправке
   запоминается учётный остаток (book_at_submit), а утверждается РАЗНИЦА
   «посчитано − учёт при отправке»: продажи между отправкой и утверждением
   остаются в остатке.

   Прямое применение (директор, оператор с правом) по-прежнему ставит число,
   посчитанное сейчас: там между счётом и применением никто не ждёт.
   ═══════════════════════════════════════════════════════════════════════════ */

export type CountOrigin = "count" | "adjust" | "import";
export type AdjustType = "in" | "out" | "adjustment";

const money2 = (n: number) => n.toFixed(2);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** «1 250 000» — деньги в тексте уведомления, как в перемещении. */
const spaced = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * Номер следующего документа: ИНВ-N по организации. Одна серия на пересчёт,
 * заявку на правку и остатки из файла — это один и тот же акт о том, сколько
 * товара на самом деле, и в журнале движений он называется одним номером.
 */
export async function nextCountNumber(db: Db | Tx, tenantId: number): Promise<string> {
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(stockCounts)
    .where(eq(stockCounts.tenantId, tenantId));
  return `ИНВ-${n + 1}`;
}

/** Строка, которую проводят: что посчитано и какой учёт был при отправке. */
export interface CountLine {
  productId: number;
  counted: number;
  /** Учёт при отправке — только у документа на утверждении. */
  book?: number | null;
  note?: string | null;
}

interface CountHead {
  id: number;
  number: string;
  warehouseId: number;
  origin: string;
  adjustType: string | null;
}

export interface ApplyResult {
  number: string;
  applied: number;
  changed: number;
  surplus: number;
  shortage: number;
}

async function productName(tx: Tx, tenantId: number, productId: number): Promise<string> {
  const [p] = await tx.select({ name: products.name }).from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);
  return p?.name ?? `товар #${productId}`;
}

/** Причина движения по происхождению документа: история читает «Ручная правка №ИНВ-5», а не «Инвентаризация». */
function reasonOf(origin: string): StockMovementReason {
  return origin === "adjust" ? "manual_adjustment" : origin === "import" ? "import" : "inventory";
}

/**
 * Провести строки документа через дверь остатка — один цикл на оба пути.
 *
 *   mode "absolute" — прямое применение: остаток становится посчитанным.
 *   mode "delta"    — утверждение: к ТЕКУЩЕМУ остатку прибавляется
 *                     «посчитано − учёт при отправке».
 *
 * Пересчёт ставит итог через setStock: какая партия убыла, из пересчёта не
 * видно, и дверь подрезает партии, только если их стало больше остатка.
 * Заявка на приход и списание повторяет то, что сделала бы прямая правка:
 * приход — receiveStock, списание — по партиям, просрочка первой (иначе
 * утверждённое списание сгоревшей партии оставило бы её в отчёте «что
 * сгорает»). Заявка «установить число» — тот же setStock, что и пересчёт.
 *
 * Документ проводится целиком или никак: отказ по одной строке откатывает
 * все — иначе повторно провести его уже нельзя, а строка так и не исправлена.
 */
export async function applyCountLines(
  tx: Tx, tenantId: number, count: CountHead, lines: CountLine[], mode: "absolute" | "delta",
): Promise<ApplyResult> {
  let surplus = 0, shortage = 0, changed = 0;
  // Замки строк остатка — по возрастанию товара, как у заказа и перемещения.
  const ordered = [...lines].sort((a, b) => a.productId - b.productId);
  const reason = reasonOf(count.origin);
  const byMovement = mode === "delta" && count.origin === "adjust" && (count.adjustType === "in" || count.adjustType === "out");

  for (const it of ordered) {
    const counted = Number(it.counted);
    const [row] = await tx.select({ current: warehouseStock.currentStock, available: warehouseStock.available }).from(warehouseStock)
      .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, count.warehouseId), eq(warehouseStock.productId, it.productId)))
      .for("update").limit(1);
    const current = Number(row?.current ?? 0);
    const book = Number(it.book ?? 0);
    const target = mode === "absolute" ? counted : round2(current + (counted - book));
    const diff = round2(target - current);
    if (Math.abs(diff) < 0.005) continue;

    if (target < 0) {
      // Учёт при отправке был больше, а с тех пор продали: снимать по
      // документу уже нечего. Прибавлять к минусу нельзя, обрезать молча —
      // значит провести не то, что утверждали.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `«${await productName(tx, tenantId, it.productId)}»: после отправки остаток стал ${money2(current)}, а по документу нужно снять ${money2(-diff)}. Верните документ — пусть пересчитают заново.`,
      });
    }

    const notes = mode === "delta"
      ? count.origin === "adjust"
        ? `${count.number}${it.note ? `: ${it.note}` : ""}`
        : `${count.number}: при отправке по учёту ${money2(book)}, на полке ${money2(counted)}`
      : `${count.number}: по учёту ${money2(current)}, на полке ${money2(counted)}`;

    if (byMovement && diff > 0) {
      await receiveStock(tx, {
        tenantId, warehouseId: count.warehouseId, productId: it.productId, quantity: diff,
        reason, referenceId: count.id, notes,
      });
    } else if (byMovement) {
      const available = Number(row?.available ?? 0);
      if (available + 1e-9 < -diff) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `«${await productName(tx, tenantId, it.productId)}»: списать ${money2(-diff)} нельзя — свободно ${money2(available)}, остальное отложено под заказы.`,
        });
      }
      await applyStockEffect(tx, {
        tenantId, warehouseId: count.warehouseId, items: [{ productId: it.productId, quantity: -diff }],
        shift: { onHand: -1, held: 0 }, reason, referenceId: count.id, notes,
      });
    } else {
      try {
        await setStock(tx, { tenantId, warehouseId: count.warehouseId, productId: it.productId, quantity: target });
      } catch (e) {
        // На полке насчитали меньше, чем отложено под заказы. Дверь
        // отказывает числом — здесь называем товар: без имени отказ
        // читается как придирка к цифре. Акт не применяется целиком.
        if (!(e instanceof StockBelowReserveError)) throw e;
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `«${await productName(tx, tenantId, it.productId)}»: на полке ${money2(target)}, а под заказы отложено ${money2(e.reserved)}. Сначала проведите или отмените заказы, занявшие резерв, — потом примените акт.`,
        });
      }
      await recordStockMovement(tx, {
        tenantId, warehouseId: count.warehouseId, productId: it.productId,
        type: diff > 0 ? "in" : "out", quantity: Math.abs(diff), reason, referenceId: count.id, notes,
      });
    }
    if (diff > 0) surplus += diff; else shortage += -diff;
    changed++;
  }
  return { number: count.number, applied: lines.length, changed, surplus: round2(surplus), shortage: round2(shortage) };
}

/**
 * Учёт в момент отправки — под замком строк остатка, чтобы число было ровно
 * тем, что лежало в учёте, когда документ ушёл директору.
 */
async function snapshotBook(tx: Tx, tenantId: number, warehouseId: number, countId: number): Promise<number> {
  const lines = await tx.select({ id: stockCountItems.id, productId: stockCountItems.productId })
    .from(stockCountItems)
    .where(and(eq(stockCountItems.countId, countId), sql`${stockCountItems.counted} IS NOT NULL`))
    .orderBy(asc(stockCountItems.productId));
  if (lines.length === 0) return 0;
  const rows = await tx.select({ productId: warehouseStock.productId, current: warehouseStock.currentStock }).from(warehouseStock)
    .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId), inArray(warehouseStock.productId, lines.map(l => l.productId))))
    .orderBy(asc(warehouseStock.productId))
    .for("update");
  const book = new Map(rows.map(r => [r.productId, r.current ?? "0.00"]));
  for (const l of lines) {
    await tx.update(stockCountItems).set({ bookAtSubmit: book.get(l.productId) ?? "0.00" }).where(eq(stockCountItems.id, l.id));
  }
  return lines.length;
}

/** Итог документа на утверждении: излишек и недостача — в штуках и по себестоимости. */
async function submittedSummary(db: Db | Tx, tenantId: number, countId: number) {
  const rows = await db.select({
    counted: stockCountItems.counted, book: stockCountItems.bookAtSubmit, cost: products.costPrice, name: products.name,
  }).from(stockCountItems)
    .innerJoin(products, and(eq(stockCountItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(and(eq(stockCountItems.countId, countId), sql`${stockCountItems.counted} IS NOT NULL`));
  let surplusQty = 0, shortageQty = 0, surplusCost = 0, shortageCost = 0;
  for (const r of rows) {
    const diff = Number(r.counted) - Number(r.book ?? 0);
    const cost = Number(r.cost ?? 0);
    if (diff > 0) { surplusQty += diff; surplusCost += diff * cost; }
    else if (diff < 0) { shortageQty += -diff; shortageCost += -diff * cost; }
  }
  return {
    lines: rows.length, firstName: rows[0]?.name ?? "",
    surplusQty: round2(surplusQty), shortageQty: round2(shortageQty),
    surplusCost: round2(surplusCost), shortageCost: round2(shortageCost),
  };
}

type Summary = Awaited<ReturnType<typeof submittedSummary>>;

/** Что просят провести — словами, для уведомления директору. */
function whatRu(origin: string, adjustType: string | null, s: Summary) {
  if (origin === "adjust") {
    const kind = adjustType === "in" ? "приход" : adjustType === "out" ? "списание" : "установку остатка";
    return `${kind} «${s.firstName}»`;
  }
  return origin === "import" ? `начальные остатки из файла (${s.lines} товаров)` : `инвентаризацию (${s.lines} строк)`;
}
function whatUz(origin: string, adjustType: string | null, s: Summary) {
  if (origin === "adjust") {
    const kind = adjustType === "in" ? "kirim" : adjustType === "out" ? "hisobdan chiqarish" : "qoldiqni o'rnatish";
    return `«${s.firstName}» — ${kind}`;
  }
  return origin === "import" ? `fayldagi boshlang'ich qoldiqlar (${s.lines} ta tovar)` : `inventarizatsiya (${s.lines} qator)`;
}

/** Директорам организации: документ ждёт решения. Сбой уведомления документ не отменяет. */
async function notifyDirectors(db: Db, tenantId: number, actor: Actor, doc: { number: string; warehouseName: string; origin: string; adjustType: string | null }, s: Summary) {
  try {
    const ceo = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "ceo"), eq(users.status, "active")));
    if (ceo.length === 0) return;
    const { NotificationService } = await import("./NotificationService");
    await NotificationService.createBulk(db, {
      tenantId, userIds: ceo.map(u => u.id), type: "stock",
      title: { ru: `На утверждение: ${doc.number}`, uz: `Tasdiqlash uchun: ${doc.number}` },
      message: {
        ru: `${actor.name} просит провести ${whatRu(doc.origin, doc.adjustType, s)} на складе «${doc.warehouseName}»: излишек ${s.surplusQty} (${spaced(s.surplusCost)}), недостача ${s.shortageQty} (${spaced(s.shortageCost)}) по себестоимости.`.slice(0, 500),
        uz: `${actor.name} «${doc.warehouseName}» omborida ${whatUz(doc.origin, doc.adjustType, s)} o'tkazishni so'ramoqda: ortiqcha ${s.surplusQty} (${spaced(s.surplusCost)}), kamomad ${s.shortageQty} (${spaced(s.shortageCost)}) tannarx bo'yicha.`.slice(0, 500),
      },
      link: "/warehouse?tab=counts",
    });
  } catch (e) {
    logger.warn("stock count submit notification failed", { tenantId, number: doc.number, error: String(e) });
  }
}

/** Тому, кто отправлял: решение принято. */
async function notifySubmitter(db: Db, tenantId: number, userId: number | null, text: { title: { ru: string; uz: string }; message: { ru: string; uz: string } }) {
  if (!userId) return;
  try {
    const { NotificationService } = await import("./NotificationService");
    // Пара { ru, uz } — прямо в вызове: notifications-speak-both-languages
    // проверяет язык по тексту вызова, а не по типу аргумента.
    await NotificationService.create(db, {
      tenantId, userId, type: "stock", link: "/warehouse?tab=counts",
      title: { ru: text.title.ru, uz: text.title.uz },
      message: { ru: text.message.ru, uz: text.message.uz },
    });
  } catch (e) {
    logger.warn("stock count review notification failed", { tenantId, error: String(e) });
  }
}

async function warehouseName(db: Db | Tx, tenantId: number, warehouseId: number): Promise<string> {
  const [w] = await db.select({ name: warehouses.name }).from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
  return w?.name ?? "";
}

/** Остатки и списки товаров живут в кэше — после проведения они другие. */
async function afterStockChanged(tenantId: number, why: string) {
  cache.invalidatePrefix(`products:${tenantId}`);
  await invalidateReports(tenantId, why);
}

/**
 * Отправить черновик директору. Посчитанные строки запоминают учёт этой
 * минуты; непосчитанные не уходят никуда — «не считали» не значит «ноль».
 */
export async function submitCount(db: Db, tenantId: number, actor: Actor, countId: number) {
  const head = await db.transaction(async (tx) => {
    const [count] = await tx.select().from(stockCounts)
      .where(and(eq(stockCounts.id, countId), eq(stockCounts.tenantId, tenantId))).for("update").limit(1);
    if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
    if (count.status !== "draft") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: count.status === "submitted" ? "Документ уже на утверждении у руководителя" : "Документ уже применён или отменён",
      });
    }
    const lines = await snapshotBook(tx, tenantId, count.warehouseId, count.id);
    if (lines === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Ни одна строка не посчитана — отправлять нечего" });
    await tx.update(stockCounts)
      .set({ status: "submitted", submittedBy: actor.id, submittedAt: new Date(), reviewNote: null })
      .where(and(eq(stockCounts.id, count.id), eq(stockCounts.status, "draft")));
    return count;
  });
  const s = await submittedSummary(db, tenantId, head.id);
  await recordAudit(db, {
    tenantId, actorId: actor.id, actorName: actor.name, action: "stock_count.submit", targetType: "stock_count", targetId: head.id,
    meta: { number: head.number, origin: head.origin, lines: s.lines, surplus: s.surplusQty, shortage: s.shortageQty, shortageCost: s.shortageCost },
  });
  await notifyDirectors(db, tenantId, actor, { number: head.number, warehouseName: await warehouseName(db, tenantId, head.warehouseId), origin: head.origin, adjustType: head.adjustType }, s);
  return { id: head.id, number: head.number, lines: s.lines };
}

/**
 * Утвердить: провести разницу «посчитано − учёт при отправке» поверх
 * текущего остатка. Только директор (adminQuery на роутере).
 */
export async function approveCount(db: Db, tenantId: number, actor: Actor, countId: number): Promise<ApplyResult> {
  const out = await db.transaction(async (tx) => {
    const [count] = await tx.select().from(stockCounts)
      .where(and(eq(stockCounts.id, countId), eq(stockCounts.tenantId, tenantId))).for("update").limit(1);
    if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
    if (count.status !== "submitted") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Утвердить можно только документ, отправленный на утверждение" });

    const items = await tx.select({ productId: stockCountItems.productId, counted: stockCountItems.counted, book: stockCountItems.bookAtSubmit, note: stockCountItems.note })
      .from(stockCountItems).where(and(eq(stockCountItems.countId, count.id), sql`${stockCountItems.counted} IS NOT NULL`));
    // Учёт при отправке есть у каждой посчитанной строки: снимается при
    // отправке, а править строки отправленного документа нельзя. Без него
    // разница считалась бы от нуля — и на склад легло бы всё посчитанное.
    if (items.some(i => i.book == null)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `stock count ${count.id}: line without book_at_submit` });
    const result = await applyCountLines(tx, tenantId, count, items.map(i => ({
      productId: i.productId, counted: Number(i.counted), book: Number(i.book), note: i.note,
    })), "delta");

    const now = new Date();
    await tx.update(stockCounts)
      .set({ status: "applied", appliedBy: actor.id, appliedAt: now, reviewedBy: actor.id, reviewedAt: now })
      .where(and(eq(stockCounts.id, count.id), eq(stockCounts.status, "submitted")));
    // Решение директора об остатке — в журнал в той же транзакции: проведено
    // без следа быть не может.
    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, action: "stock_count.approve", targetType: "stock_count", targetId: count.id,
      meta: { ...result, origin: count.origin },
    }, { strict: true });
    return { result, submittedBy: count.submittedBy };
  });
  await afterStockChanged(tenantId, "stock_count.approve");
  const r = out.result;
  await notifySubmitter(db, tenantId, out.submittedBy === actor.id ? null : out.submittedBy, {
    title: { ru: `Утверждено: ${r.number}`, uz: `Tasdiqlandi: ${r.number}` },
    message: {
      ru: `Руководитель провёл документ: изменено строк ${r.changed} из ${r.applied}, излишек ${r.surplus}, недостача ${r.shortage}.`,
      uz: `Rahbar hujjatni o'tkazdi: ${r.applied} tadan ${r.changed} qator o'zgardi, ortiqcha ${r.surplus}, kamomad ${r.shortage}.`,
    },
  });
  return r;
}

/**
 * Вернуть на доработку: документ снова черновик, остаток не тронут, слова
 * директора видны тому, кто считал.
 */
export async function rejectCount(db: Db, tenantId: number, actor: Actor, countId: number, note: string) {
  const count = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(stockCounts)
      .where(and(eq(stockCounts.id, countId), eq(stockCounts.tenantId, tenantId))).for("update").limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
    if (row.status !== "submitted") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Вернуть можно только документ, отправленный на утверждение" });
    await tx.update(stockCounts)
      .set({ status: "draft", reviewNote: note, reviewedBy: actor.id, reviewedAt: new Date() })
      .where(and(eq(stockCounts.id, row.id), eq(stockCounts.status, "submitted")));
    // Учёт при отправке устарел вместе с отказом: при следующей отправке он
    // снимается заново.
    await tx.update(stockCountItems).set({ bookAtSubmit: null }).where(eq(stockCountItems.countId, row.id));
    return row;
  });
  await recordAudit(db, {
    tenantId, actorId: actor.id, actorName: actor.name, action: "stock_count.reject", targetType: "stock_count", targetId: count.id,
    meta: { number: count.number, origin: count.origin, note },
  });
  await notifySubmitter(db, tenantId, count.submittedBy === actor.id ? null : count.submittedBy, {
    title: { ru: `Возвращено: ${count.number}`, uz: `Qaytarildi: ${count.number}` },
    message: { ru: `Руководитель вернул документ: «${note}»`.slice(0, 500), uz: `Rahbar hujjatni qaytardi: «${note}»`.slice(0, 500) },
  });
  return { id: count.id, number: count.number };
}

/**
 * Документ, который рождается сразу на утверждении: заявка на ручную правку
 * или начальные остатки из файла. Учёт при отправке снимается под замком
 * строки остатка, «посчитано» считает вызывающий от этого учёта.
 */
async function createSubmitted(
  db: Db, tenantId: number, actor: Actor,
  head: { warehouseId: number; origin: CountOrigin; adjustType?: AdjustType | null; notes: string | null },
  lines: Array<{ productId: number; note?: string | null; counted: (row: { current: number; available: number; reserved: number }) => number }>,
) {
  const number = await nextCountNumber(db, tenantId);
  const id = await db.transaction(async (tx) => {
    const [r] = await tx.insert(stockCounts).values({
      tenantId, warehouseId: head.warehouseId, number, notes: head.notes, createdBy: actor.id,
      status: "submitted", scope: "items", origin: head.origin, adjustType: head.adjustType ?? null,
      submittedBy: actor.id, submittedAt: new Date(),
    });
    const countId = Number(r.insertId);
    const ordered = [...lines].sort((a, b) => a.productId - b.productId);
    const rows = ordered.length === 0 ? [] : await tx.select({
      productId: warehouseStock.productId, current: warehouseStock.currentStock, available: warehouseStock.available, reserved: warehouseStock.reserved,
    }).from(warehouseStock)
      .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, head.warehouseId), inArray(warehouseStock.productId, ordered.map(l => l.productId))))
      .orderBy(asc(warehouseStock.productId))
      .for("update");
    const byId = new Map(rows.map(x => [x.productId, { current: Number(x.current ?? 0), available: Number(x.available ?? 0), reserved: Number(x.reserved ?? 0) }]));
    const values = ordered.map(l => {
      const row = byId.get(l.productId) ?? { current: 0, available: 0, reserved: 0 };
      const counted = l.counted(row);
      return { countId, productId: l.productId, expected: money2(row.current), counted: money2(counted), bookAtSubmit: money2(row.current), note: l.note ?? null };
    });
    if (values.length > 0) await tx.insert(stockCountItems).values(values);
    return countId;
  });
  const s = await submittedSummary(db, tenantId, id);
  await recordAudit(db, {
    tenantId, actorId: actor.id, actorName: actor.name, action: "stock_count.submit", targetType: "stock_count", targetId: id,
    meta: { number, origin: head.origin, type: head.adjustType ?? undefined, lines: s.lines, surplus: s.surplusQty, shortage: s.shortageQty, shortageCost: s.shortageCost },
  });
  await notifyDirectors(db, tenantId, actor, { number, warehouseName: await warehouseName(db, tenantId, head.warehouseId), origin: head.origin, adjustType: head.adjustType ?? null }, s);
  return { id, number, lines: s.lines };
}

/**
 * Ручная правка оператора без права проводить — заявка вместо движения.
 *
 * Те же отказы, что у прямой правки, и в ту же минуту: списать больше
 * свободного или поставить число ниже резерва нельзя и в заявке — иначе
 * отказ пришёл бы директору при утверждении, а не тому, кто ошибся.
 * Товар и склад уже проверены вызывающим (StockService.adjust).
 */
export async function requestAdjust(
  db: Db, tenantId: number, actor: Actor,
  input: { warehouseId: number; productId: number; type: AdjustType; quantity: number; notes?: string | null },
) {
  const q = input.quantity;
  return createSubmitted(db, tenantId, actor, {
    warehouseId: input.warehouseId, origin: "adjust", adjustType: input.type, notes: input.notes ?? null,
  }, [{
    productId: input.productId, note: input.notes ?? null,
    counted: ({ current, available, reserved }) => {
      if (input.type === "in") return current + q;
      if (input.type === "out") {
        if (available < q) {
          throw new Error(
            `Недостаточно свободного товара на складе (на складе: ${current}, из них ${reserved} зарезервировано под заказы; свободно: ${available}, запрошено: ${q})`,
          );
        }
        return current - q;
      }
      if (q < reserved) {
        throw new Error(
          `Новое количество (${q}) меньше зарезервированного под заказы (${reserved}). Сначала проведите или отмените заказы, занявшие резерв.`,
        );
      }
      if (Math.abs(q - current) < 0.005) throw new TRPCError({ code: "BAD_REQUEST", message: `Остаток уже ${money2(current)} — менять нечего` });
      return q;
    },
  }]);
}

/**
 * Начальные остатки из файла у оператора без права проводить: товары
 * заведены (с нулём), а числа ждут директора одним документом.
 */
export async function requestImportStock(
  db: Db, tenantId: number, actor: Actor,
  input: { warehouseId: number; lines: Array<{ productId: number; quantity: number }> },
) {
  const lines = input.lines.filter(l => l.quantity > 0);
  if (lines.length === 0) return null;
  return createSubmitted(db, tenantId, actor, {
    warehouseId: input.warehouseId, origin: "import", notes: "Начальные остатки из файла",
  }, lines.map(l => ({ productId: l.productId, counted: () => l.quantity })));
}

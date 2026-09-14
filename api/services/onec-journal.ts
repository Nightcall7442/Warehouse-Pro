import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { onecJournal } from "@db/schema";
import type { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;

/**
 * Журнал обмена с 1С — очередь с повторами и ответом «почему».
 *
 * Строка на сущность и направление; повтор — не новая строка, а та же с
 * attempts + 1. Пауза между попытками растёт (5 мин → 15 → 45 → 2 ч → 6 ч),
 * после MAX_ATTEMPTS строка остаётся failed до нажатия «Повторить» руками:
 * бесконечно долбить 1С с тем же неверным договором бессмысленно.
 */
export type JournalEntity = "order" | "payment" | "product" | "counterparty";
export type JournalDirection = "to1c" | "from1c";
export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [5, 15, 45, 120, 360];

export const OnecJournal = {
  /** Поставить в очередь (если строки нет) или вернуть в pending существующую. */
  async enqueue(db: Db, tenantId: number, entityType: JournalEntity, entityId: number, direction: JournalDirection = "to1c"): Promise<void> {
    await db.insert(onecJournal)
      .values({ tenantId, entityType, entityId, direction, status: "pending", attempts: 0, nextAt: new Date() })
      .onDuplicateKeyUpdate({ set: { status: "pending", nextAt: new Date(), lastError: null } });
  },

  /** Что пора делать: pending/failed с наступившим временем и не исчерпанными попытками. */
  async due(db: Db, tenantId: number, limit = 50) {
    // TIMESTAMP без долей секунды: MySQL ОКРУГЛЯЕТ 12:00:00.7 до 12:00:01, и
    // строка, поставленная в очередь «сейчас», секунду считается будущей.
    // Секунда допуска — иначе «Выгрузить очередь сейчас» через раз молчит.
    const now = new Date(Date.now() + 1000);
    return db.select().from(onecJournal)
      .where(and(
        eq(onecJournal.tenantId, tenantId),
        inArray(onecJournal.status, ["pending", "failed"]),
        sql`${onecJournal.attempts} < ${MAX_ATTEMPTS}`,
        or(isNull(onecJournal.nextAt), lte(onecJournal.nextAt, now)),
      ))
      .orderBy(asc(onecJournal.nextAt), asc(onecJournal.id))
      .limit(limit);
  },

  async markDone(db: Db, id: number, externalId?: string | null): Promise<void> {
    await db.update(onecJournal)
      .set({ status: "done", lastError: null, externalId: externalId ?? undefined, attempts: sql`${onecJournal.attempts} + 1` })
      .where(eq(onecJournal.id, id));
  },

  async markSkipped(db: Db, id: number, reason: string): Promise<void> {
    await db.update(onecJournal).set({ status: "skipped", lastError: reason.slice(0, 2000) }).where(eq(onecJournal.id, id));
  },

  /** Отказ: следующая попытка позже; после MAX_ATTEMPTS — ждёт человека. */
  async markFailed(db: Db, id: number, attempts: number, error: string, externalId?: string | null): Promise<void> {
    const n = attempts + 1;
    const wait = BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)];
    await db.update(onecJournal)
      .set({
        status: "failed", attempts: n, lastError: error.slice(0, 2000),
        nextAt: new Date(Date.now() + wait * 60_000),
        externalId: externalId ?? undefined,
      })
      .where(eq(onecJournal.id, id));
  },

  /** «Повторить» руками: счётчик обнуляется, строка снова в очереди. */
  async retry(db: Db, tenantId: number, id: number): Promise<boolean> {
    const [row] = await db.select({ id: onecJournal.id }).from(onecJournal)
      .where(and(eq(onecJournal.id, id), eq(onecJournal.tenantId, tenantId))).limit(1);
    if (!row) return false;
    await db.update(onecJournal).set({ status: "pending", attempts: 0, nextAt: new Date(), lastError: null }).where(eq(onecJournal.id, id));
    return true;
  },

  async list(db: Db, tenantId: number, opts: { status?: string; entityType?: string; limit?: number } = {}) {
    const conds = [eq(onecJournal.tenantId, tenantId)];
    if (opts.status) conds.push(eq(onecJournal.status, opts.status));
    if (opts.entityType) conds.push(eq(onecJournal.entityType, opts.entityType));
    return db.select().from(onecJournal).where(and(...conds)).orderBy(desc(onecJournal.updatedAt)).limit(opts.limit ?? 100);
  },

  async counts(db: Db, tenantId: number): Promise<Record<string, number>> {
    const rows = await db.select({ status: onecJournal.status, n: sql<number>`count(*)` })
      .from(onecJournal).where(eq(onecJournal.tenantId, tenantId)).groupBy(onecJournal.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  },
};

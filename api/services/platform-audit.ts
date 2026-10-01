import { and, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { platformAudit, tenants } from "@db/schema";
import { PLATFORM_ACTION_GROUPS, type PlatformAction } from "@contracts/platform-journal";
import { logger } from "../lib/logger";
import { getClientIp } from "../lib/rate-limit";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
/** Транзакция drizzle устроена как db для вставки; приведение названо здесь, а не по вызовам. */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/* ═══════════════════════════════════════════════════════════════════════════
   Журнал владельца платформы.

   ── Что было ────────────────────────────────────────────────────────────────

   Действия суперадмина оставляли след в журнале САМОЙ организации
   (audit_log) — и то не все: смена тарифа, статус, продление пробного,
   создание организации не писались никуда. А удаление организации стирает её
   audit_log целиком. На вопрос «кто удалил „Хорезм Опт“ и что у неё было»
   ответить было нечем, как и на «кто продлил Бухаре срок на полгода».

   ── Что теперь ──────────────────────────────────────────────────────────────

   Отдельная таблица platform_audit: кто, когда, что, было → стало, IP;
   организация — номером и названием СНИМКОМ, без внешнего ключа: строка
   переживает удаление. Пишется в той же транзакции, что само действие, где
   транзакция есть (strict: действие без следа хуже отказа); где действие —
   один UPDATE, след пишется сразу за ним.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PlatformAuditEntry {
  actor: { id?: number | null; name?: string | null };
  action: PlatformAction;
  tenantId?: number | null;
  /** Название снимком. Не передано — берётся из базы по tenantId. */
  tenantName?: string | null;
  targetType?: string;
  targetId?: number;
  targetLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

/** IP запроса суперадмина — тем же помощником, что у журнала организации. */
export const ipOf = (ctx: { req?: Request }): string | null => (ctx.req ? getClientIp(ctx.req) ?? null : null);

/**
 * Записать действие владельца платформы.
 *
 * strict — след часть сделки: ошибка записи откатывает действие (передавать
 * вместе с tx). Без strict ошибка уходит в лог, действие остаётся: так
 * пишутся следы после необратимого (письмо ушло, сессии погашены).
 */
export async function recordPlatformAudit(db: DbOrTx, e: PlatformAuditEntry, opts?: { strict?: boolean }): Promise<void> {
  try {
    let tenantName = e.tenantName ?? null;
    if (!tenantName && e.tenantId) {
      const [t] = await (db as Db).select({ name: tenants.name }).from(tenants).where(eq(tenants.id, e.tenantId)).limit(1);
      tenantName = t?.name ?? null;
    }
    await (db as Db).insert(platformAudit).values({
      actorId: e.actor.id ?? null,
      actorName: e.actor.name?.slice(0, 100) ?? null,
      action: e.action,
      tenantId: e.tenantId ?? null,
      tenantName: tenantName?.slice(0, 200) ?? null,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      targetLabel: e.targetLabel?.slice(0, 200) ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      meta: e.meta ?? null,
      ip: e.ip ?? null,
    });
  } catch (err) {
    logger.error("Failed to write platform audit", { action: e.action, error: String(err) });
    if (opts?.strict) throw err;
  }
}

export interface PlatformJournalFilters {
  /** Ключ группы (PLATFORM_ACTION_GROUPS) или точное имя действия. */
  type?: string;
  tenantId?: number;
  /** Сколько последних дней; пусто — за всё время. */
  days?: number;
  /** Слово: название организации, кто, объект, подробности. */
  q?: string;
  /** Строки с id меньше этого — следующая страница. */
  before?: number;
  limit?: number;
}

/**
 * Строки журнала, новые сверху, страницами по id (а не OFFSET: журнал
 * растёт, пока его листают, и смещение показывало бы одну строку дважды).
 */
export async function listPlatformAudit(db: Db, f: PlatformJournalFilters, now = new Date()) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const where = [];
  if (f.type) {
    const group = PLATFORM_ACTION_GROUPS.find(g => g.key === f.type);
    where.push(group ? inArray(platformAudit.action, group.actions) : eq(platformAudit.action, f.type));
  }
  if (f.tenantId) where.push(eq(platformAudit.tenantId, f.tenantId));
  if (f.days) where.push(gte(platformAudit.createdAt, new Date(now.getTime() - f.days * 86_400_000)));
  if (f.before) where.push(lt(platformAudit.id, f.before));
  if (f.q?.trim()) {
    const word = `%${f.q.trim().replace(/[%_\\]/g, "")}%`;
    where.push(or(
      like(platformAudit.tenantName, word),
      like(platformAudit.actorName, word),
      like(platformAudit.targetLabel, word),
      sql`CAST(${platformAudit.meta} AS CHAR) LIKE ${word}`,
      sql`CAST(${platformAudit.after} AS CHAR) LIKE ${word}`,
    ));
  }
  const rows = await db.select().from(platformAudit)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(platformAudit.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { rows: page, nextBefore: more ? page[page.length - 1].id : null };
}

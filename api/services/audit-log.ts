import { auditLog } from "@db/schema";
import { eq, and, or, desc, sql, gte, lte, like } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getClientIp } from "../lib/rate-limit";
import { labelFor, labelsFor } from "./audit-labels";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface AuditRecord {
  tenantId: number;
  actorId?: number;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: number;
  /** Как объект зовут люди; если не передан — берётся из базы по типу и id (см. audit-labels). */
  targetLabel?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Отбор по действию.
 *
 * Точное имя («order.cancelled») — точное совпадение. Слово без точки
 * («payment», «stock») — группа: кнопки отбора на экране передавали «user»,
 * а сравнение было точным, и все они отдавали пустой журнал. Подстрока, а
 * не префикс: «payment» должно ловить и order.payment_recorded.
 */
export function actionCondition(action: string) {
  return action.includes(".")
    ? eq(auditLog.action, action)
    : like(auditLog.action, `%${action.replace(/[%_]/g, "")}%`);
}

/**
 * Записать след в журнал.
 *
 * Два режима, и разница — в том, что происходит, когда след записать нельзя.
 *
 * Мягкий (по умолчанию): след пишется ПОСЛЕ сделки, откатывать уже нечего;
 * ошибка уходит в лог, работа не останавливается. Так остаются уведомления
 * и следы «кто напечатал накладную».
 *
 * Строгий (`strict: true`, всегда с `tx`): след — часть сделки. Цена,
 * себестоимость, лимит, настройки, проведение возврата или прихода —
 * действия, после которых спорят о деньгах; действие без следа хуже, чем
 * отказ. Ошибка пробрасывается, транзакция откатывается вместе с ней.
 */
export async function recordAudit(db: Db, entry: AuditRecord, opts?: { strict?: boolean }): Promise<void> {
  try {
    const targetLabel = entry.targetLabel
      ?? (entry.targetType && entry.targetId ? await labelFor(db, entry.tenantId, entry.targetType, entry.targetId) : null);
    await db.insert(auditLog).values({
      tenantId:  entry.tenantId,
      actorId:   entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action:    entry.action,
      targetType: entry.targetType ?? null,
      targetId:  entry.targetId ?? null,
      targetLabel: targetLabel?.slice(0, 200) ?? null,
      meta:      entry.meta ?? null,
      ip:        entry.ip ?? null,
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action: entry.action, error: String(err) });
    if (opts?.strict) throw err;
  }
}

/** Кто и откуда — из контекста процедуры, чтобы не собирать по месту. */
export function auditActor(ctx: { tenant: { id: number }; user: { id: number; name: string }; req?: Request }): Pick<AuditRecord, "tenantId" | "actorId" | "actorName" | "ip"> {
  return { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, ip: ctx.req ? getClientIp(ctx.req) ?? undefined : undefined };
}

/**
 * Что изменилось: только поля, у которых значение стало другим. Числа
 * сравниваются как числа, чтобы «10.00» и «10» не считались правкой.
 */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (!(f in after) || after[f] === undefined) continue;
    const a = before[f], b = after[f];
    const same = a === b || (a != null && b != null && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && String(a).trim() !== "" && Number(a) === Number(b));
    if (!same) out[f] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export interface AuditFilters {
  action?: string;
  actorId?: number;
  targetType?: string;
  /** Слово из имени объекта, имени сотрудника или подробностей: «Альфа», «ORD-0123», «наличные». */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/** Слово для LIKE: служебные знаки шаблона гасятся, пробелы по краям — прочь. */
export function searchCondition(search: string) {
  const word = `%${search.trim().replace(/[%_\\]/g, "")}%`;
  return or(
    like(auditLog.targetLabel, word),
    like(auditLog.actorName, word),
    like(auditLog.action, word),
    // meta — JSON: имя магазина, номер заказа, способ оплаты записаны там у старых строк
    sql`CAST(${auditLog.meta} AS CHAR) LIKE ${word}`,
  );
}

/**
 * Query audit log entries for a tenant with extended filters.
 */
export async function getAuditLog(
  db: Db,
  tenantId: number,
  opts?: AuditFilters,
) {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(auditLog.tenantId, tenantId)];

  if (opts?.action) {
    conditions.push(actionCondition(opts.action));
  }
  if (opts?.actorId) {
    conditions.push(eq(auditLog.actorId, opts.actorId));
  }
  if (opts?.targetType) {
    conditions.push(eq(auditLog.targetType, opts.targetType));
  }
  if (opts?.search?.trim()) {
    conditions.push(searchCondition(opts.search)!);
  }
  if (opts?.dateFrom) {
    conditions.push(gte(auditLog.createdAt, new Date(opts.dateFrom)));
  }
  if (opts?.dateTo) {
    conditions.push(lte(auditLog.createdAt, new Date(opts.dateTo)));
  }

  const [data, countResult] = await Promise.all([
    db.select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(and(...conditions)),
  ]);

  // Строки, записанные до появления подписи, получают её при чтении.
  const labels = await labelsFor(db, tenantId, data);
  return {
    data: data.map(r => ({ ...r, targetLabel: r.targetLabel ?? (r.targetType && r.targetId ? labels.get(`${r.targetType}:${r.targetId}`) ?? null : null) })),
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  };
}

/** Кто оставлял следы в журнале — для отбора по человеку. */
export async function auditActors(db: Db, tenantId: number): Promise<Array<{ id: number; name: string }>> {
  const rows = await db.select({ id: auditLog.actorId, name: sql<string>`MAX(${auditLog.actorName})` })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), sql`${auditLog.actorId} IS NOT NULL`))
    .groupBy(auditLog.actorId);
  return rows.filter(r => r.id != null).map(r => ({ id: Number(r.id), name: r.name || `#${r.id}` }));
}

/**
 * Export audit log as CSV string.
 */
export function exportAuditCsv(rows: ReturnType<typeof getAuditLog> extends Promise<infer R> ? (R extends { data: infer D } ? D : never) : never): string {
  const header = "ID,Дата,Пользователь,Действие,Объект,Тип объекта,ID объекта,IP,Мета";
  const lines = rows.map((r) => [
    r.id,
    r.createdAt?.toISOString() ?? "",
    r.actorName ?? `user#${r.actorId}`,
    r.action,
    r.targetLabel ?? "",
    r.targetType ?? "",
    r.targetId ?? "",
    r.ip ?? "",
    JSON.stringify(r.meta ?? {}),
  ].map(csvCell).join(","));
  return [header, ...lines].join("\n");
}

/**
 * One CSV cell: quoted, inner quotes doubled, and defused if it looks like a
 * formula.
 *
 * Quoting alone is not enough. Excel evaluates a field that begins with =, +,
 * -, @ or a control character even inside quotes, so a user who names themself
 * =HYPERLINK("http://…","Отчёт готов") is writing code that runs on the
 * director's machine when the director exports the audit log. actorName comes
 * straight from the users table, so the value is chosen by the person the log
 * is recording — exactly the person with a reason to tamper with it.
 *
 * The leading apostrophe is the standard defusing: Excel shows the text and
 * refuses to treat it as a formula. Numbers and dates are unaffected because
 * they do not start with those characters.
 */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const defused = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${defused.replace(/"/g, '""')}"`;
}

/**
 * Delete audit logs older than retentionDays.
 * Returns number of deleted rows.
 */
export async function purgeOldAuditLogs(
  db: Db,
  tenantId: number,
  retentionDays: number = 90,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const [result] = await db.delete(auditLog)
    .where(and(
      eq(auditLog.tenantId, tenantId),
      lte(auditLog.createdAt, cutoff),
    ));
  const deleted = result.affectedRows ?? 0;
  if (deleted > 0) {
    logger.info("Purged old audit logs", { tenantId, retentionDays, deleted });
  }
  return deleted;
}

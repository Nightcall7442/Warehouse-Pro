import { auditLog } from "@db/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface AuditRecord {
  tenantId: number;
  actorId?: number;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: number;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Record an audit log entry.
 * Called inside or alongside business transactions.
 * Fire-and-forget by default — audit failures don't block the main operation.
 */
export async function recordAudit(db: Db, entry: AuditRecord): Promise<void> {
  try {
    await db.insert(auditLog).values({
      tenantId:  entry.tenantId,
      actorId:   entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action:    entry.action,
      targetType: entry.targetType ?? null,
      targetId:  entry.targetId ?? null,
      meta:      entry.meta ?? null,
      ip:        entry.ip ?? null,
    });
  } catch (err) {
    // Audit log is non-critical — log the failure but don't throw
    logger.error("Failed to write audit log", { action: entry.action, error: String(err) });
  }
}

export interface AuditFilters {
  action?: string;
  actorId?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
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
    conditions.push(eq(auditLog.action, opts.action));
  }
  if (opts?.actorId) {
    conditions.push(eq(auditLog.actorId, opts.actorId));
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

  return {
    data,
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  };
}

/**
 * Export audit log as CSV string.
 */
export function exportAuditCsv(rows: ReturnType<typeof getAuditLog> extends Promise<infer R> ? (R extends { data: infer D } ? D : never) : never): string {
  const header = "ID,Дата,Пользователь,Действие,Объект,ID объекта,IP,Мета";
  const lines = rows.map((r) => [
    r.id,
    r.createdAt?.toISOString() ?? "",
    r.actorName ?? `user#${r.actorId}`,
    r.action,
    r.targetType ?? "",
    r.targetId ?? "",
    r.ip ?? "",
    JSON.stringify(r.meta ?? {}),
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [header, ...lines].join("\n");
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

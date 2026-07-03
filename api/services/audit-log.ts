import { auditLog } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
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

/**
 * Query audit log entries for a tenant.
 */
export async function getAuditLog(
  db: Db,
  tenantId: number,
  opts?: { action?: string; limit?: number; offset?: number; since?: Date },
) {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(auditLog.tenantId, tenantId)];

  if (opts?.action) {
    conditions.push(eq(auditLog.action, opts.action));
  }
  if (opts?.since) {
    conditions.push(sql`${auditLog.createdAt} >= ${opts.since}`);
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

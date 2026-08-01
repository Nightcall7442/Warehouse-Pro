import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { env } from "../lib/env";

/**
 * P2.2 — bounded retention for the three tables that grow without limit:
 * `agent_locations` (a GPS point per agent every few seconds of every shift),
 * `stock_movements` and `audit_log`.
 *
 * The plan called for partitioning these. All three carry foreign keys and InnoDB
 * does not allow foreign keys on a partitioned table, so partitioning them means
 * dropping referential integrity — a decision for the owner, not a refactor. This
 * is the half that keeps the tables small either way, and it is what the plan's
 * "delete anything older than two years" amounted to.
 */

/** Rows per statement. Small enough that the lock is held for milliseconds. */
const BATCH_SIZE = 5_000;
/** Ceiling per table per run, so a first run on a huge table cannot monopolise the night. */
const MAX_ROWS_PER_RUN = 500_000;
/** Breather between batches — lets replicas catch up and writers through. */
const PAUSE_BETWEEN_BATCHES_MS = 200;
/**
 * Anything shorter than this is almost certainly a misread environment variable
 * rather than a policy, and the job refuses it.
 */
const MIN_RETENTION_DAYS = 7;

export type TableRetention = {
  /** Physical table name — these statements are raw because the tables have no ORM-side needs. */
  table: string;
  column: string;
  days: number;
  /** What the data is for, so the log line explains itself. */
  purpose: string;
};

export type TableResult = {
  table: string;
  status: "deleted" | "skipped" | "refused" | "failed";
  rowsDeleted: number;
  /** True when MAX_ROWS_PER_RUN stopped the run with rows still eligible. */
  capReached: boolean;
  cutoff?: string;
  reason?: string;
  durationMs: number;
};

export type RetentionResult = {
  success: boolean;
  message: string;
  tables: TableResult[];
  durationMs: number;
};

/** The configured policy. Exported so a test does not have to reach into env. */
export function retentionPolicy(): TableRetention[] {
  return [
    {
      table: "agent_locations",
      column: "created_at",
      days: env.retentionAgentLocationsDays,
      purpose: "GPS trail",
    },
    {
      table: "stock_movements",
      column: "created_at",
      days: env.retentionStockMovementsDays,
      purpose: "stock movement history",
    },
    {
      table: "audit_log",
      column: "created_at",
      days: env.retentionAuditLogDays,
      purpose: "audit trail",
    },
  ];
}

/**
 * The moment before which rows are eligible for deletion, or a refusal.
 *
 * `0` (or an unset variable) means keep forever — stated explicitly because the
 * failure mode of guessing here is deleting live data.
 */
export function resolveCutoff(days: number, now: number = Date.now()):
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string }
  | { action: "delete"; cutoff: Date } {
  if (!Number.isFinite(days) || days <= 0) {
    return { action: "skip", reason: "retention disabled (0 or unset) — keeping everything" };
  }
  if (days < MIN_RETENTION_DAYS) {
    return {
      action: "refuse",
      reason: `retention of ${days} days is below the ${MIN_RETENTION_DAYS}-day floor — refusing, this looks like a misconfiguration`,
    };
  }

  const cutoff = new Date(now - days * 86_400_000);
  if (cutoff.getTime() > now) {
    return { action: "refuse", reason: "computed cutoff is in the future — refusing" };
  }
  return { action: "delete", cutoff };
}

/** MySQL DATETIME literal — the raw statements below are not going through the ORM. */
function toSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

type Deleter = (table: string, column: string, cutoff: string, limit: number) => Promise<number>;

/** Batched delete against the real database. */
const deleteBatch: Deleter = async (table, column, cutoff, limit) => {
  // Identifiers come from the policy above, never from a request; values are bound.
  const result = await getDb().execute(
    sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} < ${cutoff} LIMIT ${limit}`,
  );
  const header = result as unknown as { affectedRows?: number } | Array<{ affectedRows?: number }>;
  const affected = Array.isArray(header) ? header[0]?.affectedRows : header.affectedRows;
  return Number(affected ?? 0);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Prune one table. Exported for tests, which pass their own `deleter`. */
export async function pruneTable(
  policy: TableRetention,
  now: number = Date.now(),
  deleter: Deleter = deleteBatch,
  /** Injectable so the batching tests don't have to wait out the real pauses. */
  pauseMs: number = PAUSE_BETWEEN_BATCHES_MS,
): Promise<TableResult> {
  const startedAt = Date.now();
  const decision = resolveCutoff(policy.days, now);

  if (decision.action !== "delete") {
    return {
      table: policy.table,
      status: decision.action === "skip" ? "skipped" : "refused",
      rowsDeleted: 0,
      capReached: false,
      reason: decision.reason,
      durationMs: Date.now() - startedAt,
    };
  }

  const cutoff = toSqlDateTime(decision.cutoff);
  let rowsDeleted = 0;
  let capReached = false;

  try {
    for (;;) {
      const remaining = MAX_ROWS_PER_RUN - rowsDeleted;
      if (remaining <= 0) {
        capReached = true;
        break;
      }
      const affected = await deleter(policy.table, policy.column, cutoff, Math.min(BATCH_SIZE, remaining));
      rowsDeleted += affected;
      // A short batch means the eligible rows are exhausted.
      if (affected < Math.min(BATCH_SIZE, remaining)) break;
      await sleep(pauseMs);
    }
  } catch (err) {
    return {
      table: policy.table,
      status: "failed",
      rowsDeleted,
      capReached,
      cutoff,
      reason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    table: policy.table,
    status: "deleted",
    rowsDeleted,
    capReached,
    cutoff,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Prune every configured table.
 *
 * Runs after the nightly backup on purpose: a row deleted here is already in that
 * night's dump, so retention never destroys data that was not captured first. One
 * table failing does not stop the others — a broken policy on the audit log should
 * not leave the GPS table growing.
 */
export async function runRetention(
  now: Date = new Date(),
  deleter?: Deleter,
  pauseMs?: number,
): Promise<RetentionResult> {
  const startedAt = Date.now();
  const results: TableResult[] = [];

  for (const policy of retentionPolicy()) {
    const result = await pruneTable(policy, now.getTime(), deleter, pauseMs);
    results.push(result);

    if (result.status === "failed") {
      logger.error("retention failed for table", { table: result.table, reason: result.reason });
    } else if (result.status === "refused") {
      logger.warn("retention refused", { table: result.table, reason: result.reason });
    } else if (result.status === "skipped") {
      logger.info("retention skipped", { table: result.table, reason: result.reason, purpose: policy.purpose });
    } else {
      logger.info("retention pruned table", {
        table: result.table,
        purpose: policy.purpose,
        rowsDeleted: result.rowsDeleted,
        keepDays: policy.days,
        cutoff: result.cutoff,
        capReached: result.capReached,
        durationMs: result.durationMs,
      });
      if (result.capReached) {
        logger.warn("retention hit its per-run cap, a backlog remains", {
          table: result.table,
          cap: MAX_ROWS_PER_RUN,
        });
      }
    }
  }

  const failed = results.filter(r => r.status === "failed");
  const totalDeleted = results.reduce((sum, r) => sum + r.rowsDeleted, 0);

  return {
    success: failed.length === 0,
    message: failed.length === 0
      ? `Очистка завершена: удалено ${totalDeleted} строк`
      : `Очистка завершена с ошибками (${failed.map(r => r.table).join(", ")}), удалено ${totalDeleted} строк`,
    tables: results,
    durationMs: Date.now() - startedAt,
  };
}

export const RETENTION_LIMITS = {
  BATCH_SIZE, MAX_ROWS_PER_RUN, MIN_RETENTION_DAYS, PAUSE_BETWEEN_BATCHES_MS,
} as const;

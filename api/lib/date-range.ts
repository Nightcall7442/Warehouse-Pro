import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

/**
 * Sargable replacements for `DATE(col) = x` / `DATE(col) >= x` predicates.
 *
 * Wrapping an indexed column in DATE() makes MySQL evaluate the function for
 * every row, so indexes like idx_orders_tenant_date can't be used and the query
 * degrades to a full table scan. Comparing the raw column against day boundaries
 * is exactly equivalent — DATE() only truncates the stored value — and keeps the
 * index usable.
 *
 * `day` is a "YYYY-MM-DD" string.
 */

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Equivalent of `DATE(col) = day` for a timestamp column. */
export function onDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} >= ${`${day} 00:00:00`} AND ${col} < ${`${nextDay(day)} 00:00:00`}`;
}

/** Equivalent of `DATE(col) >= day` for a timestamp column. */
export function sinceDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} >= ${`${day} 00:00:00`}`;
}

/**
 * Equivalent of `DATE(col) = day` for a DATE column, where DATE() is a no-op
 * that nevertheless blocks the index (e.g. idx_plans_tenant_date).
 */
export function onDate(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} = ${day}`;
}

/**
 * Equivalent of `DATE(col) <= day` for a DATE column.
 *
 * Used for effective-dated settings — the salary and commission rate that
 * were in force during the period being viewed, rather than whatever is set
 * today. DATE() around the column would work but block the index, same as
 * above.
 */
export function untilDate(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} <= ${day}`;
}

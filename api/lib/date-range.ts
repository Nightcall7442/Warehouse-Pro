import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { z } from "zod";

/**
 * Sargable replacements for `DATE(col) = x` / `DATE(col) >= x` predicates.
 *
 * Wrapping an indexed column in DATE() makes MySQL evaluate the function for
 * every row, so indexes like idx_orders_tenant_date can't be used and the query
 * degrades to a full table scan. Comparing the raw column against day boundaries
 * is exactly equivalent — DATE() only truncates the stored value — and keeps the
 * index usable.
 *
 * `day` is a "YYYY-MM-DD" string. Every helper here assumes the caller has run
 * the value through `safeDateParse` (or the `isoDaySchema` zod schema) first:
 * only a validated day produces a well-formed boundary literal.
 */

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FIX: P0.1 — validate user-supplied date filters before they reach a query.
 *
 * Returns the day unchanged when it is a real calendar date in "YYYY-MM-DD"
 * form, `null` otherwise. Callers skip the filter (or reject the request) on
 * `null` instead of feeding an arbitrary string into a comparison.
 *
 * The round-trip check is what rejects impossible dates: JS silently rolls
 * `2024-02-30` over to March 1st rather than failing, so a regex match plus a
 * successful `new Date()` is not enough on its own.
 */
export function safeDateParse(input: string | undefined | null): string | null {
  if (typeof input !== "string") return null;
  if (!ISO_DAY_RE.test(input)) return null;

  const d = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== input) return null;

  return input;
}

/**
 * Normalise a day that came back from the database: DATE columns are mapped to
 * `Date` objects, while API input arrives as a string. Returns `null` for
 * anything that isn't a usable day.
 */
export function toIsoDay(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return safeDateParse(value);
}

/** True when `input` is a valid "YYYY-MM-DD" day. */
export function isIsoDay(input: unknown): input is string {
  return typeof input === "string" && safeDateParse(input) !== null;
}

/** Reusable zod schema for date-filter inputs, so bad days are rejected at the API boundary. */
export const isoDaySchema = z
  .string()
  .refine(isIsoDay, { message: "Дата должна быть в формате ГГГГ-ММ-ДД" });

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
 * Equivalent of `DATE(col) <= day` for a timestamp column — an inclusive upper
 * bound that covers the whole of `day`.
 *
 * Replaces the `col <= '<day> 23:59:59'` idiom, which silently drops rows
 * stamped in the last second of the day when the column has fractional seconds
 * (`23:59:59.500 > 23:59:59`).
 */
export function beforeNextDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} < ${`${nextDay(day)} 00:00:00`}`;
}

/**
 * Equivalent of `DATE(col) = day` for a DATE column, where DATE() is a no-op
 * that nevertheless blocks the index (e.g. idx_plans_tenant_date).
 */
export function onDate(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} = ${day}`;
}

/** Inclusive `col <= day` for a DATE column (no time component to account for). */
export function untilDate(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} <= ${day}`;
}

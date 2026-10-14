import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { BUSINESS_OFFSET_MS } from "@contracts/business-time";

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

/* ═══════════════════════════════════════════════════════════════════════════
   Сутки — ташкентские.

   ── Что было ────────────────────────────────────────────────────────────────

   Граница дня бралась строкой «2026-10-13 00:00:00», а сессия MySQL живёт в
   UTC: TIMESTAMP сравнивался с полуночью по UTC, то есть с 05:00 по Ташкенту.
   Заказ в 03:30 тринадцатого числа уходил в отчёт, фильтр и график за
   двенадцатое — на любом компьютере. DATE(created_at) делил так же.

   ── Почему не сменить пояс сессии ───────────────────────────────────────────

   drizzle пишет TIMESTAMP через toISOString и читает с «+0000»: он сам
   считает, что сессия в UTC. С другим поясом все отметки времени разъехались
   бы на пять часов. Поэтому сессия остаётся в UTC, а граница дня переводится
   явно — здесь: полночь по Ташкенту — это 19:00 по UTC накануне.

   Колонки DATE (plan_date, arrival_date, period_start…) хранят сам день, и их
   переводить нельзя: для них onDate / untilDate ниже.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Полночь дня по Ташкенту — строкой в UTC, как её сравнивает сессия MySQL:
 * «2026-10-13» → «2026-10-12 19:00:00».
 *
 * Не день, а момент (с часами или «T») здесь — ошибка вызывающего: такую
 * строку молча обрезать нельзя, иначе граница уедет незаметно.
 */
export function dayStartUtc(day: string): string {
  if (!DAY_RE.test(day)) throw new Error(`dayStartUtc: ожидался день «ГГГГ-ММ-ДД», пришло «${day}»`);
  return new Date(Date.parse(`${day}T00:00:00Z`) - BUSINESS_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** То же для конца дня: полночь следующего дня по Ташкенту (граница не включается). */
export function dayEndUtc(day: string): string {
  return dayStartUtc(nextDay(day));
}

/** Equivalent of `DATE(col) = day` for a timestamp column — day by Tashkent. */
export function onDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} >= ${dayStartUtc(day)} AND ${col} < ${dayEndUtc(day)}`;
}

/** Equivalent of `DATE(col) >= day` for a timestamp column — day by Tashkent. */
export function sinceDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} >= ${dayStartUtc(day)}`;
}

/** Equivalent of `DATE(col) <= day` for a timestamp column — day by Tashkent. */
export function untilDay(col: AnyMySqlColumn, day: string): SQL {
  return sql`${col} < ${dayEndUtc(day)}`;
}

/**
 * Сдвиг TIMESTAMP в ташкентские часы — для DATE(), DATE_FORMAT() и HOUR():
 * DATE(${bizClock(col)}) — день по Ташкенту, а не по UTC.
 *
 * Сессия MySQL в UTC (см. выше), поэтому плюс пять часов — ровно Ташкент:
 * Узбекистан не переводит часы.
 */
export function bizClock(col: AnyMySqlColumn | SQL): SQL {
  return sql`(${col} + INTERVAL 5 HOUR)`;
}

/*
  В сыром SQL (db.execute) то же правило пишется текстом:
    сегодня по Ташкенту — DATE(UTC_TIMESTAMP() + INTERVAL 5 HOUR), а не CURDATE();
    день отметки — DATE(o.created_at + INTERVAL 5 HOUR), а не DATE(o.created_at);
    полночь дня из колонки DATE — d.plan_date - INTERVAL 5 HOUR.
  Стережёт api/__tests__/server-days-are-tashkent.test.ts.
*/

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

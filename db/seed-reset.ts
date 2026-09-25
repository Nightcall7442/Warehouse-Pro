import { sql } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import type { getDb } from "../api/queries/connection";
import { isRemoteHost } from "../api/queries/connection";
import * as schema from "./schema";

/**
 * Засев стирает ВСЕ данные базы — всех организаций, не только демо.
 *
 * Поэтому он работает только на локальной базе. Удалённая — Railway, любой
 * внешний хост — отказ, пока явно не сказано SEED_ALLOW_REMOTE=1. До
 * 25.09.2026 защиты не было вовсе, а шапка seed.ts прямо предлагала
 * «populates Railway MySQL»: один запуск с боевым DATABASE_URL стёр бы всех
 * клиентов.
 */
export function assertSeedTarget(databaseUrl: string, allowRemote = process.env.SEED_ALLOW_REMOTE === "1"): void {
  let parsed = true;
  try { new URL(databaseUrl); } catch { parsed = false; }
  if (!parsed || (isRemoteHost(databaseUrl) && !allowRemote)) {
    const host = parsed ? new URL(databaseUrl).hostname : "(адрес не разобран)";
    throw new Error(`Засев стирает все таблицы, а база ${host} не локальная. Отказ. Если это правда нужно — SEED_ALLOW_REMOTE=1.`);
  }
}

/** Все таблицы схемы — чтобы новая таблица не требовала правки уборки. */
export function allTables(): MySqlTable[] {
  return Object.values(schema as Record<string, unknown>).filter((v): v is MySqlTable => v instanceof MySqlTable);
}

/**
 * Очистить все таблицы схемы.
 *
 * Раньше уборка была списком из 24 таблиц, а внешними ключами связаны 58:
 * commissions, salary_payouts, returns, прайс-листы… Повторный засев на
 * уже засеянной базе падал на «delete from users» (commissions ссылается на
 * users). В CI база чистая, и этого не было видно.
 *
 * Проверка ключей выключается на время уборки — порядок таблиц тогда не
 * важен. Флаг живёт в соединении, поэтому всё — одной транзакцией (одно
 * соединение из пула), и флаг возвращается в finally, даже если удаление
 * упало.
 */
export async function wipeAll(db: ReturnType<typeof getDb>): Promise<number> {
  const tables = allTables();
  await db.transaction(async tx => {
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    try {
      for (const t of tables) await tx.delete(t);
    } finally {
      await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    }
  });
  return tables.length;
}

import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { isDataImage, uploadBase64ToS3 } from "../lib/photo-upload";
import { isS3Configured } from "../lib/s3";
import { firstRow, rowsOf } from "../lib/db-rows";

/*
  Старые фото — из базы в хранилище.

  До появления S3 картинки клались в базу как data:-строки (mediumtext и
  json-списки). Они там и остались: каждая ночная копия, каждый дамп и
  каждая репетиция восстановления носят их с собой, а список товаров без
  api/photos.ts тянул мегабайты. Новые фото давно уходят в S3; эти —
  переносятся здесь, ночью, пачкой за раз, и в базе остаётся адрес.

  Без настроенного S3 работа не делает ничего и говорит об этом.
  Одна строка за раз, обновление — по прежнему значению (WHERE … = old):
  если фото сменили, пока оно грузилось, старое не затрёт новое.
*/

/** Колонки с одиночным фото: таблица, колонка, папка в хранилище. */
const SINGLE: Array<{ table: string; column: string; folder: string }> = [
  { table: "products",    column: "photo_url", folder: "products" },
  { table: "shops",       column: "photo_url", folder: "shops" },
  { table: "daily_plans", column: "photo_url", folder: "visits" },
  { table: "users",       column: "avatar",    folder: "avatars" },
];

/** Колонки со списком фото (json). */
const LISTS: Array<{ table: string; column: string; folder: string }> = [
  { table: "visit_reports",     column: "photos",        folder: "visits" },
  { table: "order_adjustments", column: "photos",        folder: "orders" },
  { table: "returns",           column: "return_photos", folder: "returns" },
];

export const OFFLOAD_BATCH = 200;

export async function runPhotoOffload(db = getDb(), batch = OFFLOAD_BATCH): Promise<{ moved: number; failed: number; skipped: string | null }> {
  if (!isS3Configured()) return { moved: 0, failed: 0, skipped: "S3 не настроен — фото остаются в базе" };
  let moved = 0, failed = 0, budget = batch;

  for (const { table, column, folder } of SINGLE) {
    if (budget <= 0) break;
    const rows = rowsOf<{ id: number; tenant_id: number; value: string }>(await db.execute(sql`
      SELECT id, tenant_id, ${sql.identifier(column)} AS value FROM ${sql.identifier(table)}
      WHERE ${sql.identifier(column)} LIKE 'data:image/%' LIMIT ${budget}
    `));
    for (const r of rows) {
      budget--;
      try {
        const url = await uploadBase64ToS3(r.value, folder, r.tenant_id);
        if (url === r.value) { failed++; continue; }
        await db.execute(sql`
          UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${url}
          WHERE id = ${r.id} AND ${sql.identifier(column)} = ${r.value}
        `);
        moved++;
      } catch (e) {
        failed++;
        logger.warn("photo offload failed", { table, id: r.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  for (const { table, column, folder } of LISTS) {
    if (budget <= 0) break;
    const rows = rowsOf<{ id: number; tenant_id: number; value: unknown }>(await db.execute(sql`
      SELECT id, tenant_id, ${sql.identifier(column)} AS value FROM ${sql.identifier(table)}
      WHERE CAST(${sql.identifier(column)} AS CHAR) LIKE '%data:image/%' LIMIT ${budget}
    `));
    for (const r of rows) {
      budget--;
      try {
        const list: string[] = Array.isArray(r.value) ? r.value : JSON.parse(String(r.value ?? "[]"));
        const next: string[] = [];
        for (const item of list) next.push(isDataImage(item) ? await uploadBase64ToS3(item, folder, r.tenant_id) : item);
        if (next.some(isDataImage)) { failed++; continue; }
        await db.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${JSON.stringify(next)} WHERE id = ${r.id}`);
        moved++;
      } catch (e) {
        failed++;
        logger.warn("photo offload failed", { table, id: r.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (moved + failed > 0) logger.info("photo offload", { moved, failed });
  return { moved, failed, skipped: null };
}

/** Сколько фото ещё лежит в базе — для сводки и для «когда закончится». */
export async function photosStillInDb(db = getDb()): Promise<number> {
  let total = 0;
  for (const { table, column } of SINGLE) {
    const r = firstRow<{ n: unknown }>(await db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} LIKE 'data:image/%'`));
    total += Number(r?.n ?? 0);
  }
  for (const { table, column } of LISTS) {
    const r = firstRow<{ n: unknown }>(await db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE CAST(${sql.identifier(column)} AS CHAR) LIKE '%data:image/%'`));
    total += Number(r?.n ?? 0);
  }
  return total;
}

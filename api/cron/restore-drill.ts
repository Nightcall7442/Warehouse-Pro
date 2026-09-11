import { gunzipSync } from "node:zlib";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { s3Client } from "../lib/s3";
import { parseDatabaseUrl } from "../services/db-dump";
import { restoreDrillLastSuccessTimestamp } from "../prometheus-metrics";

/*
  Репетиция восстановления.

  Копия, которую никто не разворачивал, — не копия, а надежда. Здесь раз в
  неделю берётся ПОСЛЕДНЯЯ загруженная копия из хранилища (не свежий дамп —
  проверяется вся цепочка: снять → загрузить → скачать → развернуть),
  разворачивается в отдельную базу на том же сервере, сверяется число строк
  с тем, что было записано в момент снятия, и база стирается.

  ponytail: тот же сервер MySQL — доказывает, что копия разворачивается, но не
  то, что площадка переживёт потерю сервера. Разворачивать на второй площадке,
  когда она появится (Q3 — зеркало R2/B2 уже есть).
*/

const TABLES_TO_CHECK = ["tenants", "users", "products", "orders", "order_items", "shops", "warehouse_stock", "payments"];

/**
 * Разбить текст копии на выражения. Тела триггеров и процедур обёрнуты в
 * `DELIMITER ;;` — внутри них точка с запятой не конец выражения.
 */
export function splitStatements(sqlText: string): string[] {
  const out: string[] = [];
  let delimiter = ";";
  let buf: string[] = [];
  for (const rawLine of sqlText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const m = /^DELIMITER\s+(\S+)\s*$/.exec(line);
    if (m) { delimiter = m[1]; continue; }
    if (buf.length === 0 && (line.trim() === "" || line.startsWith("--"))) continue;
    buf.push(line);
    if (line.trimEnd().endsWith(delimiter)) {
      const text = buf.join("\n").trimEnd();
      out.push(text.slice(0, text.length - delimiter.length).trim());
      buf = [];
    }
  }
  const rest = buf.join("\n").trim();
  if (rest) out.push(rest);
  return out.filter(s => s.length > 0);
}

export function scratchDatabaseName(database: string): string {
  return `${database}_restore_drill`;
}

async function latestBackup(): Promise<{ bucket: string; key: string; body: Buffer; counts: Record<string, number> | null }> {
  const { ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = (process.env.S3_BACKUP_BUCKET ?? "").trim() || env.s3Bucket;
  const s3 = await s3Client();
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/warehouse-pro-" }));
  const newest = (listed.Contents ?? [])
    .filter(o => o.Key && o.LastModified)
    .sort((a, b) => b.LastModified!.getTime() - a.LastModified!.getTime())[0];
  if (!newest?.Key) throw new Error(`в хранилище ${bucket} нет ни одной копии под backups/`);

  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: newest.Key }));
  const bytes = await got.Body!.transformToByteArray();
  // S3 отдаёт метаданные строчными ключами.
  const meta = got.Metadata ?? {};
  const raw = meta.tablecounts ?? meta.tableCounts;
  let counts: Record<string, number> | null = null;
  try { counts = raw ? (JSON.parse(raw) as Record<string, number>) : null; } catch { counts = null; }
  return { bucket, key: newest.Key, body: Buffer.from(bytes), counts };
}

/**
 * Развернуть текст копии в черновую базу на том же сервере, сверить числа
 * строк с записанными при снятии, стереть черновую базу.
 */
export async function restoreAndVerify(
  databaseUrl: string, sqlText: string, counts: Record<string, number> | null,
): Promise<{ statements: number; restored: Record<string, number> }> {
  const creds = parseDatabaseUrl(databaseUrl);
  const scratch = scratchDatabaseName(creds.database);
  const statements = splitStatements(sqlText);
  if (statements.length === 0) throw new Error("копия пуста");

  const conn = await mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: 30_000,
    // Как в services/db-dump.ts: у облачного MySQL самоподписанный сертификат.
    ...(creds.host !== "localhost" && creds.host !== "127.0.0.1" ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS ${conn.escapeId(scratch)}`);
    await conn.query(`CREATE DATABASE ${conn.escapeId(scratch)} CHARACTER SET utf8mb4`);
    await conn.query(`USE ${conn.escapeId(scratch)}`);
    for (const st of statements) await conn.query(st);

    const mismatches: string[] = [];
    const restored: Record<string, number> = {};
    for (const table of TABLES_TO_CHECK) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM ${conn.escapeId(table)}`);
      const n = Number((rows as Array<{ c: unknown }>)[0]?.c ?? 0);
      restored[table] = n;
      const expected = counts?.[table];
      if (expected != null && expected >= 0 && expected !== n) mismatches.push(`${table}: в копии ${n}, при снятии ${expected}`);
    }
    if (mismatches.length > 0) throw new Error(`копия развернулась, но числа не сходятся — ${mismatches.join("; ")}`);
    return { statements: statements.length, restored };
  } finally {
    try { await conn.query(`DROP DATABASE IF EXISTS ${conn.escapeId(scratch)}`); } catch (e) {
      logger.warn("Репетиция: не удалось стереть черновую базу", { scratch, error: e instanceof Error ? e.message : String(e) });
    }
    conn.end().catch(() => conn.destroy());
  }
}

export async function runRestoreDrill(): Promise<{ success: boolean; message: string }> {
  if (!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey)) {
    return { success: false, message: "Репетиция не проведена: хранилище копий не настроено" };
  }
  const startedAt = Date.now();
  const { bucket, key, body, counts } = await latestBackup();
  const { statements, restored } = await restoreAndVerify(env.databaseUrl, gunzipSync(body).toString("utf8"), counts);

  restoreDrillLastSuccessTimestamp.set(Math.floor(Date.now() / 1000));
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  logger.info("Репетиция восстановления прошла", { bucket, key, statements, restored, seconds });
  return { success: true, message: `Копия ${key} развёрнута и сверена за ${seconds} с (${statements} выражений)` };
}

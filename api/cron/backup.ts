import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { gzipSync } from "zlib";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { env } from "../lib/env";

import { firstRow } from "../lib/db-rows";
/**
 * Database backup cron job
 * Runs daily at 3 AM UTC
 *
 * Produces a real, restorable `mysqldump` of the database, gzips it, and
 * uploads it to S3. Requires `mysqldump` on PATH (see Dockerfile) and S3
 * credentials — without S3 there is nowhere durable to put the dump (the
 * container's filesystem doesn't survive a redeploy), so that case is
 * reported as a failure rather than a false "success".
 */
export async function runBackup(): Promise<{ success: boolean; message: string }> {
  const timestamp = new Date().toISOString().split("T")[0];
  // Имя дампа больше не выводится из одной только даты.
  //
  // Раньше ключ был ровно `backups/warehouse-pro-<дата>.sql.gz` и лежал в том
  // же бакете, из которого сервер раздаёт фото товаров и магазинов голым
  // адресом вида https://<бакет>.s3.<регион>.amazonaws.com/<ключ>. Имя бакета и
  // регион уходят клиенту в каждом списке товаров, то есть известны любому, кто
  // хоть раз открыл карточку. Дальше подставить предсказуемый ключ — вопрос
  // одной строки, а внутри дампа вся база: все арендаторы, users.password_hash,
  // api_keys.key_hash, телефоны и долги магазинов.
  //
  // Случайный суффикс делает адрес неугадываемым даже если политика бакета
  // по-прежнему пускает читать что угодно; полный ключ пишется в лог, оттуда
  // его берут при восстановлении.
  const backupKey = `backups/warehouse-pro-${timestamp}-${randomBytes(12).toString("hex")}.sql.gz`;

  // Sanity-check table counts alongside the dump — if the dump silently
  // produced far fewer rows than the live tables have, something's wrong.
  const tables = ["tenants", "users", "products", "orders", "order_items", "shops", "warehouse_stock", "payments"];
  const counts: Record<string, number> = {};
  try {
    const db = getDb();
    for (const table of tables) {
      try {
        const result = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = Number(firstRow<{ count: number }>(result)?.count ?? 0);
      } catch {
        counts[table] = -1;
      }
    }
  } catch (err) {
    logger.error("Backup: failed to read table counts", { error: err instanceof Error ? err.message : String(err) });
  }

  if (!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey)) {
    logger.error("Backup skipped — no S3 configured, dump has nowhere durable to go", { counts });
    return { success: false, message: "Backup NOT performed: S3 is not configured, so there is no durable storage for the dump" };
  }

  let parsed: URL;
  try {
    parsed = new URL(env.databaseUrl);
  } catch {
    return { success: false, message: "Backup failed: could not parse DATABASE_URL" };
  }
  const dbHost = parsed.hostname;
  const dbPort = parsed.port || "3306";
  const dbUser = decodeURIComponent(parsed.username);
  const dbPassword = decodeURIComponent(parsed.password);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbHost || !dbUser || !dbName) {
    return { success: false, message: "Backup failed: DATABASE_URL is missing host/user/database" };
  }

  try {
    const dump = await new Promise<Buffer>((resolve, reject) => {
      const args = [
        "--single-transaction", // consistent InnoDB snapshot without locking tables
        "--quick",              // stream rows instead of buffering the whole table
        "--routines",
        "--triggers",
        `--host=${dbHost}`,
        `--port=${dbPort}`,
        `--user=${dbUser}`,
        dbName,
      ];
      // Password via env var (MYSQL_PWD), not argv, so it doesn't show up in `ps`.
      const child = spawn("mysqldump", args, { env: { ...process.env, MYSQL_PWD: dbPassword } });

      const chunks: Buffer[] = [];
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
      child.on("error", reject); // e.g. mysqldump binary not found
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`mysqldump exited with code ${code}: ${stderr.slice(0, 2000)}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });

    if (dump.length === 0) {
      throw new Error("mysqldump produced an empty output");
    }

    const gzipped = gzipSync(dump);

    // Дамп кладётся в отдельный бакет, а не туда, откуда раздаются фото.
    //
    // S3_BACKUP_BUCKET — приватный бакет только под резервные копии: у него своя
    // политика, и «читать может кто угодно», нужное фотографиям, на него не
    // распространяется. Пока переменная не задана, копия всё же делается — база
    // без бэкапа опаснее бэкапа в общем бакете, — но в лог уходит
    // предупреждение, и в общем бакете она лежит под неугадываемым ключом.
    const backupBucket = (process.env.S3_BACKUP_BUCKET ?? "").trim();
    const targetBucket = backupBucket || env.s3Bucket;
    if (!backupBucket) {
      logger.warn(
        "Backup: S3_BACKUP_BUCKET is not set — the dump goes into the same bucket that serves public photos",
        { bucket: env.s3Bucket },
      );
    }

    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: env.s3Region || "us-east-1",
      credentials: {
        accessKeyId: env.s3AccessKey,
        secretAccessKey: env.s3SecretKey,
      },
    });
    await s3.send(new PutObjectCommand({
      Bucket: targetBucket,
      Key: backupKey,
      Body: gzipped,
      ContentType: "application/gzip",
      // Шифрование на стороне S3: тот, кто получит доступ к самому хранилищу в
      // обход API (снятый том, чужая реплика), получит нечитаемый файл.
      // ACL здесь намеренно не передаётся: у бакетов с Object Ownership =
      // BucketOwnerEnforced любой ACL в запросе — ошибка, и бэкап бы просто
      // перестал загружаться.
      ServerSideEncryption: "AES256",
      Metadata: { tableCounts: JSON.stringify(counts) },
    }));

    logger.info("Backup dump uploaded to S3", { bucket: targetBucket, key: backupKey, rawBytes: dump.length, gzippedBytes: gzipped.length, counts });
    return { success: true, message: `Backup saved: ${backupKey} (${(gzipped.length / 1024 / 1024).toFixed(1)} MB gzipped)` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Backup failed", { error });
    return { success: false, message: `Backup failed: ${error}` };
  }
}

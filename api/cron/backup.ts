import { spawn } from "child_process";
import { gzipSync } from "zlib";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { firstRow } from "../lib/db-rows";

/**
 * Database backup — daily cron job.
 *
 * 1. mysqldump --single-transaction (consistent InnoDB snapshot, no locks)
 * 2. gzip → S3
 * 3. Verify: gunzip first 1KB, check for SQL markers
 * 4. Retention: delete backups older than 30 days
 * 5. Telegram alert on failure
 */

const BACKUP_PREFIX = "backups/warehouse-pro-";
const RETENTION_DAYS = 30;

// In-memory status for /health endpoint
export let lastBackup: {
  date: string;
  success: boolean;
  message: string;
  bytes?: number;
  tables?: Record<string, number>;
} | null = null;

export async function runBackup(): Promise<{ success: boolean; message: string }> {
  const now = new Date();
  const timestamp = now.toISOString().split("T")[0];
  const backupKey = `${BACKUP_PREFIX}${timestamp}.sql.gz`;

  // ── 1. Table counts (for verification) ──────────────────────────
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

  // ── 2. Check storage options ──────────────────────────────────────
  const hasS3 = !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);
  const hasTelegram = !!(env.telegramBotToken && env.telegramAdminChatId);

  if (!hasS3 && !hasTelegram) {
    const msg = "Neither S3 nor Telegram configured — backup has nowhere to go";
    logger.error("Backup skipped", { counts, reason: msg });
    lastBackup = { date: timestamp, success: false, message: msg };
    return { success: false, message: msg };
  }

  // ── 3. Parse DATABASE_URL ────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(env.databaseUrl);
  } catch {
    const msg = "Could not parse DATABASE_URL";
    lastBackup = { date: timestamp, success: false, message: msg };
    return { success: false, message: msg };
  }
  const dbHost = parsed.hostname;
  const dbPort = parsed.port || "3306";
  const dbUser = decodeURIComponent(parsed.username);
  const dbPassword = decodeURIComponent(parsed.password);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbHost || !dbUser || !dbName) {
    const msg = "DATABASE_URL missing host/user/database";
    lastBackup = { date: timestamp, success: false, message: msg };
    return { success: false, message: msg };
  }

  // ── 4. Create dump ─────────────────────────────────────────────
  try {
    let dump: Buffer;

    // Try mariadb-dump first (fast, streams directly)
    try {
      dump = await new Promise<Buffer>((resolve, reject) => {
        const args = [
          "--single-transaction",
          "--quick",
          "--routines",
          "--triggers",
          `--host=${dbHost}`,
          `--port=${dbPort}`,
          `--user=${dbUser}`,
          dbName,
        ];
        const child = spawn("mariadb-dump", args, { env: { ...process.env, MYSQL_PWD: dbPassword } });

        const chunks: Buffer[] = [];
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`mariadb-dump exited with code ${code}: ${stderr.slice(0, 2000)}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      });
    } catch (mariadbErr) {
      // Fallback: Node.js mysql2 driver (works with caching_sha2_password)
      logger.warn("mariadb-dump failed, falling back to mysql2 driver", {
        error: mariadbErr instanceof Error ? mariadbErr.message : String(mariadbErr),
      });
      const { createDumpBuffer } = await import("../services/db-dump-native");
      dump = await createDumpBuffer();
    }

    if (dump.length === 0) throw new Error("Dump produced empty output");

    // ── 5. Verify dump is valid SQL ──────────────────────────────
    const head = dump.slice(0, 2048).toString("utf8");
    if (!head.includes("-- MySQL dump") && !head.includes("-- MariaDB") && !head.includes("CREATE TABLE")) {
      throw new Error(`Dump verification failed: missing SQL markers in first 2KB (got: ${head.slice(0, 200)})`);
    }

    const gzipped = gzipSync(dump);

    // ── 6. Store backup ─────────────────────────────────────────
    let storageMsg = "";

    if (hasS3) {
      // Upload to S3
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: env.s3Region || "us-east-1",
        credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
      });

      await s3.send(new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: backupKey,
        Body: gzipped,
        ContentType: "application/gzip",
        Metadata: {
          tableCounts: JSON.stringify(counts),
          dumpBytes: String(dump.length),
          verified: "true",
        },
      }));

      // Retention: delete old backups
      let deleted = 0;
      try {
        const { ListObjectsV2Command, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
        const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);

        let continuationToken: string | undefined;
        do {
          const list = await s3.send(new ListObjectsV2Command({
            Bucket: env.s3Bucket,
            Prefix: BACKUP_PREFIX,
            ContinuationToken: continuationToken,
          }));

          for (const obj of list.Contents ?? []) {
            if (obj.LastModified && obj.LastModified < cutoff && obj.Key) {
              await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: obj.Key }));
              deleted++;
            }
          }
          continuationToken = list.NextContinuationToken;
        } while (continuationToken);
      } catch (retErr) {
        logger.warn("Backup retention cleanup failed (non-fatal)", { error: retErr instanceof Error ? retErr.message : String(retErr) });
      }

      storageMsg = `S3: ${backupKey}${deleted > 0 ? ` (cleaned ${deleted} old)` : ""}`;

    } else {
      // Send to Telegram as document
      const { sendTelegramDocument } = await import("../telegram-router");
      const caption = `📦 Backup ${timestamp}\n${Object.entries(counts).map(([t, c]) => `${t}: ${c}`).join("\n")}`;
      const sent = await sendTelegramDocument(env.telegramAdminChatId, gzipped, `warehouse-pro-${timestamp}.sql.gz`, caption);

      if (!sent) throw new Error("Failed to send backup to Telegram");
      storageMsg = `Telegram: warehouse-pro-${timestamp}.sql.gz (${(gzipped.length / 1024 / 1024).toFixed(1)} MB)`;
    }

    // ── 7. Success ──────────────────────────────────────────────
    logger.info("Backup complete", { key: backupKey, rawBytes: dump.length, gzippedBytes: gzipped.length, counts, storage: storageMsg });
    lastBackup = { date: timestamp, success: true, message: storageMsg, bytes: gzipped.length, tables: counts };

    return { success: true, message: `Backup saved: ${storageMsg}` };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Backup failed", { error });
    lastBackup = { date: timestamp, success: false, message: error };
    await notifyAdmin(`🔴 Backup FAILED: ${error}`);
    return { success: false, message: `Backup failed: ${error}` };
  }
}

async function notifyAdmin(text: string): Promise<void> {
  try {
    const { notifyAdmin: send } = await import("../telegram-router");
    send(text);
  } catch { /* Telegram not configured */ }
}

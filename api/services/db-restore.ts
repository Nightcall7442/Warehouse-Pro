import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { parseDatabaseUrl } from "./db-dump";

/**
 * Restore a gzipped SQL dump into the database.
 *
 * Safety:
 * - Only superadmin can trigger (enforced by the endpoint)
 * - Requires explicit `confirm: true` in the request body
 * - Logs the operation to audit log before executing
 * - Streams the dump through gunzip → mysql client
 * - Returns success/error after mysql exits
 */

export interface RestoreResult {
  success: boolean;
  message: string;
  tablesRestored?: number;
  rowsAffected?: number;
}

/**
 * Restore from a gzipped SQL stream (e.g. downloaded from S3).
 */
export async function restoreFromStream(dumpStream: Readable): Promise<RestoreResult> {
  const creds = parseDatabaseUrl(env.databaseUrl);

  return new Promise<RestoreResult>((resolve) => {
    const gunzip = createGunzip();
    // Use mariadb client (Alpine's mysql-client package)
    const mysql = spawn("mariadb", [
      `--host=${creds.host}`,
      `--port=${creds.port}`,
      `--user=${creds.user}`,
      `--database=${creds.database}`,
      "--default-character-set=utf8mb4",
    ], { env: { ...process.env, MYSQL_PWD: creds.password } });

    let stderr = "";
    let stdout = "";
    mysql.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    mysql.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });

    dumpStream.pipe(gunzip).pipe(mysql.stdin);

    mysql.stdin.on("error", (e) => {
      // EPIPE is expected when mysql exits early (e.g. syntax error in dump)
      if ((e as NodeJS.ErrnoException).code !== "EPIPE") {
        logger.error("Restore: stdin error", { error: e.message });
      }
    });

    mysql.on("close", (code) => {
      if (code === 0) {
        // Count tables restored from stdout
        const tableCount = (stdout.match(/Query OK/g) ?? []).length;
        const rowsAffected = stdout.match(/(\d+) rows affected/)?.[1];
        resolve({
          success: true,
          message: `Restore completed successfully${tableCount > 0 ? ` (${tableCount} operations)` : ""}`,
          tablesRestored: tableCount,
          rowsAffected: rowsAffected ? parseInt(rowsAffected) : undefined,
        });
      } else {
        const errorMsg = stderr.slice(0, 2000) || `mysql exited with code ${code}`;
        logger.error("Restore failed", { code, stderr: stderr.slice(0, 1000) });
        resolve({ success: false, message: `Restore failed: ${errorMsg}` });
      }
    });

    mysql.on("error", (e) => {
      logger.error("Restore: mysql process error", { error: e.message });
      resolve({ success: false, message: `Restore failed: ${e.message}` });
    });
  });
}

/**
 * Download a backup from S3 and restore it.
 */
export async function restoreFromS3(backupKey: string): Promise<RestoreResult> {
  if (!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey)) {
    return { success: false, message: "S3 not configured" };
  }

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: env.s3Region || "us-east-1",
    credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
  });

  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: backupKey,
    }));

    if (!response.Body) {
      return { success: false, message: "Backup file is empty" };
    }

    // Convert AWS stream to Node stream
    const { Readable } = await import("node:stream");
    const body = response.Body as { transformToByteArray: () => Promise<Uint8Array> };
    const bytes = await body.transformToByteArray();
    const stream = Readable.from(Buffer.from(bytes));

    return restoreFromStream(stream);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Restore: S3 download failed", { key: backupKey, error });
    return { success: false, message: `Failed to download backup: ${error}` };
  }
}

import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { gzipSync } from "zlib";

/**
 * Incremental backup — dumps only rows modified since `sinceDate`.
 *
 * Uses `updatedAt` column (present on most tables) to identify changed rows.
 * Produces a SQL file with INSERT ... ON DUPLICATE KEY UPDATE statements,
 * so it can be safely applied to any existing database.
 *
 * Limitations:
 * - Only works for tables with `updatedAt` column
 * - Cannot capture DELETEs (rows are gone)
 * - Cannot capture schema changes
 *
 * For full recovery, always use a full backup as the base.
 */

const TRACKED_TABLES = [
  { table: "orders", idCol: "id" },
  { table: "order_items", idCol: "id" },
  { table: "products", idCol: "id" },
  { table: "shops", idCol: "id" },
  { table: "warehouse_stock", idCol: "id" },
  { table: "payments", idCol: "id" },
  { table: "arrivals", idCol: "id" },
  { table: "arrival_items", idCol: "id" },
  { table: "returns", idCol: "id" },
  { table: "users", idCol: "id" },
  { table: "tenants", idCol: "id" },
  { table: "agent_locations", idCol: "id" },
  { table: "daily_plans", idCol: "id" },
  { table: "visit_reports", idCol: "id" },
  { table: "notifications", idCol: "id" },
];

function escapeLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`;
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function runIncrementalBackup(sinceDate: Date): Promise<{ success: boolean; message: string; tables: Record<string, number> }> {
  if (!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey)) {
    return { success: false, message: "S3 not configured", tables: {} };
  }

  const db = getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sinceStr = sinceDate.toISOString().slice(0, 19).replace("T", " ");
  const backupKey = `backups/incremental/warehouse-pro-inc-${timestamp}.sql.gz`;

  let sql = `-- Incremental backup since ${sinceStr}\n`;
  sql += `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;

  const tableCounts: Record<string, number> = {};
  let totalRows = 0;

  for (const { table, idCol } of TRACKED_TABLES) {
    try {
      // Get column names
      const [colRows] = await db.execute(
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
        [table]
      ) as unknown as [Array<{ c: string }>, unknown];

      if (!colRows || colRows.length === 0) {
        tableCounts[table] = 0;
        continue;
      }

      const columns = colRows.map(r => r.c);
      const colList = columns.map(c => `\`${c}\``).join(", ");

      // Get changed rows
      const [rows] = await db.execute(
        `SELECT * FROM \`${table}\` WHERE \`updated_at\` >= ? ORDER BY \`updated_at\``,
        [sinceStr]
      ) as unknown as [Array<Record<string, unknown>>, unknown];

      if (rows.length === 0) {
        tableCounts[table] = 0;
        continue;
      }

      // Build INSERT ... ON DUPLICATE KEY UPDATE
      const updateParts = columns
        .filter(c => c !== idCol)
        .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
        .join(", ");

      let batch: string[] = [];
      let batchBytes = 0;

      for (const row of rows) {
        const values = columns.map(c => escapeLiteral(row[c])).join(", ");
        const tuple = `(${values})`;
        batch.push(tuple);
        batchBytes += tuple.length + 2;

        if (batchBytes >= 300_000 || batch.length >= 500) {
          sql += `INSERT INTO \`${table}\` (${colList}) VALUES\n${batch.join(",\n")}\nON DUPLICATE KEY UPDATE ${updateParts};\n`;
          batch = [];
          batchBytes = 0;
        }
      }

      if (batch.length > 0) {
        sql += `INSERT INTO \`${table}\` (${colList}) VALUES\n${batch.join(",\n")}\nON DUPLICATE KEY UPDATE ${updateParts};\n`;
      }

      sql += "\n";
      tableCounts[table] = rows.length;
      totalRows += rows.length;
    } catch (err) {
      logger.warn(`Incremental backup: failed to dump table ${table}`, { error: err instanceof Error ? err.message : String(err) });
      tableCounts[table] = -1;
    }
  }

  sql += `SET FOREIGN_KEY_CHECKS = 1;\n`;

  if (totalRows === 0) {
    return { success: true, message: "No changes since last backup", tables: tableCounts };
  }

  // Compress and upload
  const gzipped = gzipSync(Buffer.from(sql, "utf8"));

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
      since: sinceStr,
      tableCounts: JSON.stringify(tableCounts),
      totalRows: String(totalRows),
      type: "incremental",
    },
  }));

  logger.info("Incremental backup saved", { key: backupKey, since: sinceStr, totalRows, tableCounts });
  return {
    success: true,
    message: `Incremental backup saved: ${backupKey} (${totalRows} rows, ${(gzipped.length / 1024).toFixed(0)} KB)`,
    tables: tableCounts,
  };
}

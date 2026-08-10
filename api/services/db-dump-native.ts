import { createConnection } from "mysql2/promise";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { parseDatabaseUrl } from "./db-dump";

/**
 * SQL dump using mysql2 driver — works with MySQL 8's caching_sha2_password.
 *
 * Fallback for environments where mariadb-dump can't authenticate (Alpine + MySQL 8).
 * Returns raw SQL buffer (not gzipped) — caller handles compression.
 */
export async function createDumpBuffer(): Promise<Buffer> {
  const creds = parseDatabaseUrl(env.databaseUrl);

  const conn = await createConnection({
    host: creds.host,
    port: parseInt(creds.port) || 3306,
    user: creds.user,
    password: creds.password,
    database: creds.database,
    ssl: creds.host.includes("railway") ? { rejectUnauthorized: false } : undefined,
    decimalNumbers: false,
    dateStrings: true,
  });

  const parts: string[] = [];
  const write = (text: string) => { parts.push(text); };

  const q = async (sql: string, params?: unknown[]) => {
    const [rows] = await conn.query(sql, params);
    return rows as Array<Record<string, unknown>>;
  };

  // Header
  const [{ db }] = await q("SELECT DATABASE() AS db") as Array<{ db: string }>;
  write(
    `-- Warehouse Pro backup of \`${db}\`\n` +
    `-- ${new Date().toISOString()}\n` +
    `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n`
  );

  // Get all tables
  const tables = (
    await q(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [db]
    )
  ).map(r => r.t as string);

  let totalRows = 0;

  for (const table of tables) {
    // DDL
    const [{ "Create Table": ddl }] = await q(`SHOW CREATE TABLE \`${table}\``) as Array<{ "Create Table": string }>;
    write(`DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`);

    // Columns
    const columns = (
      await q(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
        [db, table]
      )
    ).map(r => r.c as string);
    const colList = columns.map(c => `\`${c}\``).join(", ");

    // Stream rows
    const stream = (conn as any).connection.query(`SELECT * FROM \`${table}\``).stream();
    let batch: string[] = [];
    let rowCount = 0;

    const literal = (v: unknown): string => {
      if (v === null || v === undefined) return "NULL";
      if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
      if (typeof v === "number" || typeof v === "bigint") return String(v);
      if (typeof v === "boolean") return v ? "1" : "0";
      if (typeof v === "object") return `'${JSON.stringify(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    };

    for await (const row of stream) {
      const tuple = `(${columns.map(c => literal(row[c])).join(", ")})`;
      batch.push(tuple);
      rowCount++;

      if (batch.length >= 500) {
        write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${batch.join(",\n")};\n`);
        batch = [];
      }
    }
    if (batch.length > 0) {
      write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${batch.join(",\n")};\n`);
    }
    write("\n");
    totalRows += rowCount;
    logger.info(`dump: ${table}`, { rows: rowCount });
  }

  write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  await conn.end();

  const result = Buffer.from(parts.join(""), "utf8");
  logger.info("dump complete", { tables: tables.length, rows: totalRows, bytes: result.length });

  return result;
}

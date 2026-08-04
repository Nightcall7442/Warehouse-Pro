/**
 * Produces a restorable SQL dump of a MySQL database using the mysql2 driver
 * that already ships with the project — the local mysqldump is a MariaDB
 * build and cannot authenticate against MySQL 8's caching_sha2_password.
 *
 * Reads only. Streams each table row-by-row so memory stays flat regardless
 * of table size, and writes INSERTs in batches so the restore is quick.
 */
import { createConnection } from "mysql2/promise";
import { createWriteStream } from "node:fs";
import { once } from "node:events";

const [, , url, outPath] = process.argv;
if (!url || !outPath) {
  console.error("usage: node dump-db.mjs <mysql-url> <out.sql>");
  process.exit(1);
}

const conn = await createConnection({
  uri: url,
  ssl: { rejectUnauthorized: false },
  // Keep decimals/dates as strings so values round-trip exactly.
  decimalNumbers: false,
  dateStrings: true,
});

const out = createWriteStream(outPath, { encoding: "utf8" });
const write = async (chunk) => {
  if (!out.write(chunk)) await once(out, "drain");
};

const q = (sql, params) => conn.query(sql, params).then(([rows]) => rows);

const [{ db }] = await q("SELECT DATABASE() AS db");
await write(
  `-- Warehouse Pro — dump of \`${db}\`\n` +
  `-- taken ${new Date().toISOString()}\n` +
  `SET NAMES utf8mb4;\n` +
  `SET FOREIGN_KEY_CHECKS = 0;\n` +
  `SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n`,
);

const tables = (await q(
  `SELECT table_name AS t FROM information_schema.tables
   WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
  [db],
)).map(r => r.t);

const literal = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  // JSON columns arrive already parsed, so String() would write the useless
  // "[object Object]" and silently destroy the column's contents.
  if (typeof v === "object") return conn.escape(JSON.stringify(v));
  return conn.escape(String(v));
};

let grandTotal = 0;
for (const table of tables) {
  const [{ "Create Table": ddl }] = await q(`SHOW CREATE TABLE \`${table}\``);
  await write(`DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`);

  const columns = (await q(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [db, table],
  )).map(r => r.c);
  const colList = columns.map(c => `\`${c}\``).join(", ");

  // Stream rows so a large table never has to fit in memory at once.
  const stream = conn.connection.query(`SELECT * FROM \`${table}\``).stream();
  let batch = [];
  let batchBytes = 0;
  let rowCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${batch.join(",\n")};\n`);
    batch = [];
    batchBytes = 0;
  };

  for await (const row of stream) {
    const tuple = `(${columns.map(c => literal(row[c])).join(", ")})`;
    batch.push(tuple);
    batchBytes += tuple.length + 2;
    rowCount++;
    // Keep each statement comfortably under a 1 MB max_allowed_packet — the
    // lowest limit likely to be met on restore — so the dump loads without
    // server tuning. A single row can already be a few hundred KB here, so
    // the cap leaves room for one oversized row on top of it.
    if (batchBytes >= 300_000 || batch.length >= 500) await flush();
  }
  await flush();
  await write("\n");

  grandTotal += rowCount;
  console.log(`${table.padEnd(32)} ${String(rowCount).padStart(7)} rows`);
}

await write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
out.end();
await once(out, "finish");
await conn.end();

console.log(`\n${tables.length} tables, ${grandTotal} rows -> ${outPath}`);

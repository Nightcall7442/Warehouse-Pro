#!/usr/bin/env node
/**
 * Marks the migrations in db/migrations as already applied, without running
 * them.
 *
 * The production database was built with `drizzle-kit push` and kept in step
 * by hand, so its `__drizzle_migrations` ledger is empty even though the
 * schema is current. Pointing `drizzle-kit migrate` at it in that state would
 * replay every migration from the first one and fail on the first CREATE
 * TABLE — and since migrate runs before the server starts, that failure would
 * take the site down rather than just log an error.
 *
 * Recording the hashes up front makes migrate a no-op today and a normal
 * incremental step from the next migration onwards. The hash and timestamp
 * are computed exactly as drizzle's own migrator does: SHA-256 of the raw
 * file, paired with the `when` value from the journal.
 *
 * Usage:
 *   DATABASE_URL="mysql://…" node scripts/baseline-migrations.mjs [--apply]
 *
 * Without --apply it only reports what it would record.
 */
import mysql from "mysql2/promise";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const apply = process.argv.includes("--apply");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));

const migrations = journal.entries.map(entry => {
  const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
  return {
    tag: entry.tag,
    hash: createHash("sha256").update(sql).digest("hex"),
    when: entry.when,
  };
});

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// drizzle keeps its ledger in the schema it migrates.
await conn.query(`
  CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

const [existing] = await conn.query("SELECT hash FROM `__drizzle_migrations`");
const known = new Set(existing.map(r => r.hash));

const missing = migrations.filter(m => !known.has(m.hash));

console.log(`journal entries : ${migrations.length}`);
console.log(`already recorded: ${known.size}`);
console.log(`to record       : ${missing.length}\n`);

for (const m of missing) console.log(`  ${apply ? "recording" : "would record"}  ${m.tag}`);

if (missing.length > 0 && apply) {
  await conn.query(
    "INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ?",
    [missing.map(m => [m.hash, m.when])],
  );
  console.log(`\nRecorded ${missing.length} migration(s).`);
} else if (!apply) {
  console.log("\nDry run — pass --apply to write.");
}

await conn.end();

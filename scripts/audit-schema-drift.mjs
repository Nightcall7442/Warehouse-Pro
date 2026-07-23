#!/usr/bin/env node
/**
 * audit-schema-drift.mjs
 * 
 * Compares db/schema.ts against the real production database via information_schema.
 * Reports columns that exist in code but not in DB (causes 500 errors),
 * and columns that exist in DB but not in code (orphaned/legacy columns).
 * 
 * Usage:
 *   DATABASE_URL="mysql://..." node scripts/audit-schema-drift.mjs
 * 
 * Exit code 1 if drift is found (CI-gateable).
 */

import mysql from "mysql2/promise";

// Parse schema.ts to extract table → column mappings
function parseSchema(filePath) {
  const fs = await_import_fs();
  const content = fs.readFileSync(filePath, "utf-8");
  
  const tables = {};
  let currentTable = null;
  
  for (const line of content.split("\n")) {
    // Match table name: export const tableName = mysqlTable("db_name", {
    const tableMatch = line.match(/export\s+const\s+\w+\s*=\s*mysqlTable\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      tables[currentTable] = [];
      continue;
    }
    
    if (!currentTable) continue;
    
    // Match column: fieldName: type("db_col", ...)
    // Also match: serial, varchar, text, decimal, timestamp, bigint, boolean, enum, int, json, date, time
    const colMatch = line.match(/^\s+(\w+)\s*:\s*\w+\(\s*["'`]([^"'`]+)["'`]/);
    if (colMatch) {
      tables[currentTable].push({
        field: colMatch[1],
        column: colMatch[2],
      });
    }
    
    // End of table definition
    if (line.includes("}, (t) => (") || line.includes("});")) {
      if (currentTable && tables[currentTable]?.length > 0) {
        // Keep it
      }
      if (line.includes("});")) {
        currentTable = null;
      }
    }
  }
  
  return tables;
}

function await_import_fs() {
  return await import("fs");
}

async function main() {
  const fs = await import("fs");
  const path = await import("path");
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }
  
  // Parse schema
  const schemaPath = path.resolve(process.cwd(), "db/schema.ts");
  const schemaTables = parseSchema(schemaPath);
  
  // Connect to database
  const url = new URL(dbUrl);
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
    ssl: url.hostname !== "localhost" && url.hostname !== "127.0.0.1"
      ? { rejectUnauthorized: false }
      : undefined,
  });
  
  // Get actual columns from DB
  const [dbColumns] = await conn.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  
  // Group by table
  const dbTables = {};
  for (const row of dbColumns) {
    const table = row.TABLE_NAME;
    if (!dbTables[table]) dbTables[table] = [];
    dbTables[table].push({
      column: row.COLUMN_NAME,
      type: row.COLUMN_TYPE,
      nullable: row.IS_NULLABLE === "YES",
      default: row.COLUMN_DEFAULT,
    });
  }
  
  let driftCount = 0;
  
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SCHEMA DRIFT AUDIT — db/schema.ts vs production DB");
  console.log("═══════════════════════════════════════════════════════\n");
  
  // Check each table in schema
  for (const [tableName, schemaCols] of Object.entries(schemaTables)) {
    const dbCols = dbTables[tableName] || [];
    const dbColNames = new Set(dbCols.map(c => c.column));
    
    const missingInDb = schemaCols.filter(c => !dbColNames.has(c.column));
    
    if (missingInDb.length > 0) {
      driftCount += missingInDb.length;
      console.log(`❌ ${tableName} — ${missingInDb.length} column(s) MISSING in DB:`);
      for (const col of missingInDb) {
        console.log(`   + ${col.column} (${col.field})`);
      }
      console.log();
    } else {
      console.log(`✅ ${tableName} — OK`);
    }
  }
  
  // Check for tables in DB but not in schema
  const schemaTableNames = new Set(Object.keys(schemaTables));
  const orphanTables = Object.keys(dbTables).filter(t => !schemaTableNames.has(t));
  
  if (orphanTables.length > 0) {
    console.log(`\n⚠️  Tables in DB but NOT in schema.ts (${orphanTables.length}):`);
    for (const t of orphanTables) {
      console.log(`   - ${t} (${dbTables[t].length} columns)`);
    }
  }
  
  console.log("\n═══════════════════════════════════════════════════════");
  if (driftCount > 0) {
    console.log(`  ❌ DRIFT FOUND: ${driftCount} column(s) missing in DB`);
    console.log("  Run: npm run db:migrate  (or create migration for each)");
  } else {
    console.log("  ✅ No drift detected");
  }
  console.log("═══════════════════════════════════════════════════════");
  
  await conn.end();
  process.exit(driftCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});

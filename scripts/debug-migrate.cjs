// Diagnostic-only: calls drizzle-orm's migrate() directly so the real error
// (message, stack, cause) is printed instead of being swallowed by
// drizzle-kit CLI's spinner. Not used by the app or by any deploy step.
const mysql2 = require("mysql2/promise");
const { drizzle } = require("drizzle-orm/mysql2");
const { migrate } = require("drizzle-orm/mysql2/migrator");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const connection = await mysql2.createConnection(url);
  const db = drizzle(connection);
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
    console.log("MIGRATE_SUCCESS");
  } catch (err) {
    console.error("MIGRATE_ERROR message:", err && err.message);
    console.error("MIGRATE_ERROR stack:", err && err.stack);
    if (err && err.cause) {
      console.error("MIGRATE_ERROR cause:", err.cause);
    }
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
})();

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

type DrizzleInstance = ReturnType<typeof drizzle<typeof fullSchema>>;

let instance: DrizzleInstance | null = null;

/**
 * Parse DATABASE_URL and determine if SSL is needed.
 * Railway and most cloud MySQL providers require SSL.
 * Local (localhost / 127.0.0.1) doesn't need it.
 */
function isRemoteHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return (
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      !host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

/**
 * Get the singleton Drizzle ORM instance with MySQL connection pool.
 * Connection pooling is configured for production use with:
 * - 20 concurrent connections (connectionLimit)
 * - Keep-alive enabled for long-lived connections
 * - 30s connect timeout
 * - SSL for remote hosts
 *
 * @returns Drizzle ORM instance for database operations
 */
export function getDb(): DrizzleInstance {
  if (!instance) {
    const remote = isRemoteHost(env.databaseUrl);

    const pool = mysql.createPool({
      uri: env.databaseUrl,
      waitForConnections: true,
      connectionLimit: env.dbConnectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 30_000,
      // SSL required for Railway and other cloud MySQL providers
      ...(remote ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    // NOTE: drizzle-orm's generic inference doesn't fully resolve when `schema`
    // and `relations` are merged into one object (known upstream limitation).
    // The runtime shape is correct; only the inferred type needs a nudge here.
    instance = drizzle(pool, {
      schema: fullSchema,
      mode: "default",
      logger: !env.isProduction,
    }) as unknown as DrizzleInstance;
  }
  return instance;
}

/**
 * Reset the singleton — useful in tests or if you need to reconnect.
 */
export function resetDb(): void {
  instance = null;
}

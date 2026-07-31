import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

export type DrizzleInstance = ReturnType<typeof drizzle<typeof fullSchema>>;

/** A transaction handle stands in for the db handle as far as callees are concerned. */
export type DbHandle = DrizzleInstance | Parameters<Parameters<DrizzleInstance["transaction"]>[0]>[0];

let pool: mysql.Pool | null = null;
let instance: DrizzleInstance | null = null;

/**
 * FIX: P0.3 — the database handle bound to the current async context.
 *
 * `getDb()` used to return one process-wide singleton, so a service called from
 * inside `db.transaction(...)` that resolved its own handle issued statements on a
 * *different* pooled connection — outside the transaction, where a rollback could
 * not undo them. Binding the active handle to the async context makes those callees
 * join the transaction they are logically part of, and lets tests and background
 * jobs supply a handle without patching the module.
 */
const dbStore = new AsyncLocalStorage<DbHandle>();

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
 * The process-wide pool-backed Drizzle instance.
 *
 * Connection pooling is configured for production use with:
 * - DB_CONNECTION_LIMIT concurrent connections (default 20)
 * - Keep-alive enabled for long-lived connections
 * - 30s connect timeout
 * - SSL for remote hosts
 *
 * Statements check a connection out of the pool per query and hand it straight
 * back, so nothing holds a connection for the lifetime of a request. That is
 * deliberate: SSE subscriptions and WebSocket sessions stay open for minutes, and
 * pinning one connection per request would exhaust the pool as soon as more
 * clients than DB_CONNECTION_LIMIT were connected.
 */
function getPooledDb(): DrizzleInstance {
  if (!instance) {
    const remote = isRemoteHost(env.databaseUrl);

    pool = mysql.createPool({
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

    // A connection dropped by the server surfaces here instead of as an unhandled
    // 'error' event, which would take the process down.
    // The promise wrapper only re-emits a subset of events, so listen on the core
    // pool where 'error' is raised.
    pool.pool.on("error", (err: unknown) => {
      logger.error("mysql pool error", { error: err instanceof Error ? err.message : String(err) });
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
 * Get the database handle for the current async context.
 *
 * Inside `runWithDb`/`withTransaction` — and inside any HTTP request, which the
 * server wraps — this is the scoped handle; otherwise it is the pooled instance.
 * New code should prefer the explicit `ctx.db` / `db` argument; this exists so deep
 * callees don't have to thread a handle through every signature.
 */
export function getDb(): DrizzleInstance {
  return (dbStore.getStore() as DrizzleInstance | undefined) ?? getPooledDb();
}

/** Run `fn` with `handle` as the ambient database handle for everything it awaits. */
export function runWithDb<T>(handle: DbHandle, fn: () => T): T {
  return dbStore.run(handle, fn);
}

/**
 * Open a transaction and make it the ambient handle for the duration of `fn`.
 *
 * Use this instead of `db.transaction(...)` when the callback calls into services
 * that resolve their own handle: those calls then run inside the transaction rather
 * than committing separately on another connection.
 */
export async function withTransaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => runWithDb(tx, () => fn(tx)));
}

/** True when the handle in scope is a transaction rather than the pooled instance. */
export function inTransaction(): boolean {
  const store = dbStore.getStore();
  return store !== undefined && store !== instance;
}

/** Single round-trip liveness probe, for the startup gate and the health endpoint. */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await getPooledDb().execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    logger.warn("database health check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/**
 * Wait for the database to answer, retrying with exponential backoff
 * (1s, 2s, 4s, 8s). Returns true once connected.
 *
 * On exhausting the backoff it returns false and lets the caller decide; `boot.ts`
 * treats that as fatal, because a server that cannot reach its database serves
 * nothing but 500s.
 */
export async function waitForDatabase(delays: readonly number[] = RECONNECT_DELAYS_MS): Promise<boolean> {
  if (await checkDatabaseHealth()) return true;

  for (const [attempt, delay] of delays.entries()) {
    logger.warn("database unreachable, retrying", { attempt: attempt + 1, delayMs: delay });
    await new Promise(resolve => setTimeout(resolve, delay));
    // Once a pool's connections are gone it will not dial again on its own, so
    // rebuild it rather than re-probing a dead handle.
    await closeDb();
    if (await checkDatabaseHealth()) {
      logger.info("database reconnected", { attempt: attempt + 1 });
      return true;
    }
  }

  logger.error("database unreachable after all retries", { attempts: delays.length + 1 });
  return false;
}

/** Close the pool and drop the cached instance. Safe to call more than once. */
export async function closeDb(): Promise<void> {
  const closing = pool;
  pool = null;
  instance = null;
  if (!closing) return;
  try {
    await closing.end();
  } catch (err) {
    logger.warn("error closing mysql pool", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Drop the cached instance without closing the pool — tests only.
 * Prefer `runWithDb(handle, fn)` to inject a handle into code under test.
 */
export function resetDb(): void {
  instance = null;
  pool = null;
}

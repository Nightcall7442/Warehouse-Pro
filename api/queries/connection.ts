import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

type DrizzleInstance = ReturnType<typeof drizzle<typeof fullSchema>>;

let instance: DrizzleInstance | null = null;
/** Сам пул — чтобы можно было спросить, насколько он занят. */
let poolRef: mysql.Pool | null = null;

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
      /*
        Очередь за соединением — с потолком. При нуле она была бесконечной:
        застрявшая база копила тысячи ожидающих запросов, и когда она
        оживала, они обрушивались на неё разом. Пятьсот — это 25 очередей на
        каждое из 20 соединений; дальше запрос падает сразу, и это видно в
        метриках, а не через минуту в виде общего тайм-аута.
      */
      queueLimit: env.dbQueueLimit,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 30_000,
      // Close idle connections after 30s to avoid stale connections after MySQL restart
      maxIdle: 10,
      idleTimeout: 30_000,
      // SSL required for Railway and other cloud MySQL providers
      ...(remote ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    // Обрыв соединения приходит событием "error" на пуле. mysql2 его в типах
    // не описывает — декларация знает только "enqueue", — хотя в рантайме
    // событие есть и ловит именно те падения, ради которых стоит логирование.
    // Приведение к EventEmitter говорит об этом прямо, вместо того чтобы гасить
    // ошибку типов приведением самого обработчика.
    (pool as unknown as import("node:events").EventEmitter).on("error", (err: { message?: string }) => {
      console.error("[DB Pool Error]", err?.message ?? String(err));
    });

    /*
      Тайм-аут SQL — на стороне сервера, на каждое новое соединение пула.
      mysql2 своего тайм-аута запроса не имеет; max_execution_time (мс)
      прерывает только чтение (SELECT) — запись он не трогает, и это верно:
      оборванный UPDATE посреди транзакции хуже долгого. Тридцать секунд:
      отчёт за год укладывается, забытый JOIN без индекса — нет.
    */
    (pool as unknown as import("node:events").EventEmitter).on("connection", (conn: { query: (sql: string, cb: (err: unknown) => void) => void }) => {
      conn.query(`SET SESSION max_execution_time = ${env.dbStatementTimeoutMs}`, (err: unknown) => {
        if (err) console.error("[DB] max_execution_time not set", (err as { message?: string })?.message ?? String(err));
      });
    });

    // NOTE: drizzle-orm's generic inference doesn't fully resolve when `schema`
    // and `relations` are merged into one object (known upstream limitation).
    // The runtime shape is correct; only the inferred type needs a nudge here.
    poolRef = pool;

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
  poolRef = null;
}

export interface PoolStats {
  /** Сколько соединений открыто. */
  open: number;
  /** Сколько из них свободны прямо сейчас. */
  free: number;
  /** Сколько занято. */
  busy: number;
  /** Потолок из DB_CONNECTION_LIMIT. */
  limit: number;
  /** Сколько запросов стоит в очереди за соединением. */
  waiting: number;
}

/**
 * Насколько занят НАШ пул соединений.
 *
 * Страница мониторинга показывала «Threads_connected» из SHOW STATUS — это
 * потоки всей базы, включая чужие подключения и служебные. По ним нельзя
 * сказать главного: не упёрлись ли МЫ в свой потолок. А упереться — значит
 * встать в очередь: запросы начинают ждать соединения, и время ответа растёт
 * при полностью здоровой базе.
 *
 * Числа берутся из внутренностей mysql2: своего открытого способа спросить об
 * этом у пула нет. Поэтому каждое поле читается защищённо и по отдельности —
 * смена версии драйвера должна означать «не знаем», а не падение страницы
 * мониторинга. Ноль соединений при непустом счётчике запросов и означал бы
 * «не знаем»: пул создаётся лениво, до первого запроса он пуст по-настоящему.
 */
/**
 * Сам пул — для замка расписания.
 *
 * GET_LOCK привязан к соединению, поэтому взять и отпустить его надо на одном
 * и том же: через drizzle это не выразить, нужен пул. Возвращается тот же
 * объект, что раздаёт getDb, — второго пула в приложении быть не должно.
 */
export function getPool(): mysql.Pool | null {
  if (!poolRef) getDb();
  return poolRef;
}

export function poolStats(): PoolStats | null {
  if (!poolRef) return null;
  const raw = (poolRef as unknown as { pool?: Record<string, { length?: number } | undefined> }).pool;
  if (!raw) return null;

  const size = (key: string) => {
    const v = raw[key];
    return typeof v?.length === "number" ? v.length : null;
  };
  const open = size("_allConnections");
  const free = size("_freeConnections");
  const waiting = size("_connectionQueue");
  if (open === null || free === null) return null;

  return {
    open,
    free,
    busy: Math.max(0, open - free),
    limit: env.dbConnectionLimit,
    waiting: waiting ?? 0,
  };
}

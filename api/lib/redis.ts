import Redis, { type RedisOptions } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let client: Redis | null = null;
let subscriber: Redis | null = null;
let isAvailable = false;

/* ═══════════════════════════════════════════════════════════════════════════
   Redis не имеет права останавливать запросы.

   ── Что было (20.10.2026) ───────────────────────────────────────────────────

   Каждый запрос с входом ждал Redis ДО первого обращения к базе: отзыв
   сессии (auth/revocation.ts), общий предел запросов (middleware.ts), чтение
   кэша. Команды шли по ОДНОМУ соединению, без единого тайм-аута, а Redis
   стоял в другом регионе (sfo), чем приложение и MySQL (europe-west4).

   Когда канал через океан терял пакеты, ответы Redis вставали в очередь за
   потерянным, и с ними — все запросы процесса. Утром 20.10 программа
   замирала целиком на 20 секунд, на минуту, на пять: ни один экран не
   открывался, в MySQL за эти минуты не уходило ни байта, нагрузка — ноль.
   Потом канал оживал, и всё накопленное отвечало разом, с кодом 200 —
   поэтому ни ошибок, ни следов в журнале. Арендаторы видели «зависает».

   ── Как теперь ──────────────────────────────────────────────────────────────

   - На команду — тайм-аут (REDIS_COMMAND_TIMEOUT_MS, секунда). Вызывающие и
     так ловят ошибку и берут память процесса; теперь они её получают, а не
     ждут вечно.
   - Соединение, которое молчит при неотвеченных командах (socketTimeout),
     рвётся и открывается заново, а не висит за потерянным пакетом;
     неотвеченное на новом не повторяется (autoResendUnfulfilledCommands).
   - Команда упала по тайм-ауту — Redis полминуты не спрашиваем вовсе
     (isRedisAvailable ложен): иначе каждый запрос в плохую минуту платил бы
     по секунде.
   - «Доступен» — только после готовности (ready), а не после TCP-соединения.

   Проверка — api/__tests__/redis-silence-does-not-freeze.test.ts: настоящий
   ioredis против сервера, который замолкает.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Соединение молчит при неотвеченных командах столько — рвём и открываем заново. */
const SOCKET_TIMEOUT_MS = 5_000;
/** После тайм-аута команды Redis не спрашиваем столько. */
const BREAKER_MS = 30_000;
/** Сообщение ioredis о тайм-ауте команды (built/Command.js). */
const COMMAND_TIMED_OUT = "Command timed out";

let breakerUntil = 0;

function tripBreaker(): void {
  const now = Date.now();
  if (now < breakerUntil) return;
  breakerUntil = now + BREAKER_MS;
  logger.warn("Redis is not answering in time — using in-process memory for 30 s", {
    commandTimeoutMs: env.redisCommandTimeoutMs,
  });
}

function options(maxRetriesPerRequest: number): RedisOptions {
  return {
    lazyConnect: true,
    connectTimeout: 5_000,
    commandTimeout: env.redisCommandTimeoutMs,
    socketTimeout: SOCKET_TIMEOUT_MS,
    // Без этого keepAlive 0 — системные два часа: мёртвое соединение
    // не замечается вовсе.
    keepAlive: 10_000,
    autoResendUnfulfilledCommands: false,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    maxRetriesPerRequest,
    enableOfflineQueue: false,
  };
}

/**
 * Любая команда, упавшая по тайм-ауту, включает обход Redis.
 *
 * Через sendCommand проходят и одиночные команды, и MULTI/конвейеры
 * (Pipeline.exec зовёт redis.sendCommand на каждую), поэтому одной обёртки
 * хватает на все места, а вызывающим ничего знать не нужно.
 */
function watchTimeouts(r: Redis): void {
  const send = r.sendCommand.bind(r) as (...args: unknown[]) => unknown;
  (r as unknown as { sendCommand: (...args: unknown[]) => unknown }).sendCommand = (...args: unknown[]) => {
    const p = send(...args);
    if (p && typeof (p as Promise<unknown>).catch === "function") {
      (p as Promise<unknown>).catch((e: unknown) => {
        if (e instanceof Error && e.message === COMMAND_TIMED_OUT) tripBreaker();
      });
    }
    return p;
  };
}

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, options(1));
    watchTimeouts(client);

    client.on("ready", () => {
      logger.info("Redis connected");
      isAvailable = true;
    });

    client.on("error", (err) => {
      logger.error("Redis connection error", { error: err.message });
      isAvailable = false;
    });

    client.on("close", () => {
      isAvailable = false;
    });

    client.on("reconnecting", () => {
      isAvailable = false;
    });
  }
  return client;
}

export function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(env.redisUrl, options(1));

    subscriber.on("error", (err) => {
      logger.error("Redis subscriber error", { error: err.message });
    });
  }
  return subscriber;
}

export async function connectRedis(): Promise<void> {
  if (env.redisUrl) {
    try {
      await getRedis().connect();
      await getSubscriber().connect();
      isAvailable = true;
      logger.info("Redis ready");
    } catch (err) {
      logger.warn("Redis unavailable, using in-memory fallback", { error: String(err) });
      isAvailable = false;
    }
  } else {
    logger.info("No REDIS_URL configured, using in-memory fallback");
    isAvailable = false;
  }
}

/** Redis готов и не в обходе после тайм-аута. Ложь — берите память процесса. */
export function isRedisAvailable(): boolean {
  return isAvailable && Date.now() >= breakerUntil;
}

/*
  Подписка на канал — одна на процесс, обработчиков сколько угодно.

  ── Что было ────────────────────────────────────────────────────────────────

  Шина SSE подписывалась на Redis в конструкторе — в момент import, когда
  connectRedis() ещё не вызван и isRedisAvailable() ложен. Подписка не
  ставилась никогда; события другой реплики сюда не доходили, а в журнале
  это выглядело как «Redis ready». Здесь подписка ленивая: кто угодно зовёт
  subscribeChannel на каждом событии, и она встаёт при первом же вызове,
  когда Redis уже поднят. Повторные вызовы — проверка двух множеств.

  Отдельное соединение-подписчик обязательно: соединение в режиме SUBSCRIBE
  других команд не принимает.
*/
const channelHandlers = new Map<string, Set<(message: string) => void>>();
const subscribedChannels = new Set<string>();
let dispatcherBound = false;

/** Подписаться на канал; true — подписка есть (или ставится), false — Redis нет. */
export function subscribeChannel(channel: string, handler: (message: string) => void): boolean {
  if (!isRedisAvailable()) return false;
  let set = channelHandlers.get(channel);
  if (!set) { set = new Set(); channelHandlers.set(channel, set); }
  set.add(handler);
  if (subscribedChannels.has(channel)) return true;
  subscribedChannels.add(channel);
  const sub = getSubscriber();
  if (!dispatcherBound) {
    dispatcherBound = true;
    sub.on("message", (ch: string, message: string) => {
      for (const h of channelHandlers.get(ch) ?? []) {
        try { h(message); } catch { /* обработчик сам за себя */ }
      }
    });
  }
  sub.subscribe(channel).catch((err: unknown) => {
    subscribedChannels.delete(channel);
    logger.warn("Redis subscribe failed", { channel, error: err instanceof Error ? err.message : String(err) });
  });
  return true;
}

/** Опубликовать; молча, если Redis нет — реплика одна, слушать некому. */
export function publishChannel(channel: string, message: string): void {
  if (!isRedisAvailable()) return;
  try { getRedis().publish(channel, message).catch(() => {}); } catch { /* Redis unavailable */ }
}

/** Метка процесса: свои же сообщения из Redis не обрабатывать второй раз. */
export const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

/** Для тестов: забыть подписки (соединения не трогает). */
export function _resetSubscriptions(): void {
  channelHandlers.clear();
  subscribedChannels.clear();
  dispatcherBound = false;
}

export async function disconnectRedis(): Promise<void> {
  isAvailable = false;
  breakerUntil = 0;
  if (subscriber) {
    await subscriber.quit().catch(() => {});
    subscriber = null;
  }
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
  logger.info("Redis disconnected");
}

export { Redis };

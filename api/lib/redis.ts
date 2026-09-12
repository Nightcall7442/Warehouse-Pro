import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let client: Redis | null = null;
let subscriber: Redis | null = null;
let isAvailable = false;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, {
      lazyConnect: true,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

    client.on("connect", () => {
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
  }
  return client;
}

export function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(env.redisUrl, {
      lazyConnect: true,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

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

export function isRedisAvailable(): boolean {
  return isAvailable;
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
  if (!isAvailable) return false;
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
  if (!isAvailable) return;
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

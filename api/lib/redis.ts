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

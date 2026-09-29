/**
 * Кэш списков с остатком и долгом следует за номером данных арендатора.
 *
 * Что было: каталог, список магазинов и справочник агента лежали в withCache
 * по три минуты, а сервисы записи (заказ, приход, возврат, оплата) сбрасывали
 * только кэш отчётов — invalidateReports. До этих списков сброс не доходил:
 * «в наличии 10» у распроданного товара, долг у магазина после оплаты.
 *
 * Что проверяется (настоящие lib/cache и lib/report-cache, Redis — подделка):
 *   · без сброса ответ берётся из кэша — пересчёта нет;
 *   · после invalidateReports своей организации — пересчёт; чужая не задета;
 *   · вторая реплика: сосед поднял номер (INCR + канал report:invalidate) —
 *     здесь пересчёт, без единого KEYS;
 *   · префиксный сброс карточки товара (`products:{t}`) по-прежнему работает.
 *
 * Нарочная поломка: в withTenantDataCache убери номер из ключа — падают
 * «после сброса» и «сосед поднял номер».
 */
import { describe, it, expect, vi } from "vitest";

const redis = vi.hoisted(() => {
  const kv = new Map<string, string>();
  const handlers = new Map<string, (m: string) => void>();
  const client = {
    incr: vi.fn(async (k: string) => { const v = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(v)); return v; }),
    get: vi.fn(async (k: string) => kv.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { kv.set(k, v); return "OK"; }),
    del: vi.fn(async () => 0),
    keys: vi.fn(async () => [] as string[]),
    multi: () => ({
      get: (k: string) => ({ pttl: () => ({ exec: async () => [[null, kv.get(k) ?? null], [null, kv.has(k) ? 60_000 : -2]] }) }),
    }),
  };
  return {
    kv, client, handlers, available: false,
    deliver(channel: string, m: string) { handlers.get(channel)?.(m); },
  };
});

vi.mock("../lib/redis", () => ({
  INSTANCE_ID: "test-instance",
  isRedisAvailable: () => redis.available,
  getRedis: () => redis.client,
  subscribeChannel: (c: string, h: (m: string) => void) => { redis.handlers.set(c, h); return true; },
  publishChannel: () => {},
}));

import { withTenantDataCache, cache } from "../lib/cache";
import { invalidateReports } from "../lib/report-cache";

const TTL = 60_000;

describe("списки с остатком и долгом: ключ несёт номер данных организации", () => {
  it("без записи — из кэша; после сброса своей организации — пересчёт; чужая не задета", async () => {
    let stock = 10;
    const catalog = vi.fn(async () => ({ available: stock }));
    const other = vi.fn(async () => ({ available: 5 }));

    expect(await withTenantDataCache(1, "products:1:listAll", TTL, catalog)).toEqual({ available: 10 });
    expect(await withTenantDataCache(2, "products:2:listAll", TTL, other)).toEqual({ available: 5 });

    stock = 3; // заказ записан…
    expect(await withTenantDataCache(1, "products:1:listAll", TTL, catalog), "без сброса обязан отдать кэш").toEqual({ available: 10 });
    expect(catalog).toHaveBeenCalledTimes(1);

    await invalidateReports(1, "order"); // …и сервис записи сбросил организацию
    expect(await withTenantDataCache(1, "products:1:listAll", TTL, catalog), "после сброса остался старый остаток").toEqual({ available: 3 });
    expect(catalog).toHaveBeenCalledTimes(2);

    await withTenantDataCache(2, "products:2:listAll", TTL, other);
    expect(other, "сброс одной организации пересчитал чужую").toHaveBeenCalledTimes(1);
  });

  it("префиксный сброс карточки товара по-прежнему достаёт до списка", async () => {
    const produce = vi.fn(async () => "каталог");
    await withTenantDataCache(3, "products:3:listAll", TTL, produce);
    cache.invalidatePrefix("products:3");
    await withTenantDataCache(3, "products:3:listAll", TTL, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("вторая реплика: сосед поднял номер — здесь пересчёт", async () => {
    redis.available = true;
    try {
      let debt = 400;
      const shops = vi.fn(async () => ({ debt }));
      expect(await withTenantDataCache(7, "shops:7:list", TTL, shops)).toEqual({ debt: 400 });
      expect(await withTenantDataCache(7, "shops:7:list", TTL, shops)).toEqual({ debt: 400 });
      expect(shops).toHaveBeenCalledTimes(1);

      // Оплата прошла на соседней реплике: она сделала INCR и разослала номер.
      debt = 250;
      const ver = await redis.client.incr("reportver:7");
      redis.deliver("report:invalidate", JSON.stringify({ tenantId: 7, ver }));

      expect(await withTenantDataCache(7, "shops:7:list", TTL, shops), "реплика не узнала о записи соседа").toEqual({ debt: 250 });
      expect(shops).toHaveBeenCalledTimes(2);
      expect(redis.client.keys, "сброс не должен перебирать ключи Redis").not.toHaveBeenCalled();
    } finally {
      redis.available = false;
    }
  });
});

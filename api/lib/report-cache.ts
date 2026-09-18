import { getRedis, isRedisAvailable, subscribeChannel, publishChannel } from "./redis";
import { logger } from "./logger";

/*
  Кэш отчётов директора: один пересчёт на организацию, а не тридцать.

  ── Что было ────────────────────────────────────────────────────────────────

  Отчёты либо не кэшировались вовсе, либо шли через withCache из lib/cache.ts,
  который не склеивает одновременные промахи: тридцать директоров, открывших
  P&L в одну секунду, давали тридцать одинаковых пересчётов по всему
  order_items арендатора. Сброс по префиксу там — `KEYS report:{t}:*` в Redis
  на каждую запись заказа: перебор всего пространства ключей, а
  bulkUpdateStatus зовёт запись до ста раз подряд.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Ключ — `report:{tenantId}:{name}:{stableStringify(input)}`; хит в памяти
  не трогает ни базу, ни Redis. Промах считается один раз на ключ в процессе:
  остальные ждут ту же Promise (single-flight). Вторая реплика перед
  пересчётом смотрит готовый ответ в Redis.

  Сброс — не удаление ключей, а номер версии арендатора: каждое значение
  помнит версию, при которой посчитано, и живёт, пока версия та же.
  invalidateReports поднимает версию в памяти, делает INCR в Redis и шлёт
  новый номер соседям по каналу — O(1) вместо перебора ключей, поэтому
  сто вызовов подряд безвредны. Старые значения умирают по TTL сами.

  ── Почему версия, а не удаление ────────────────────────────────────────────

  Версия закрывает гонку «чтение началось до коммита, а записалось после
  сброса»: значение помечено версией, взятой ДО расчёта, и после сброса
  оно уже не совпадает — следующий читатель пересчитает. Удаление ключей
  этого не умеет: пересчёт, стартовавший до записи, положил бы старые числа
  на весь TTL.

  ── Чего здесь нет нарочно ──────────────────────────────────────────────────

  Никакого импорта из lib/cache: два десятка тестов подменяют его частично,
  и сервисы записи, зовущие invalidateReports, падали бы на «не функция».
  Своя память, свой канал `report:invalidate`, Redis — напрямую.

  ponytail: single-flight в пределах процесса; при двух репликах, промахнувшихся
  в одну миллисекунду, пересчётов будет два. Межпроцессный замок — когда
  одного процесса станет мало.
*/

export const ReportTTL = { live: 20_000, minute: 60_000, fiveMin: 5 * 60_000 } as const;

const CHANNEL = "report:invalidate";
/** ponytail: 2000 ответов на процесс, вытеснение самого старого; LRU — когда упрёмся. */
const MAX_ENTRIES = 2000;

type Entry<T> = { value: T; ver: number; expiresAt: number };
type Wire = { tenantId: number; ver: number };

/**
 * Один и тот же вход — одна и та же строка: ключи объекта по алфавиту,
 * undefined выброшен (`{agentId: undefined}` и `{}` — один ключ), даты — ISO.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export class ReportCache {
  private memory = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private versions = new Map<number, number>();
  private subscribed = false;

  async get<T>(tenantId: number, name: string, input: unknown, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    this.ensureSubscribed();
    const key = `report:${tenantId}:${name}:${stableStringify(input)}`;
    // Версия известна — ни одного await до проверки памяти: хит синхронный.
    const ver = this.versions.get(tenantId) ?? (await this.fetchVersion(tenantId));
    const hit = this.memory.get(key) as Entry<T> | undefined;
    if (hit && hit.ver === ver && hit.expiresAt > Date.now()) return hit.value;

    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = this.produce(key, tenantId, ver, ttlMs, fn).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async invalidate(tenantId: number, reason?: string): Promise<void> {
    this.ensureSubscribed();
    // Своя память — сразу и синхронно: читатель в этом же процессе не успеет взять старое.
    this.adopt(tenantId, (this.versions.get(tenantId) ?? 0) + 1);
    logger.debug("reports invalidated", { tenantId, reason });
    if (!isRedisAvailable()) return;
    try {
      const ver = await getRedis().incr(`reportver:${tenantId}`);
      this.adopt(tenantId, ver);
      publishChannel(CHANNEL, JSON.stringify({ tenantId, ver } satisfies Wire));
    } catch {
      /* Redis упал: своя память уже сброшена; соседи увидят новую версию по первому же значению, которое мы запишем */
    }
  }

  private async produce<T>(key: string, tenantId: number, ver: number, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const shared = await this.fromRedis<T>(key);
    if (shared && shared.ver >= ver) {
      // Сосед посчитал при версии не старше нашей — берём и не продлеваем срок.
      this.adopt(tenantId, shared.ver);
      this.remember(key, shared.value, shared.ver, shared.ttlMs > 0 ? Math.min(ttlMs, shared.ttlMs) : ttlMs);
      return shared.value;
    }
    const value = await fn();
    // Версия взята до расчёта: сброс во время расчёта делает ответ устаревшим сразу.
    this.remember(key, value, ver, ttlMs);
    if (isRedisAvailable()) {
      getRedis().setex(key, Math.ceil(ttlMs / 1000), JSON.stringify({ ver, value })).catch(() => {});
    }
    return value;
  }

  private remember<T>(key: string, value: T, ver: number, ttlMs: number): void {
    if (this.memory.size >= MAX_ENTRIES && !this.memory.has(key)) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.set(key, { value, ver, expiresAt: Date.now() + ttlMs });
  }

  private async fromRedis<T>(key: string): Promise<{ value: T; ver: number; ttlMs: number } | undefined> {
    if (!isRedisAvailable()) return undefined;
    try {
      const [[, raw], [, pttl]] = (await getRedis().multi().get(key).pttl(key).exec()) ?? [];
      if (raw == null) return undefined;
      const parsed = JSON.parse(String(raw)) as { ver: number; value: T };
      return { value: parsed.value, ver: Number(parsed.ver) || 0, ttlMs: Number(pttl) };
    } catch {
      return undefined;
    }
  }

  /** Первое касание арендатора в процессе: версию помнит Redis, не мы. Без Redis — ноль, и не запоминаем: он может подняться позже с другим числом. */
  private async fetchVersion(tenantId: number): Promise<number> {
    if (!isRedisAvailable()) return 0;
    let fetched = 0;
    try { fetched = Number(await getRedis().get(`reportver:${tenantId}`)) || 0; } catch { /* как без Redis */ }
    this.versions.set(tenantId, Math.max(this.versions.get(tenantId) ?? 0, fetched));
    return this.versions.get(tenantId)!;
  }

  /** Версия только растёт: свои и чужие сообщения применяются одинаково, повтор безвреден. */
  private adopt(tenantId: number, ver: number): void {
    if (ver > (this.versions.get(tenantId) ?? 0)) this.versions.set(tenantId, ver);
  }

  /** Подписка ленивая — Redis поднимается после import (см. lib/redis.ts). */
  private ensureSubscribed(): void {
    if (this.subscribed || !isRedisAvailable()) return;
    this.subscribed = subscribeChannel(CHANNEL, (message) => {
      let m: Wire;
      try { m = JSON.parse(message); } catch { return; }
      this.adopt(m.tenantId, m.ver);
    });
  }
}

export const reportCache = new ReportCache();

/** Ключ: report:{tenantId}:{name}:{stableStringify(input)}; хит — без базы. */
export function reportCached<T>(tenantId: number, name: string, input: unknown, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  return reportCache.get(tenantId, name, input, ttlMs, fn);
}

/** Сбросить report:{tenantId}:* на всех экземплярах. Звать ПОСЛЕ коммита, один раз на событие, из сервиса записи. */
export function invalidateReports(tenantId: number, reason?: string): Promise<void> {
  return reportCache.invalidate(tenantId, reason);
}

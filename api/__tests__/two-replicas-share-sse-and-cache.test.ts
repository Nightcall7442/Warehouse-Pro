/**
 * Две реплики: события SSE и сброс кэша доходят через Redis.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Шина SSE подписывалась на Redis в конструкторе — до connectRedis(), когда
 * isRedisAvailable() ещё ложен. Подписка не ставилась никогда: включи вторую
 * реплику — и её слушатели не видели событий первой. А если бы подписка
 * встала, отправитель получал бы своё событие обратно и раздавал его второй
 * раз. Кэш писал в Redis, но читал только память: сброс на реплике A не
 * трогал память реплики B до конца TTL.
 *
 * Здесь Redis подделан одним pub/sub на двоих: подписка ленивая, свои
 * сообщения отбрасываются по метке процесса, сброс ключа долетает до соседа,
 * withCache при промахе читает Redis и не продлевает срок значения.
 *
 * Нарочная поломка: убери проверку `event.origin === this.origin` в
 * lib/sse.ts — первый тест насчитает два события вместо одного.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── подделка Redis: один pub/sub и одно хранилище на все «процессы» ─────────
const handlers = new Map<string, Set<(m: string) => void>>();
const store = new Map<string, { value: string; expiresAt: number }>();
let available = true;

vi.mock("../lib/redis", () => ({
  isRedisAvailable: () => available,
  INSTANCE_ID: "test-process",
  subscribeChannel: (channel: string, handler: (m: string) => void) => {
    if (!available) return false;
    let set = handlers.get(channel);
    if (!set) { set = new Set(); handlers.set(channel, set); }
    set.add(handler);
    return true;
  },
  publishChannel: (channel: string, message: string) => {
    if (!available) return;
    for (const h of handlers.get(channel) ?? []) h(message);
  },
  getRedis: () => ({
    setex: async (key: string, ttlSec: number, value: string) => { store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 }); },
    del: async (...keys: string[]) => { for (const k of keys) store.delete(k); },
    keys: async (pattern: string) => [...store.keys()].filter(k => k.startsWith(pattern.replace(/\*$/, ""))),
    multi: () => {
      const ops: Array<() => unknown> = [];
      const m = {
        get: (k: string) => { ops.push(() => store.get(k)?.value ?? null); return m; },
        pttl: (k: string) => { ops.push(() => { const e = store.get(k); return e ? e.expiresAt - Date.now() : -2; }); return m; },
        exec: async () => ops.map(op => [null, op()]),
      };
      return m;
    },
  }),
}));

import { SSEBus } from "../lib/sse";
import { UnifiedCache, withCache } from "../lib/cache";

function listenerOf(received: string[]) {
  return { enqueue: (chunk: Uint8Array) => { received.push(new TextDecoder().decode(chunk)); } } as unknown as ReadableStreamDefaultController;
}

beforeEach(() => { handlers.clear(); store.clear(); available = true; });

describe("SSE между репликами", () => {
  it("событие с реплики A доходит слушателю на B ровно один раз, и A себе его не дублирует", () => {
    const a = new SSEBus("replica-a");
    const b = new SSEBus("replica-b");
    const gotA: string[] = [];
    const gotB: string[] = [];
    a.subscribe(1, 10, listenerOf(gotA));
    b.subscribe(1, 10, listenerOf(gotB));

    a.emit({ type: "order.created", tenantId: 1, data: { id: 5 } });

    expect(gotA.filter(x => x.includes("order.created"))).toHaveLength(1);
    expect(gotB.filter(x => x.includes("order.created"))).toHaveLength(1);
    // и B помнит его для догона после обрыва
    expect(b.getRecentEvents(1, 10).map(e => e.type)).toEqual(["order.created"]);
  });

  it("адресное событие с A не уходит чужому пользователю на B; чужая организация молчит", () => {
    const a = new SSEBus("replica-a");
    const b = new SSEBus("replica-b");
    const mine: string[] = [];
    const theirs: string[] = [];
    const otherTenant: string[] = [];
    b.subscribe(1, 10, listenerOf(mine));
    b.subscribe(1, 11, listenerOf(theirs));
    b.subscribe(2, 10, listenerOf(otherTenant));

    a.emit({ type: "notification.new", tenantId: 1, userId: 10, data: {} });

    expect(mine.some(x => x.includes("notification.new"))).toBe(true);
    expect(theirs.some(x => x.includes("notification.new"))).toBe(false);
    expect(otherTenant.some(x => x.includes("notification.new"))).toBe(false);
  });

  it("без Redis шина работает как одна реплика", () => {
    available = false;
    const a = new SSEBus("replica-a");
    const got: string[] = [];
    a.subscribe(1, 10, listenerOf(got));
    a.emit({ type: "stock.low", tenantId: 1, data: {} });
    expect(got.filter(x => x.includes("stock.low"))).toHaveLength(1);
    expect(handlers.size).toBe(0);
  });
});

describe("кэш между репликами", () => {
  it("сброс ключа на A выкидывает его из памяти B", () => {
    const a = new UnifiedCache("replica-a");
    const b = new UnifiedCache("replica-b");
    a.set("kpi:1", { n: 1 }, 60_000);
    b.set("kpi:1", { n: 1 }, 60_000);
    expect(b.get("kpi:1")).toEqual({ n: 1 });

    a.invalidate("kpi:1");
    expect(b.get("kpi:1")).toBeUndefined();
    expect(a.get("kpi:1")).toBeUndefined();
  });

  it("сброс по префиксу и полная очистка тоже долетают", () => {
    const a = new UnifiedCache("replica-a");
    const b = new UnifiedCache("replica-b");
    b.set("dash:1:kpis", 1, 60_000);
    b.set("dash:2:kpis", 2, 60_000);
    b.set("branding:1", 3, 60_000);
    a.set("x", 0, 60_000); // подписка B уже стоит после set выше
    a.invalidatePrefix("dash:1");
    expect(b.get("dash:1:kpis")).toBeUndefined();
    expect(b.get("dash:2:kpis")).toBe(2);
    a.clear();
    expect(b.get("dash:2:kpis")).toBeUndefined();
    expect(b.get("branding:1")).toBeUndefined();
  });

  it("withCache при промахе в памяти берёт из Redis и не пересчитывает; срок в памяти не длиннее остатка", async () => {
    const produce = vi.fn(async () => ({ heavy: true }));
    store.set("report:1", { value: JSON.stringify({ heavy: "from-redis" }), expiresAt: Date.now() + 5_000 });

    const v = await withCache("report:1", 60_000, produce);
    expect(v).toEqual({ heavy: "from-redis" });
    expect(produce).not.toHaveBeenCalled();
    // положено только в память, Redis не переписан (срок не продлён)
    expect(store.get("report:1")!.expiresAt - Date.now()).toBeLessThanOrEqual(5_000);
  });
});

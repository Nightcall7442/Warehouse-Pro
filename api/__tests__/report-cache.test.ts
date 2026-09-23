/**
 * Кэш отчётов директора: один пересчёт на организацию, а не тридцать.
 *
 * Отчёты либо не кэшировались вовсе, либо шли через withCache, который не
 * склеивает одновременные промахи: тридцать директоров, открывших P&L в одну
 * секунду, — тридцать одинаковых проходов по order_items. Сброс по префиксу
 * там — KEYS в Redis на каждую запись заказа.
 *
 * Здесь проверяется договор кэша, а не отчёты:
 *   • хит не идёт в базу; разные организации и разные входы не делят ключ;
 *   • одновременные промахи ждут один пересчёт;
 *   • сброс — версия организации: свою сбрасывает, чужую нет, O(1);
 *   • версия берётся ДО расчёта: запись во время расчёта делает ответ
 *     устаревшим сразу, а не на весь TTL;
 *   • соседний экземпляр узнаёт о сбросе по каналу, а значение в Redis
 *     хранится superjson-ом — даты доезжают датами;
 *   • каждый сервис записи из списка зовёт invalidateReports — страж по
 *     исходникам, чтобы новый путь записи не забыл про отчёты.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const redis = vi.hoisted(() => {
  const kv = new Map<string, string>();
  let handler: ((m: string) => void) | null = null;
  const client = {
    incr: vi.fn(async (k: string) => { const v = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(v)); return v; }),
    get: vi.fn(async (k: string) => kv.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { kv.set(k, v); return "OK"; }),
    multi: () => ({
      get: (k: string) => ({ pttl: () => ({ exec: async () => [[null, kv.get(k) ?? null], [null, kv.has(k) ? 60_000 : -2]] }) }),
    }),
  };
  return {
    kv, client, available: false,
    published: [] as string[],
    subscribe(h: (m: string) => void) { handler = h; },
    deliver(m: string) { handler?.(m); },
  };
});

vi.mock("../lib/redis", () => ({
  isRedisAvailable: () => redis.available,
  getRedis: () => redis.client,
  subscribeChannel: (_c: string, h: (m: string) => void) => { redis.subscribe(h); return true; },
  publishChannel: (_c: string, m: string) => { redis.published.push(m); },
}));

import { ReportCache, stableStringify } from "../lib/report-cache";

const tick = () => new Promise<void>(r => { setTimeout(r, 0); });

beforeEach(() => {
  redis.kv.clear();
  redis.published.length = 0;
  redis.available = false;
});

describe("ключ", () => {
  it("порядок полей и undefined не создают второй ключ", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(stableStringify({ agentId: undefined, days: 7 })).toBe(stableStringify({ days: 7 }));
    // null — не undefined: «все агенты» и «агент не задан» — разные ответы.
    expect(stableStringify({ agentId: null })).not.toBe(stableStringify({}));
  });
});

describe("память одного процесса", () => {
  it("хит не считает заново; другая организация и другой вход — считают", async () => {
    const rc = new ReportCache();
    const fn = vi.fn(async () => ({ total: 1 }));
    await rc.get(1, "pnl", { from: "2026-09-01" }, 60_000, fn);
    await rc.get(1, "pnl", { from: "2026-09-01" }, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    await rc.get(2, "pnl", { from: "2026-09-01" }, 60_000, fn);
    await rc.get(1, "pnl", { from: "2026-08-01" }, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("одновременные промахи ждут один пересчёт", async () => {
    const rc = new ReportCache();
    let release!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>(r => { release = r; }));
    const a = rc.get(1, "kpis", null, 60_000, fn);
    const b = rc.get(1, "kpis", null, 60_000, fn);
    await tick();
    release(42);
    expect(await Promise.all([a, b])).toEqual([42, 42]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("сброс — только своя организация", async () => {
    const rc = new ReportCache();
    const fn = vi.fn(async () => 1);
    await rc.get(1, "kpis", null, 60_000, fn);
    await rc.get(2, "kpis", null, 60_000, fn);
    await rc.invalidate(1, "order");
    await rc.get(1, "kpis", null, 60_000, fn);
    await rc.get(2, "kpis", null, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("запись во время расчёта: ответ устаревает сразу, а не на весь TTL", async () => {
    const rc = new ReportCache();
    let release!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>(r => { release = r; }));
    const first = rc.get(1, "kpis", null, 60_000, fn);
    await tick();
    await rc.invalidate(1, "order");   // оплата пришла, пока отчёт считался
    release(1);
    await first;
    fn.mockImplementation(async () => 2);
    expect(await rc.get(1, "kpis", null, 60_000, fn)).toBe(2);
  });

  it("TTL — потолок и без сброса", async () => {
    vi.useFakeTimers();
    try {
      const rc = new ReportCache();
      const fn = vi.fn(async () => 1);
      await rc.get(1, "kpis", null, 1_000, fn);
      vi.advanceTimersByTime(1_001);
      await rc.get(1, "kpis", null, 1_000, fn);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("два экземпляра (Redis)", () => {
  beforeEach(() => { redis.available = true; });

  it("сброс поднимает версию в Redis и сообщает соседям", async () => {
    const rc = new ReportCache();
    await rc.get(1, "kpis", null, 60_000, async () => 1);
    await rc.invalidate(1, "order");
    expect(redis.kv.get("reportver:1")).toBe("1");
    expect(redis.published.map(m => JSON.parse(m))).toEqual([{ tenantId: 1, ver: 1 }]);
  });

  it("сообщение соседа о сбросе — следующий вызов считает заново", async () => {
    const rc = new ReportCache();
    const fn = vi.fn(async () => 1);
    await rc.get(1, "kpis", null, 60_000, fn);
    redis.deliver(JSON.stringify({ tenantId: 1, ver: 7 }));
    await rc.get(1, "kpis", null, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    // Чужая организация — не трогает.
    redis.deliver(JSON.stringify({ tenantId: 2, ver: 9 }));
    await rc.get(1, "kpis", null, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("готовый ответ соседа берётся из Redis, даты — датами", async () => {
    const a = new ReportCache();
    const when = new Date("2026-09-19T05:00:00.000Z");
    await a.get(1, "activity", null, 60_000, async () => ({ at: when }));
    await tick();
    const b = new ReportCache();
    const fn = vi.fn(async () => ({ at: new Date(0) }));
    const got = await b.get(1, "activity", null, 60_000, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(got.at).toBeInstanceOf(Date);
    expect(got.at.getTime()).toBe(when.getTime());
  });

  it("ответ соседа старее нашей версии — не берётся", async () => {
    const a = new ReportCache();
    await a.get(1, "kpis", null, 60_000, async () => "old");
    await tick();
    const b = new ReportCache();
    await b.invalidate(1, "payment");
    expect(await b.get(1, "kpis", null, 60_000, async () => "fresh")).toBe("fresh");
  });
});

describe("страж: сервисы записи сбрасывают отчёты", () => {
  const API = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(API, p), "utf8");
  // Каждое событие, меняющее отчётное число, — по разведке reports-scout-writes.
  const WRITERS: Array<[string, number]> = [
    ["services/order-create.ts", 1],
    ["services/order-status.ts", 5],       // статус, отмена, удаление, восстановление, переназначение
    ["services/order-items.ts", 2],        // шапка, строки
    ["services/order-settlement.ts", 5],   // частичная оплата/доставка, массовые закрытия, доставка+оплата
    ["services/courier-delivery.ts", 3],   // довёз, завершил, не довёз
    ["services/payment.ts", 2],            // платёж, сторно
    ["returns-router.ts", 1],              // проведение возврата
    ["services/arrival.ts", 5],            // создан, строки заменены, завершён, расходы, удалён
    ["services/stock.ts", 1],              // ручная корректировка
    ["stock-count-router.ts", 1],          // инвентаризация
    ["warehouse-multi-router.ts", 1],      // перемещение
    ["supplier-router.ts", 1],             // возврат поставщику
    ["product-router.ts", 4],              // цена/себестоимость, удаление ×3
    ["import-router.ts", 1],
    ["webhooks/onec.ts", 2],               // платёж и остаток из 1С
    ["services/onec-sync.ts", 1],          // раз на прогон
    ["kpi-router.ts", 3],                  // выплата, штраф, ставка
    ["commission-router.ts", 4],           // ставки ×3, статус
  ];

  it.each(WRITERS)("%s зовёт invalidateReports %i раз(а)", (file, times) => {
    const src = read(file);
    expect(src).toContain('from "./lib/report-cache"'.replace("./", file.includes("/") ? "../" : "./"));
    expect(src.match(/invalidateReports\(/g)?.length ?? 0).toBe(times);
  });

  it("чтение, которое пишет (черновик комиссии), отчёты НЕ сбрасывает", () => {
    // Иначе каждое открытие экрана зарплаты сбрасывало бы кэш всей организации.
    expect(read("services/kpi.ts")).not.toContain("invalidateReports(");
  });

  it("пинги GPS и отметки визитов — не события сброса", () => {
    expect(read("agent-router.ts")).not.toContain("invalidateReports(");
  });
});

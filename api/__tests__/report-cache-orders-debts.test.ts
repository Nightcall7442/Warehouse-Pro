/**
 * Кэш отчётов: заказы, долги, возвраты — что входит в ключ и что из него
 * выкинуто.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Цель ветки: 30 директоров открывают отчёт — один пересчёт на организацию.
 * Числа считает база (real-db тесты), а здесь проверяется ровно то, что
 * ломается тихо: имя и состав ключа. Лишнее в ключе (page, userId) — промах
 * всегда и цель не достигнута; недостающее (день, месяц, tenant) — чужие или
 * вчерашние числа под видом свежих.
 *
 * Подделка reportCached здесь — настоящий маленький кэш по ключу
 * tenant:name:input, а не сквозной вызов: иначе «страница 2 не пересчитывает»
 * нечем проверить. Каждый страж ломается, если поведение убрать.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { asTestContext } from "./helpers/test-context";
import { dayKey, monthRange } from "../lib/period";

const rc = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const calls: Array<{ tenantId: number; name: string; input: unknown; ttl: number }> = [];
  const keyOf = (t: number, n: string, i: unknown) => `${t}:${n}:${JSON.stringify(i ?? {})}`;
  return {
    store, calls,
    reportCached: vi.fn(async (tenantId: number, name: string, input: unknown, ttl: number, fn: () => Promise<unknown>) => {
      calls.push({ tenantId, name, input, ttl });
      const k = keyOf(tenantId, name, input);
      if (store.has(k)) return store.get(k);
      const v = await fn();
      store.set(k, v);
      return v;
    }),
    invalidateReports: vi.fn(async (tenantId: number, _reason?: string) => {
      for (const k of [...store.keys()]) if (k.startsWith(`${tenantId}:`)) store.delete(k);
    }),
  };
});

vi.mock("../lib/report-cache", () => ({
  reportCached: rc.reportCached,
  invalidateReports: rc.invalidateReports,
  ReportTTL: { live: 20_000, minute: 60_000, fiveMin: 5 * 60_000 },
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/feature-gating", () => ({ hasSubscriptionAccess: vi.fn(async () => true) }));
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn(), auditActor: vi.fn(), changedFields: vi.fn() }));
vi.mock("../services/receivables", () => ({ receivablesAging: vi.fn(async () => ({ totalDebt: 1, shops: [] })) }));
vi.mock("../services/shop-scoring", () => ({ shopScores: vi.fn(async () => [{ shopId: 1, tier: "green" }]) }));
vi.mock("../services/debt-journal", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/debt-journal")>();
  return { ...real, collectDebtJournal: vi.fn() };
});

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { orderRouter } from "../order-router";
import { shopRouter } from "../shop-router";
import { returnsRouter } from "../returns-router";
import { receivablesAging } from "../services/receivables";
import { shopScores } from "../services/shop-scoring";
import { collectDebtJournal, paginateDebtJournal } from "../services/debt-journal";

/** База, у которой любая цепочка построителя разрешается в заданные строки. */
function chainDb(rows: unknown[]) {
  const c: any = {};
  for (const m of ["select", "from", "leftJoin", "innerJoin", "where", "groupBy", "orderBy", "limit"]) c[m] = vi.fn(() => c);
  c.then = (res: (v: unknown) => void) => res(rows);
  return c;
}

const ctx = (role: string, tenantId = 1, userId = 10) => asTestContext({
  req: new Request("http://localhost/"),
  resHeaders: new Headers(),
  db: mockDb,
  tenant: { id: tenantId, slug: "t", name: "T", plan: "trial", status: "active" },
  user: { id: userId, tenantId, role, status: "active", name: "U", email: "u@t" },
});

const LIVE = 20_000, MINUTE = 60_000, FIVE = 5 * 60_000;
const last = () => rc.calls[rc.calls.length - 1];

beforeEach(() => {
  vi.clearAllMocks();
  rc.store.clear();
  rc.calls.length = 0;
  mockDb = chainDb([{ total: 2, totalRevenue: "100.00", status: "new", count: 2 }]);
});

describe("order.stats", () => {
  const input = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };

  it("управленческая роль: ключ order.stats из фильтров, live; второй вызов — без базы", async () => {
    await orderRouter.createCaller(ctx("ceo")).stats(input);
    expect(last()).toEqual({ tenantId: 1, name: "order.stats", input, ttl: LIVE });
    expect(mockDb.select).toHaveBeenCalled();

    mockDb.select.mockClear();
    await orderRouter.createCaller(ctx("operator", 1, 77)).stats(input);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("другая организация — другой ключ", async () => {
    await orderRouter.createCaller(ctx("ceo", 1)).stats(input);
    const one = mockDb.select.mock.calls.length;
    await orderRouter.createCaller(ctx("ceo", 2)).stats(input);
    expect(rc.calls.map(c => c.tenantId)).toEqual([1, 2]);
    // Вторая организация считает столько же, сколько первая, — не ноль.
    expect(mockDb.select).toHaveBeenCalledTimes(one * 2);
  });

  it("агент и мерчандайзер кэш минуют: свой срез считается всегда", async () => {
    await orderRouter.createCaller(ctx("agent")).stats(input);
    const one = mockDb.select.mock.calls.length;
    await orderRouter.createCaller(ctx("merchandiser")).stats(input);
    expect(rc.reportCached).not.toHaveBeenCalled();
    expect(one).toBeGreaterThan(0);
    expect(mockDb.select).toHaveBeenCalledTimes(one * 2);
  });
});

describe("order.agentSummary", () => {
  it("ключ order.agentSummary из фильтров, live; повтор — без базы", async () => {
    const input = { dateFrom: "2026-09-01", archived: false };
    await orderRouter.createCaller(ctx("operator")).agentSummary(input);
    expect(last()).toEqual({ tenantId: 1, name: "order.agentSummary", input, ttl: LIVE });
    mockDb.select.mockClear();
    await orderRouter.createCaller(ctx("ceo")).agentSummary(input);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe("shop.receivablesAging", () => {
  it("ключ shop.receivablesAging: только день, minute; две панели — один пересчёт", async () => {
    await shopRouter.createCaller(ctx("ceo")).receivablesAging();
    await shopRouter.createCaller(ctx("supervisor", 1, 55)).receivablesAging();
    expect(last()).toEqual({ tenantId: 1, name: "shop.receivablesAging", input: { day: dayKey(new Date()) }, ttl: MINUTE });
    expect(receivablesAging).toHaveBeenCalledTimes(1);
  });

  it("платёж (invalidateReports) — следующий вызов считает заново", async () => {
    await shopRouter.createCaller(ctx("ceo")).receivablesAging();
    await rc.invalidateReports(1, "payment");
    await shopRouter.createCaller(ctx("ceo")).receivablesAging();
    expect(receivablesAging).toHaveBeenCalledTimes(2);
  });
});

describe("shop.scores", () => {
  it("ключ shop.scores из limit, fiveMin — вместо withCache без сброса", async () => {
    await shopRouter.createCaller(ctx("supervisor")).scores({ limit: 500 });
    await shopRouter.createCaller(ctx("ceo")).scores();
    expect(last()).toEqual({ tenantId: 1, name: "shop.scores", input: { limit: 500 }, ttl: FIVE });
    expect(shopScores).toHaveBeenCalledTimes(1);
  });
});

describe("shop.debtJournal", () => {
  const collected = {
    rows: Array.from({ length: 5 }, (_, i) => ({
      date: new Date(2026, 8, 10 - i), shopId: 1, shopName: "S", city: null, agentName: null,
      kind: "order" as const, doc: `O-${i}`, orderId: i + 1, note: null, amount: 100,
    })),
    totals: { taken: 500, paid: 0 },
    truncated: false,
  };
  beforeEach(() => vi.mocked(collectDebtJournal).mockResolvedValue(collected));

  it("ключ без page/pageSize: страница 2 и реестр (pageSize 500) не пересчитывают", async () => {
    const caller = shopRouter.createCaller(ctx("supervisor"));
    const p1 = await caller.debtJournal({ dateFrom: "2026-09-01", page: 1, pageSize: 2 });
    const p2 = await caller.debtJournal({ dateFrom: "2026-09-01", page: 2, pageSize: 2 });
    const reg = await caller.debtJournal({ dateFrom: "2026-09-01", page: 1, pageSize: 500 });

    expect(collectDebtJournal).toHaveBeenCalledTimes(1);
    expect(last().name).toBe("shop.debtJournal");
    expect(last().ttl).toBe(MINUTE);
    expect(last().input).not.toHaveProperty("page");
    expect(last().input).not.toHaveProperty("pageSize");
    expect(last().input).toMatchObject({ dateFrom: "2026-09-01" });

    expect(p1.rows.map(r => r.doc)).toEqual(["O-0", "O-1"]);
    expect(p2.rows.map(r => r.doc)).toEqual(["O-2", "O-3"]);
    expect(p2.total).toBe(5);
    expect(p2.totals).toEqual({ taken: 500, paid: 0 });
    expect(reg.rows).toHaveLength(5);
  });

  it("другой фильтр — другой набор", async () => {
    const caller = shopRouter.createCaller(ctx("supervisor"));
    await caller.debtJournal({ search: "Mega", page: 1, pageSize: 50 });
    await caller.debtJournal({ search: "Mini", page: 1, pageSize: 50 });
    expect(collectDebtJournal).toHaveBeenCalledTimes(2);
  });

  it("после Redis дата приезжает строкой — страница отдаёт Date", () => {
    const thawed = JSON.parse(JSON.stringify(collected));
    const page = paginateDebtJournal(thawed, 1, 2);
    expect(page.rows[0].date).toBeInstanceOf(Date);
    expect(page.rows[0].date.getTime()).toBe(collected.rows[0].date.getTime());
  });
});

describe("returns.summary", () => {
  it("ключ returns.summary: месяц, fiveMin; повтор — без базы", async () => {
    mockDb = chainDb([{ reason: "defect", count: 1, totalAmount: "10.00" }]);
    await returnsRouter.createCaller(ctx("operator")).summary();
    expect(last()).toEqual({ tenantId: 1, name: "returns.summary", input: { month: monthRange().start }, ttl: FIVE });
    mockDb.select.mockClear();
    await returnsRouter.createCaller(ctx("ceo")).summary();
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

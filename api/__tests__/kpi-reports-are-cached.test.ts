/**
 * Отчёты KPI и зарплат считаются один раз на организацию.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ведомость зарплат — сотни запросов на организацию, и каждое открытие
 * считало её заново; кэш был только у agentKpi/courierKpi, по ключу со словом
 * «month», который никто не сбрасывал. Тридцать директоров первого числа —
 * тридцать одинаковых пересчётов в пул на двадцать соединений.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Стенд считает РАБОТУ: вызовы расчётов из services/kpi (подменены
 * счётчиками) плюс прямые запросы роутера к базе (подделка считает select).
 * Второе открытие обязано стоить ноль. Кэш — настоящий lib/report-cache без
 * Redis: память с версией арендатора, сброс — invalidateReports.
 *
 * Страж строгий по построению: убери reportCached у любой ручки — второй
 * вызов пойдёт в расчёт, и «ноль работы» упадёт; положи в ключ слово периода
 * вместо дат — упадёт проверка границы месяца; убери invalidateReports у
 * setSalary — упадёт «после записи считается заново».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { users, shops } from "@db/schema";

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("../services/NotificationService", () => ({ NotificationService: { create: vi.fn(async () => {}) } }));
vi.mock("../services/push-service", () => ({ sendPushToUser: vi.fn(async () => {}) }));

/*
  Расчёты подменены: здесь проверяется не арифметика (её держат
  kpi-agent-numbers, commission-business и real-db), а то, сколько раз роутер
  за ней ходит. Каждая подделка возвращает то, что роутер из ответа читает.
*/
vi.mock("../services/kpi", () => ({
  calculateAgentKpi: vi.fn(async (_db: unknown, agentId: number) => ({ agentId, kpiScore: 50, revenue: 100, orderCount: 1, visitedPlans: 1 })),
  calculateAllAgentsKpi: vi.fn(async () => []),
  calculateCourierStats: vi.fn(async (_db: unknown, courierId: number) => ({ courierId, delivered: 1 })),
  calculateSalary: vi.fn(async (_db: unknown, agentId: number) => ({ agentId, totalSalary: 1 })),
  getAgentList: vi.fn(async () => []),
  getCourierList: vi.fn(async () => []),
  getCourierDaily: vi.fn(async () => []),
}));

// ── Подделка базы: считает select, отдаёт строки по таблице, не фильтрует ──
const dbCalls = { selects: 0 };
const rowsOf = new Map<unknown, Record<string, unknown>[]>();

function chain(rows: () => unknown[]): any {
  const p: any = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(rows()).then(res, rej);
      if (prop === "from") return (table: unknown) => chain(() => rowsOf.get(table) ?? []);
      return () => p;
    },
  });
  return p;
}

const fakeDb: any = {
  select: () => { dbCalls.selects++; return chain(() => []); },
  insert: () => chain(() => [{ insertId: 1 }]),
  update: () => chain(() => []),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};
vi.mock("../queries/connection", () => ({ getDb: () => fakeDb }));

function ctx(tenantId: number, userId: number, role: string): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active", name: "T", email: "t@t", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "t", name: "T", plan: "trial", status: "active", createdAt: new Date(), updatedAt: new Date() },
    db: fakeDb,
  };
}

const router = async () => (await import("../kpi-router")).kpiRouter;
const kpi = async () => vi.mocked(await import("../services/kpi"));
const cacheLib = async () => import("../lib/report-cache");

/** Сколько раз сходили за числами: расчёты + прямые запросы роутера. */
async function work(): Promise<number> {
  const k = await kpi();
  return dbCalls.selects + Object.values(k).reduce((n, fn) => n + (typeof fn === "function" && "mock" in fn ? fn.mock.calls.length : 0), 0);
}

/** Работа, потраченная на один вызов. */
async function cost(run: () => Promise<unknown>): Promise<number> {
  const before = await work();
  await run();
  return (await work()) - before;
}

beforeEach(async () => {
  dbCalls.selects = 0;
  vi.clearAllMocks();
  rowsOf.set(users, [
    { id: 10, name: "Агент", role: "agent" },
    { id: 7, name: "Курьер", role: "courier" },
  ]);
  rowsOf.set(shops, [{ agentId: 10 }, { agentId: 11 }]);
  // Кэш — настоящий и живёт между тестами; сброс версией, как в бою.
  const { invalidateReports } = await cacheLib();
  await invalidateReports(1, "test");
  await invalidateReports(2, "test");
});

afterEach(() => { vi.useRealTimers(); });

// ── Ручки руководителя: ключ = организация + вход, без userId ───────────────

type Caller = ReturnType<Awaited<ReturnType<typeof router>>["createCaller"]>;
const MANAGER_REPORTS: Array<[string, (c: Caller) => Promise<unknown>]> = [
  ["agentList",     c => c.agentList({ period: "month" })],
  ["courierList",   c => c.courierList({ period: "month" })],
  ["agentDetail",   c => c.agentDetail({ agentId: 10, period: "month" })],
  ["courierDetail", c => c.courierDetail({ courierId: 7, period: "month" })],
  ["territoryKpi",  c => c.territoryKpi({ territoryId: 3, period: "month" })],
  ["salaryOf",      c => c.salaryOf({ agentId: 10, period: "month" })],
  ["salaryReport",  c => c.salaryReport({ period: "month", offset: 0 })],
];

describe.each(MANAGER_REPORTS)("kpi.%s", (_name, call) => {
  it("второе открытие — без базы и без расчёта, и тот же ответ", async () => {
    const r = await router();
    const ceo = r.createCaller(ctx(1, 1, "ceo"));
    let first: unknown;
    expect(await cost(async () => { first = await call(ceo); }), "первый раз должен считать").toBeGreaterThan(0);
    let second: unknown;
    expect(await cost(async () => { second = await call(ceo); }), "второй раз пошёл в базу").toBe(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("супервайзер и директор одной организации делят один ответ", async () => {
    // Супервайзер территориями на сервере не ограничен — в ключе нет userId.
    const r = await router();
    await call(r.createCaller(ctx(1, 1, "ceo")));
    expect(await cost(() => call(r.createCaller(ctx(1, 2, "supervisor")))), "тот же отчёт посчитан дважды").toBe(0);
  });

  it("другая организация с тем же входом считает своё", async () => {
    const r = await router();
    await call(r.createCaller(ctx(1, 1, "ceo")));
    expect(await cost(() => call(r.createCaller(ctx(2, 3, "ceo")))), "чужой ответ отдан из кэша").toBeGreaterThan(0);
  });

  it("сброс отчётов организации заставляет считать заново — и только её", async () => {
    const r = await router();
    const { invalidateReports } = await cacheLib();
    await call(r.createCaller(ctx(1, 1, "ceo")));
    await call(r.createCaller(ctx(2, 3, "ceo")));
    await invalidateReports(1, "test");
    expect(await cost(() => call(r.createCaller(ctx(1, 1, "ceo")))), "после сброса отдано старое").toBeGreaterThan(0);
    expect(await cost(() => call(r.createCaller(ctx(2, 3, "ceo")))), "сброс одной организации задел другую").toBe(0);
  });
});

describe("ключ отчёта — по датам периода, а не по слову", () => {
  it("«month» в 23:59:30 сентября и в 00:00:10 октября — два разных ключа", async () => {
    // Сорок секунд — внутри TTL любой ручки: если бы ключ был по слову «month»,
    // октябрь получил бы сентябрьский ответ.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    const r = await router();
    const ceo = r.createCaller(ctx(1, 1, "ceo"));
    await ceo.agentList({ period: "month" });
    expect(await cost(() => ceo.agentList({ period: "month" })), "в тех же сутках — не хит").toBe(0);

    vi.setSystemTime(new Date(2026, 9, 1, 0, 0, 10));
    expect(await cost(() => ceo.agentList({ period: "month" })), "октябрь отдан сентябрьским ответом").toBeGreaterThan(0);
  });
});

describe("само-ручки: ключ несёт разрешённого человека", () => {
  it("agentKpi: два агента одной организации не делят ответ", async () => {
    const r = await router();
    await r.createCaller(ctx(1, 10, "agent")).agentKpi({ period: "month" });
    expect(await cost(() => r.createCaller(ctx(1, 11, "agent")).agentKpi({ period: "month" })), "агент получил чужой KPI").toBeGreaterThan(0);
    expect(await cost(() => r.createCaller(ctx(1, 10, "agent")).agentKpi({ period: "month" }))).toBe(0);
  });

  it("courierKpi: курьер с чужим courierId во входе получает СВОЙ ключ", async () => {
    const r = await router();
    const k = await kpi();
    await r.createCaller(ctx(1, 5, "courier")).courierKpi({ period: "month", courierId: 7 });
    expect(k.calculateCourierStats.mock.calls[0]?.[1], "курьеру посчитали чужого").toBe(5);
    // Директор открыл карточку того же курьера — тот же ключ, что и у него самого.
    expect(await cost(() => r.createCaller(ctx(1, 1, "ceo")).courierKpi({ period: "month", courierId: 5 }))).toBe(0);
    // А чужой id для директора — настоящий другой ключ.
    expect(await cost(() => r.createCaller(ctx(1, 1, "ceo")).courierKpi({ period: "month", courierId: 7 }))).toBeGreaterThan(0);
    expect(k.calculateCourierStats.mock.calls.at(-1)?.[1]).toBe(7);
  });

  it("salary: своя зарплата — свой ключ", async () => {
    const r = await router();
    await r.createCaller(ctx(1, 10, "agent")).salary({ period: "month" });
    expect(await cost(() => r.createCaller(ctx(1, 11, "agent")).salary({ period: "month" })), "агент увидел чужую зарплату").toBeGreaterThan(0);
    expect(await cost(() => r.createCaller(ctx(1, 10, "agent")).salary({ period: "month" }))).toBe(0);
  });
});

describe("salary: черновик строки commissions пишется на промахе", () => {
  const persistArg = (call: unknown[]) => call[6];

  it("месяц: промах пишет (persist = true), попадание не трогает базу, сброс — пишет снова", async () => {
    const r = await router();
    const k = await kpi();
    const { invalidateReports } = await cacheLib();
    const me = r.createCaller(ctx(1, 10, "agent"));
    await me.salary({ period: "month" });
    expect(k.calculateSalary).toHaveBeenCalledTimes(1);
    expect(persistArg(k.calculateSalary.mock.calls[0]), "месячный расчёт перестал писать черновик").toBe(true);

    await me.salary({ period: "month" });
    expect(k.calculateSalary, "попадание пошло в расчёт").toHaveBeenCalledTimes(1);

    // Заказ довезли — сервис записи сбросил отчёты: следующее открытие
    // пересчитывает и обновляет строку.
    await invalidateReports(1, "order.delivered");
    await me.salary({ period: "month" });
    expect(k.calculateSalary).toHaveBeenCalledTimes(2);
    expect(persistArg(k.calculateSalary.mock.calls[1])).toBe(true);
  });

  it("неделя и квартал не пишут", async () => {
    const r = await router();
    const k = await kpi();
    const me = r.createCaller(ctx(1, 10, "agent"));
    await me.salary({ period: "week" });
    await me.salary({ period: "quarter" });
    expect(k.calculateSalary.mock.calls.map(persistArg)).toEqual([false, false]);
  });

  it("руководитель смотрит чужую зарплату — не пишет", async () => {
    const r = await router();
    const k = await kpi();
    await r.createCaller(ctx(1, 1, "ceo")).salaryOf({ agentId: 10, period: "month" });
    await r.createCaller(ctx(1, 1, "ceo")).courierDetail({ courierId: 7, period: "month" });
    expect(k.calculateSalary.mock.calls.map(persistArg)).toEqual([false, false]);
  });
});

describe("отказ не кэшируется", () => {
  it("courierDetail: «не найден» сегодня — карточка завтра, когда курьер заведён", async () => {
    const r = await router();
    const ceo = r.createCaller(ctx(1, 1, "ceo"));
    rowsOf.set(users, []);
    await expect(ceo.courierDetail({ courierId: 7, period: "month" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    rowsOf.set(users, [{ id: 7, name: "Курьер", role: "courier" }]);
    await expect(ceo.courierDetail({ courierId: 7, period: "month" })).resolves.toHaveProperty("stats");
  });
});

// ── Записи этого роутера сбрасывают отчёты (сервиса у них нет) ──────────────

describe("после записи ведомость считается заново", () => {
  const openReport = async () => {
    const r = await router();
    const ceo = r.createCaller(ctx(1, 1, "ceo"));
    await ceo.salaryReport({ period: "month" });
    expect(await cost(() => ceo.salaryReport({ period: "month" }))).toBe(0);
    return ceo;
  };

  it("setSalary: новый оклад виден сразу, а не через пять минут", async () => {
    const ceo = await openReport();
    await ceo.setSalary({ userId: 10, baseSalary: 3_000_000 });
    expect(await cost(() => ceo.salaryReport({ period: "month" })), "оклад изменён, ведомость старая").toBeGreaterThan(0);
  });

  it("setFraudDeduction: утверждённый вычет виден сразу", async () => {
    const ceo = await openReport();
    await ceo.setFraudDeduction({ userId: 10, offset: 0, amount: 1000 });
    expect(await cost(() => ceo.salaryReport({ period: "month" })), "вычет утверждён, ведомость старая").toBeGreaterThan(0);
  });

  it("recordPayout: выданное попадает в расходы сразу", async () => {
    const ceo = await openReport();
    await ceo.recordPayout({ userId: 10, amount: "100000", kind: "payout" });
    expect(await cost(() => ceo.salaryReport({ period: "month" })), "выплата записана, отчёты старые").toBeGreaterThan(0);
  });

  it("запись в одной организации не сбрасывает другую", async () => {
    const r = await router();
    const other = r.createCaller(ctx(2, 3, "ceo"));
    await other.salaryReport({ period: "month" });
    const ceo = await openReport();
    await ceo.setSalary({ userId: 10, baseSalary: 1 });
    expect(await cost(() => other.salaryReport({ period: "month" })), "чужая запись сбросила наш кэш").toBe(0);
  });
});

describe("что не кэшируется — и почему", () => {
  it("payouts и myPayouts: один индексный запрос дешевле ключа, а myPayouts ещё и личный", async () => {
    const r = await router();
    const ceo = r.createCaller(ctx(1, 1, "ceo"));
    expect(await cost(() => ceo.payouts({ period: "month", offset: 0 }))).toBe(1);
    expect(await cost(() => ceo.payouts({ period: "month", offset: 0 }))).toBe(1);
    const me = r.createCaller(ctx(1, 10, "agent"));
    expect(await cost(() => me.myPayouts({ period: "month", offset: 0 }))).toBe(1);
    expect(await cost(() => me.myPayouts({ period: "month", offset: 0 }))).toBe(1);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { cache } from "../../lib/cache";
import { ORG_HEALTH_CACHE_KEY, collectOrgHealth } from "../../services/org-health";

/**
 * «Здоровье» организации и флаг «уходит» — на настоящей базе, через tenant.list.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Консоль показывала «молчат 5+ дней» и «истекают ≤14 дней» по отдельности.
 * Платящий клиент, у которого заказы упали втрое, а вход ещё случается, не
 * попадал ни в один список — пока не замолкал совсем.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Шесть подобранных организаций, у каждой — ожидаемые уровень и причины:
 *   · «Здоровая» — всё в ходу, заказы растут, оплачено на месяц вперёд → 70+;
 *   · «Молчит» — платящая, 9 дней ни заказа, ни входа → уходит (правило 1);
 *   · «Обвал» — платящая, 9 заказов против 25 → уходит (правило 2, −64%);
 *   · «Истекает» — платящая, работает, но срок через 3 дня → уходит (правило 3);
 *   · «Пробная молчит» — 10 дней тишины, но пробная → не «уходит»;
 *   · песочница и приостановленная — без оценки (health = null).
 * Плюс: оценка собирается ОДНИМ запросом на все организации (без N+1), копия
 * на минуту сбрасывается записью оплаты — «Истекает» перестаёт уходить сразу.
 *
 * Нарочная поломка: убрать правило 2 (падение заказов) — падает «Обвал»;
 * считать «уходит» и у пробных — падает «Пробная молчит»; не сбрасывать
 * копию в recordSubscriptionPayment — падает «оплата сбрасывает».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000);

describe.skipIf(!hasRealDb)("здоровье организаций", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    cache.invalidate(ORG_HEALTH_CACHE_KEY);
    const [sys] = await d().insert(schema.tenants).values({ slug: "system", name: "Платформа" });
    systemId = Number(sys.insertId);
  });

  type Spec = {
    name: string; plan: "trial" | "basic" | "pro" | "exclusive"; sub: "trialing" | "active";
    periodEnds?: Date | null; trialEnds?: Date | null; status?: "active" | "suspended"; sandbox?: boolean;
    login: Date; people?: number; orders?: Array<[number, "new" | "delivered"]>; products?: boolean; gps?: boolean;
  };
  async function org(o: Spec): Promise<number> {
    n++;
    const [t] = await d().insert(schema.tenants).values({
      slug: `org-${n}`, name: o.name, plan: o.plan, status: o.status ?? "active", isSandbox: o.sandbox ?? false, createdAt: at(-120 * DAY),
    });
    const id = Number(t.insertId);
    const [ceo] = await d().insert(schema.users).values({ tenantId: id, name: "Директор", email: `ceo${n}@t.uz`, passwordHash: "x", role: "ceo", lastSignInAt: o.login });
    let agentId = Number(ceo.insertId);
    for (let i = 0; i < (o.people ?? 0); i++) {
      const [a] = await d().insert(schema.users).values({ tenantId: id, name: `Агент ${i}`, email: `a${n}-${i}@t.uz`, passwordHash: "x", role: "agent", lastSignInAt: o.login });
      if (i === 0) agentId = Number(a.insertId);
    }
    await d().insert(schema.subscriptions).values({ id: randomUUID(), tenantId: id, plan: o.plan, status: o.sub, trialEndsAt: o.trialEnds ?? null, currentPeriodEnds: o.periodEnds ?? null });
    if (o.products) await d().insert(schema.products).values({ tenantId: id, code: `P-${n}`, name: "Сок", unitPrice: "100.00" });
    if (o.orders?.length) {
      const [s] = await d().insert(schema.shops).values({ tenantId: id, name: `Магазин ${n}` });
      let i = 0;
      for (const [ago, status] of o.orders) {
        await d().insert(schema.orders).values({ tenantId: id, orderNumber: `O-${n}-${++i}`, shopId: Number(s.insertId), agentId, status, subtotal: "100.00", total: "100.00", createdAt: at(-ago) });
      }
    }
    if (o.gps) await d().insert(schema.agentLocations).values({ tenantId: id, agentId, lat: "41.3", lng: "69.2", createdAt: at(-HOUR) });
    return id;
  }
  /** count заказов между fromDays и toDays дней назад. */
  const spread = (count: number, fromDays: number, toDays: number, status: "new" | "delivered" = "delivered"): Array<[number, "new" | "delivered"]> =>
    Array.from({ length: count }, (_, i) => [(fromDays + ((toDays - fromDays) * i) / Math.max(1, count - 1)) * DAY, status]);

  const list = async () => {
    const { tenantRouter } = await import("../../tenant-router");
    return tenantRouter.createCaller(ctxFor(db, systemId, 1, "superadmin")).list();
  };
  const healthOf = async (id: number) => (await list()).find(o => o.id === id)!.health;

  it("подобранные организации: уровень, правило «уходит» и причины словами", async () => {
    const healthy = await org({ name: "Здоровая", plan: "pro", sub: "active", periodEnds: at(40 * DAY), login: at(-HOUR), people: 2, products: true, gps: true,
      orders: [...spread(20, 0.2, 28), ...spread(18, 31, 58)] });
    const silent = await org({ name: "Молчит", plan: "basic", sub: "active", periodEnds: at(25 * DAY), login: at(-9 * DAY - HOUR), products: true,
      orders: spread(3, 40, 50) });
    const drop = await org({ name: "Обвал", plan: "pro", sub: "active", periodEnds: at(30 * DAY), login: at(-HOUR), people: 1, products: true,
      orders: [...spread(9, 0.2, 28), ...spread(25, 31, 58)] });
    const expiring = await org({ name: "Истекает", plan: "exclusive", sub: "active", periodEnds: at(3 * DAY - HOUR), login: at(-HOUR), people: 1, products: true,
      orders: [...spread(10, 0.2, 28), ...spread(10, 31, 58)] });
    const trial = await org({ name: "Пробная молчит", plan: "trial", sub: "trialing", trialEnds: at(4 * DAY), login: at(-10 * DAY - HOUR) });
    const sandbox = await org({ name: "Песочница", plan: "exclusive", sub: "active", periodEnds: at(300 * DAY), sandbox: true, login: at(-HOUR) });
    const suspended = await org({ name: "Приостановлена", plan: "basic", sub: "active", periodEnds: at(-5 * DAY), status: "suspended", login: at(-40 * DAY) });

    const rows = await list();
    const h = (id: number) => rows.find(o => o.id === id)!.health!;

    expect(h(healthy).level).toBe("healthy");
    expect(h(healthy).churn).toBe(false);
    expect(h(healthy).score).toBeGreaterThanOrEqual(85);
    expect(h(healthy).reasons.map(r => r.text)).toEqual(expect.arrayContaining([
      "работали сегодня", "заказы выросли на 11% к прошлому месяцу (20 против 18)",
      "в ходу все 5 разделов: товары, магазины, заказы агентов, доставки, GPS", "за 30 дней работали 3 из 3 сотрудников",
    ]));

    expect(h(silent).level).toBe("churn");
    expect(h(silent).churnBecause).toEqual(["9 дней без заказов и входов"]);
    expect(h(silent).reasons[0]).toEqual({ tone: "bad", text: "9 дней без заказов и входов" });

    expect(h(drop).level).toBe("churn");
    expect(h(drop).churnBecause).toEqual(["заказы упали на 64% к прошлому месяцу"]);
    expect(h(drop).reasons.map(r => r.text)).toContain("заказы упали на 64% к прошлому месяцу (9 против 25)");

    expect(h(expiring).level).toBe("churn");
    expect(h(expiring).churnBecause).toEqual(["срок истекает через 3 дня, продления нет"]);
    expect(h(expiring).parts.payment).toBe(6);

    // Пробная молчит — плохо, но это «не начал», а не «уходит».
    expect(h(trial).churn).toBe(false);
    expect(h(trial).level).toBe("watch");
    expect(h(trial).reasons.map(r => r.text)).toContain("10 дней без заказов и входов");

    expect(rows.find(o => o.id === sandbox)!.health).toBeNull();
    expect(rows.find(o => o.id === suspended)!.health).toBeNull();
    // Фильтр «Уходят» в консоли — ровно эти трое.
    expect(rows.filter(o => o.health?.churn).map(o => o.name).sort()).toEqual(["Истекает", "Молчит", "Обвал"]);
  }, 60_000);

  it("одним запросом на все организации — число запросов не растёт с числом организаций", async () => {
    for (let i = 0; i < 4; i++) await org({ name: `Орг ${i}`, plan: "basic", sub: "active", periodEnds: at(20 * DAY), login: at(-HOUR), orders: spread(2, 1, 5) });
    let selects = 0;
    let executes = 0;
    const counting = new Proxy(db as object, {
      get(target, key, recv) {
        if (key === "select") selects++;
        if (key === "execute") executes++;
        return Reflect.get(target, key, recv);
      },
    });
    const map = await collectOrgHealth(counting as ServiceDb);
    expect(map.size).toBe(4);
    expect(selects).toBe(1);
    expect(executes).toBe(0);
  });

  it("оплата сбрасывает минутную копию: «Истекает» перестаёт уходить сразу", async () => {
    const id = await org({ name: "Истекает", plan: "basic", sub: "active", periodEnds: at(2 * DAY), login: at(-HOUR), products: true, orders: spread(5, 1, 20) });
    expect((await healthOf(id))!.churn).toBe(true);
    const { platformRouter } = await import("../../platform-router");
    await platformRouter.createCaller(ctxFor(db, systemId, 1, "superadmin"))
      .recordPayment({ tenantId: id, amount: 299_000, paidAt: new Date().toISOString().slice(0, 10), method: "cash", plan: "basic", months: 1 });
    const after = (await healthOf(id))!;
    expect(after.churn).toBe(false);
    expect(after.reasons.map(r => r.text).join(" | ")).toMatch(/оплачено ещё на (31|32|33) д/);
  });
});

/**
 * P&L под кэшем на настоящей MySQL: числа те же, второй раз — без SQL.
 *
 * ── Почему не на заглушке ───────────────────────────────────────────────────
 *
 * Заглушка отдаёт одну строку на любой select — ей не отличить «выручка минус
 * проведённый возврат» от чего угодно. Здесь P&L считается настоящими
 * запросами (пять чтений периода, помесячный ряд, возвраты), кладётся в
 * настоящий report-cache и читается обратно: JSON первого и второго ответа
 * обязан совпасть до байта, а второй — не тронуть базу вовсе. Затем запись
 * (новый доставленный заказ) и сброс организации — и число обязано измениться
 * ровно на сумму заказа: кэш не должен ни округлить, ни задержать.
 *
 * Роутер берёт базу через getDb() — подменяем на тестовую, обёрнутую в
 * счётчик select.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
/** Сколько раз роутер обратился к базе (вызовы select через getDb()). */
let selects = 0;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

/** Та же база, но каждый select считается. */
function counting(db: ServiceDb): ServiceDb {
  return new Proxy(db as object, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "select" && typeof v === "function") {
        return (...args: unknown[]) => { selects++; return (v as (...a: unknown[]) => unknown).apply(target, args); };
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as ServiceDb;
}

function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "ceo", status: "active" as const, name: "Директор", email: "ceo@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

/** Окно, заведомо накрывающее сегодняшний день. */
const FROM = "2000-01-01";
const TO = "2999-12-31";

describe.skipIf(!hasRealDb)("P&L под кэшем: точные числа, второй раз без SQL", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = counting(db); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    selects = 0;
    // TRUNCATE возвращает автоинкремент: организация снова №1, и ответ прошлого
    // теста лежал бы в памяти под тем же ключом. Сброс — как после записи.
    await invalidateReports(s.tenantId, "test");
  });

  async function deliveredOrder(total: string, cost: string) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: "delivered", paymentMethod: "cash", subtotal: total, total,
    } as never);
    const orderId = Number(row.insertId);
    await db.insert(schema.orderItems).values({
      orderId, productId: s.productId, quantity: "1.00",
      unitPrice: total, costPrice: cost, subtotal: total,
    } as never);
  }

  const analytics = async () => (await import("../../analytics-router")).analyticsRouter.createCaller(ctxFor(current, s.tenantId, s.agentId));

  it("pnl: повтор — побайтно тот же JSON и ноль SQL; после записи и сброса — новое число", async () => {
    await deliveredOrder("300.00", "180.00");
    const input = { from: FROM, to: TO, compareWithPrev: true };

    const first = await (await analytics()).pnl(input);
    expect(first.current).toMatchObject({ revenue: 300, cogs: 180, grossProfit: 120 });
    const cost = selects;
    expect(cost, "первый вызов обязан считать").toBeGreaterThan(0);

    const second = await (await analytics()).pnl(input);
    expect(selects, "второй вызов пошёл в базу").toBe(cost);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Запись в кэш не смотрит — за ней зовут сброс организации.
    await deliveredOrder("200.00", "100.00");
    await invalidateReports(s.tenantId, "заказ доставлен");
    const third = await (await analytics()).pnl(input);
    expect(selects).toBeGreaterThan(cost);
    expect(third.current).toMatchObject({ revenue: 500, cogs: 280, grossProfit: 220 });
  });

  it("pnlByPaymentMethod: один вход с P&L и «Отчётов» — один пересчёт", async () => {
    await deliveredOrder("300.00", "180.00");
    const first = await (await analytics()).pnlByPaymentMethod({ from: FROM, to: TO });
    expect(first).toEqual([expect.objectContaining({ paymentMethod: "cash", revenue: 300, cogs: 180 })]);
    const cost = selects;
    const second = await (await analytics()).pnlByPaymentMethod({ from: FROM, to: TO });
    expect(selects).toBe(cost);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

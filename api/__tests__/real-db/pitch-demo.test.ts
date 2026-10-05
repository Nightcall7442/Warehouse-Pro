import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, type ServiceDb } from "./harness";

/**
 * Демо для жюри (/demo) на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * 1. Песочница из консоли платформы падала посреди заполнения: генератор
 *    клал один товар в заказ дважды, а у order_items уникальный ключ
 *    (order_id, product_id). Суперадмин видел «внутреннюю ошибку», в базе
 *    оставалась полупустая организация. Проверки на базе у seedSandbox не
 *    было — платформенный набор её подменяет заглушкой, — и поломку никто не
 *    видел. Здесь она заполняется по-настоящему.
 * 2. Демо-вход — новый: кого впускать, решает база, а не слово переменной.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * - seedSandbox заполняет всё (320 заказов), seedPitchDemoExtras досевает
 *   остатки партиями, себестоимость, оплаты, долги, планы и супервайзера —
 *   только в песочнице и только один раз;
 * - findDemoUser: переменная не задана — выключено; номер живой организации
 *   — отказ; приостановленная песочница — отказ; нет роли — отказ;
 * - POST /api/demo/login настоящим путём: живая организация в переменной —
 *   403 без куки; песочница — кука сессии её директора;
 * - demoStatus отдаёт ключ только живой, непросроченный и своей песочницы;
 * - /api/logout-all демо-пользователю отказывает и tokenVersion не трогает,
 *   обычному — работает.
 */

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());

import { seedSandbox, SANDBOX_ORDER_COUNT } from "../../services/sandbox";
import { seedPitchDemoExtras, findDemoUser, demoStatus, isDemoUser } from "../../services/pitch-demo";
import demoRoutes from "../../http/demo";
import authRoutes from "../../http/auth";
import { verifySessionToken, signSessionToken } from "../../auth/session";

const count = async (db: ServiceDb, q: ReturnType<typeof sql>) => {
  const [rows] = await (db as unknown as { execute: (q: unknown) => Promise<[Array<{ n: number }>]> }).execute(q);
  return Number(rows[0]?.n ?? 0);
};

describe.skipIf(!hasRealDb)("демо для жюри на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let sandboxId = 0;
  let liveId = 0;
  let sandboxCeo = 0;
  let liveCeo = 0;

  beforeAll(async () => { db = current = await connectRealDb(); });
  afterAll(async () => { delete process.env.PITCH_DEMO_TENANT_ID; delete process.env.PITCH_DEMO_API_KEY; await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    const [t] = await d().insert(schema.tenants).values({ slug: "sb", name: "Песочница", plan: "exclusive", status: "active", isSandbox: true });
    sandboxId = Number(t.insertId);
    const [l] = await d().insert(schema.tenants).values({ slug: "live", name: "Живая", plan: "exclusive", status: "active" });
    liveId = Number(l.insertId);
    const [c] = await d().insert(schema.users).values({ tenantId: sandboxId, name: "Директор", email: "demo-ceo@test.local", passwordHash: "x", role: "ceo", status: "active" });
    sandboxCeo = Number(c.insertId);
    const [lc] = await d().insert(schema.users).values({ tenantId: liveId, name: "Живой директор", email: "live-ceo@test.local", passwordHash: "x", role: "ceo", status: "active" });
    liveCeo = Number(lc.insertId);
    process.env.PITCH_DEMO_TENANT_ID = String(sandboxId);
    delete process.env.PITCH_DEMO_API_KEY;
  });

  describe("заполнение", () => {
    it("песочница заполняется целиком — ни один заказ не падает на повторе товара", async () => {
      const r = await seedSandbox(db as never, sandboxId);
      expect(r.orders).toBe(SANDBOX_ORDER_COUNT);
      expect(await count(db, sql`SELECT COUNT(*) n FROM orders WHERE tenant_id = ${sandboxId}`)).toBe(SANDBOX_ORDER_COUNT);
      expect(await count(db, sql`SELECT COUNT(*) n FROM (SELECT order_id, product_id FROM order_items GROUP BY 1, 2 HAVING COUNT(*) > 1) x`)).toBe(0);
      // Сумма строк сходится с суммой заказа: слияние повторов не потеряло количество.
      expect(await count(db, sql`
        SELECT COUNT(*) n FROM orders o
        WHERE o.tenant_id = ${sandboxId}
          AND ABS(o.subtotal - (SELECT SUM(oi.subtotal) FROM order_items oi WHERE oi.order_id = o.id)) > 0.01`)).toBe(0);
    }, 120_000);

    it("досев для показа: остатки партиями, себестоимость, оплаты, долги, планы, супервайзер — и только один раз", async () => {
      await seedSandbox(db as never, sandboxId);
      const first = await seedPitchDemoExtras(db as never, sandboxId);
      expect(first.supervisorAdded).toBe(true);
      expect(first.stocked).toBe(12);
      expect(first.paymentsAdded).toBeGreaterThan(0);
      expect(first.plansAdded).toBeGreaterThan(0);

      expect(await count(db, sql`SELECT COUNT(*) n FROM warehouse_stock WHERE tenant_id = ${sandboxId} AND current_stock > 0`)).toBe(12);
      expect(await count(db, sql`SELECT COUNT(*) n FROM stock_batches WHERE tenant_id = ${sandboxId} AND expires_at <= CURDATE() + INTERVAL 14 DAY`)).toBe(2);
      expect(await count(db, sql`SELECT COUNT(*) n FROM products WHERE tenant_id = ${sandboxId} AND cost_price = 0`)).toBe(0);
      expect(await count(db, sql`SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.tenant_id = ${sandboxId} AND (oi.cost_price IS NULL OR oi.cost_price = 0)`)).toBe(0);
      // Долг есть, но не вся выручка: наличные оплачены, «в долг» — частично.
      const debt = await count(db, sql`SELECT ROUND(SUM(debt)) n FROM shops WHERE tenant_id = ${sandboxId}`);
      const revenue = await count(db, sql`SELECT ROUND(SUM(total)) n FROM orders WHERE tenant_id = ${sandboxId} AND status = 'delivered' AND deleted_at IS NULL`);
      expect(debt).toBeGreaterThan(0);
      expect(debt).toBeLessThan(revenue / 2);
      // План на сегодня есть у каждого агента.
      expect(await count(db, sql`SELECT COUNT(DISTINCT agent_id) n FROM daily_plans WHERE tenant_id = ${sandboxId} AND plan_date = UTC_DATE()`)).toBe(4);
      expect(await count(db, sql`SELECT COUNT(*) n FROM (SELECT agent_id, shop_id, plan_date FROM daily_plans GROUP BY 1, 2, 3 HAVING COUNT(*) > 1) x`)).toBe(0);

      const before = {
        stock: await count(db, sql`SELECT ROUND(SUM(current_stock)) n FROM warehouse_stock WHERE tenant_id = ${sandboxId}`),
        pays: await count(db, sql`SELECT COUNT(*) n FROM payments WHERE tenant_id = ${sandboxId}`),
        plans: await count(db, sql`SELECT COUNT(*) n FROM daily_plans WHERE tenant_id = ${sandboxId}`),
      };
      const second = await seedPitchDemoExtras(db as never, sandboxId);
      expect(second).toEqual({ supervisorAdded: false, stocked: 0, paymentsAdded: 0, plansAdded: 0 });
      expect(await count(db, sql`SELECT ROUND(SUM(current_stock)) n FROM warehouse_stock WHERE tenant_id = ${sandboxId}`)).toBe(before.stock);
      expect(await count(db, sql`SELECT COUNT(*) n FROM payments WHERE tenant_id = ${sandboxId}`)).toBe(before.pays);
      expect(await count(db, sql`SELECT COUNT(*) n FROM daily_plans WHERE tenant_id = ${sandboxId}`)).toBe(before.plans);
    }, 120_000);

    it("живую организацию не досевает", async () => {
      await expect(seedPitchDemoExtras(db as never, liveId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await count(db, sql`SELECT COUNT(*) n FROM users WHERE tenant_id = ${liveId}`)).toBe(1);
    });
  });

  describe("кого впускать", () => {
    it("переменная не задана — выключено", async () => {
      delete process.env.PITCH_DEMO_TENANT_ID;
      expect(await findDemoUser(db as never, "ceo")).toEqual({ ok: false, reason: "disabled" });
    });

    it("в переменной живая организация — отказ, хотя директор там есть", async () => {
      process.env.PITCH_DEMO_TENANT_ID = String(liveId);
      expect(await findDemoUser(db as never, "ceo")).toEqual({ ok: false, reason: "not_sandbox" });
    });

    it("песочница приостановлена — отказ", async () => {
      await d().update(schema.tenants).set({ status: "suspended" }).where(eq(schema.tenants.id, sandboxId));
      expect(await findDemoUser(db as never, "ceo")).toEqual({ ok: false, reason: "not_sandbox" });
    });

    it("нет человека роли — отказ; неактивный не считается", async () => {
      expect(await findDemoUser(db as never, "supervisor")).toEqual({ ok: false, reason: "no_user" });
      await d().insert(schema.users).values({ tenantId: sandboxId, name: "Уволен", email: "gone@test.local", passwordHash: "!", role: "agent", status: "inactive" });
      expect(await findDemoUser(db as never, "agent")).toEqual({ ok: false, reason: "no_user" });
    });

    it("директор песочницы — его сессия", async () => {
      expect(await findDemoUser(db as never, "ceo")).toEqual({ ok: true, userId: sandboxCeo, tokenVersion: 0 });
    });
  });

  describe("POST /api/demo/login настоящим путём", () => {
    const post = (role: string) => demoRoutes.request("/api/demo/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }),
    });

    it("живая организация в переменной — 403 без куки", async () => {
      process.env.PITCH_DEMO_TENANT_ID = String(liveId);
      const r = await post("ceo");
      expect(r.status).toBe(403);
      expect(r.headers.get("set-cookie")).toBeNull();
    });

    it("переменная не задана — 404 без куки", async () => {
      delete process.env.PITCH_DEMO_TENANT_ID;
      const r = await post("ceo");
      expect(r.status).toBe(404);
      expect(r.headers.get("set-cookie")).toBeNull();
    });

    it("песочница — кука сессии её директора", async () => {
      const r = await post("ceo");
      expect(r.status).toBe(200);
      const token = (r.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1];
      expect((await verifySessionToken(token))?.userId).toBe(sandboxCeo);
      expect(await isDemoUser(db as never, sandboxCeo)).toBe(true);
      expect(await isDemoUser(db as never, liveCeo)).toBe(false);
    });
  });

  describe("ключ API для страницы", () => {
    const addKey = async (tenantId: number, raw: string, extra: Partial<typeof schema.apiKeys.$inferInsert> = {}) => {
      await d().insert(schema.apiKeys).values({
        tenantId, name: "k", keyHash: createHash("sha256").update(raw).digest("hex"), keyPrefix: raw.slice(0, 12), scopes: "read", rateLimit: 60, ...extra,
      });
    };

    it("ключ своей песочницы — отдаётся; роли — те, что есть", async () => {
      const raw = "wp_test_" + "a".repeat(48);
      await addKey(sandboxId, raw);
      process.env.PITCH_DEMO_API_KEY = raw;
      expect(await demoStatus(db as never)).toEqual({ enabled: true, roles: ["ceo"], apiKey: raw });
    });

    it.each([
      ["ключ живой организации", "live", {}],
      ["отозванный", "sandbox", { status: "revoked" }],
      ["просроченный", "sandbox", { expiresAt: new Date(Date.now() - 60_000) }],
    ] as const)("%s — не отдаётся", async (_label, owner, extra) => {
      const raw = "wp_test_" + "b".repeat(48);
      await addKey(owner === "live" ? liveId : sandboxId, raw, extra as never);
      process.env.PITCH_DEMO_API_KEY = raw;
      expect((await demoStatus(db as never)).apiKey).toBeNull();
    });

    it("боевой wp_live_ не отдаётся даже из песочницы", async () => {
      const raw = "wp_live_" + "c".repeat(48);
      await addKey(sandboxId, raw);
      process.env.PITCH_DEMO_API_KEY = raw;
      expect((await demoStatus(db as never)).apiKey).toBeNull();
    });

    it("демо выключено — ничего не отдаётся", async () => {
      const raw = "wp_test_" + "d".repeat(48);
      await addKey(sandboxId, raw);
      process.env.PITCH_DEMO_API_KEY = raw;
      delete process.env.PITCH_DEMO_TENANT_ID;
      expect(await demoStatus(db as never)).toEqual({ enabled: false, roles: [], apiKey: null });
    });
  });

  describe("выйти со всех устройств", () => {
    const logoutAll = async (userId: number) => authRoutes.request("/api/logout-all", {
      method: "POST", headers: { authorization: `Bearer ${await signSessionToken({ userId, tv: 0 })}` },
    });
    const tv = async (id: number) => (await d().select({ tv: schema.users.tokenVersion }).from(schema.users).where(and(eq(schema.users.id, id))))[0].tv;

    it("демо-пользователю — отказ, сессии остальных живы", async () => {
      const r = await logoutAll(sandboxCeo);
      expect(r.status).toBe(403);
      expect(await tv(sandboxCeo)).toBe(0);
    });

    it("обычному — работает", async () => {
      const r = await logoutAll(liveCeo);
      expect(r.status).toBe(200);
      expect(await tv(liveCeo)).toBe(1);
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { cache } from "../../lib/cache";
import { OWNER_PANEL_CACHE_KEY } from "../../services/owner-panel";
import { GRANDFATHER_UNTIL, monthlyPrice } from "@contracts/pricing";
import { tashkentDay } from "@contracts/subscription-payment";

/**
 * Список организаций консоли платформы (tenant.list) — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Список отдавал счётчики за всё время — людей, заказы и сумму — и подписку.
 * Кто работает сейчас, кто замолчал, у кого кончается оплата, какой у
 * организации ИНН и телефон — в нём не было; искать клиента по ИНН или
 * номеру с платёжки было нечем.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Через настоящую ручку (superAdminQuery) на наборе организаций:
 *   · заказы и выручка за 30 дней — без отменённых и удалённых, без старше
 *     30 дней; деньги целыми; прежние счётчики за всё время не тронуты;
 *   · последний заказ, последний вход и последняя активность (что позже);
 *   · телефон и почта — из карточки, иначе директора; ИНН — из реквизитов;
 *   · сегменты фильтров (платит, пробный, молчит, продление) совпадают с
 *     панелью владельца — плитка «Обзора» и чип списка про одних и тех же;
 *     песочница и приостановленная — не клиенты;
 *   · системная организация в список не попадает; директору — отказ.
 *
 * Нарочная поломка (проверено): убрать `status <> 'cancelled'` из суммы за 30
 * дней — падает «за 30 дней»; брать телефон только из карточки — «контакт»;
 * считать сегменты своим правилом (без clientFlags) с порогом молчания 7 дней
 * — «как панель владельца».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const wholeSec = (t: number) => new Date(Math.floor(t / 1000) * 1000);
const ago = (ms: number) => wholeSec(Date.now() - ms);
const ahead = (ms: number) => wholeSec(Date.now() + ms);

describe.skipIf(!hasRealDb)("список организаций консоли на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let superId = 0;
  let n = 0;
  const ids: Record<string, number> = {};

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function org(key: string, o: {
    name: string; slug?: string; status?: "active" | "suspended"; isSandbox?: boolean; createdAt: Date;
    ownerPhone?: string | null; ownerEmail?: string | null; inn?: string | null;
    sub: { plan: "trial" | "basic" | "pro" | "exclusive"; status: "trialing" | "active"; trialEndsAt?: Date | null; currentPeriodEnds?: Date | null };
    ceo: { lastSignInAt: Date | null; phone?: string | null };
  }) {
    n++;
    const [t] = await d().insert(schema.tenants).values({
      slug: o.slug ?? `org-${n}`, name: o.name, plan: o.sub.plan, status: o.status ?? "active", isSandbox: o.isSandbox ?? false,
      createdAt: o.createdAt, trialEndsAt: o.sub.trialEndsAt ?? null, ownerPhone: o.ownerPhone ?? null, ownerEmail: o.ownerEmail ?? null,
    });
    const id = Number(t.insertId);
    const [u] = await d().insert(schema.users).values({
      tenantId: id, name: `Директор ${n}`, email: `ceo${n}@test.uz`, passwordHash: "x", role: "ceo",
      phone: o.ceo.phone ?? null, lastSignInAt: o.ceo.lastSignInAt, createdAt: o.createdAt,
    });
    await d().insert(schema.subscriptions).values({
      id: randomUUID(), tenantId: id, plan: o.sub.plan, status: o.sub.status,
      trialEndsAt: o.sub.trialEndsAt ?? null, currentPeriodEnds: o.sub.currentPeriodEnds ?? null,
    });
    if (o.inn !== undefined) await d().insert(schema.settings).values({ tenantId: id, companyInn: o.inn });
    ids[key] = id;
    return { id, ceoId: Number(u.insertId) };
  }
  const order = async (tenantId: number, agentId: number, createdAt: Date, total: string, extra: { status?: "new" | "cancelled" | "delivered"; deletedAt?: Date } = {}) => {
    const [s] = await d().insert(schema.shops).values({ tenantId, name: `Магазин ${++n}` });
    await d().insert(schema.orders).values({
      tenantId, orderNumber: `ORD-${n}`, shopId: Number(s.insertId), agentId, status: extra.status ?? "new",
      subtotal: total, total, createdAt, deletedAt: extra.deletedAt ?? null,
    });
  };

  beforeEach(async () => {
    await truncateAll();
    cache.invalidate(OWNER_PANEL_CACHE_KEY);
    n = 0;

    const sys = await org("system", {
      name: "Система", slug: "system", createdAt: ago(400 * DAY),
      sub: { plan: "exclusive", status: "active" }, ceo: { lastSignInAt: ago(HOUR) },
    });
    systemId = sys.id;
    const [su] = await d().insert(schema.users).values({ tenantId: sys.id, name: "Суперадмин", email: "root@system.local", passwordHash: "x", role: "superadmin" });
    superId = Number(su.insertId);

    // Платит, работает: заказы разных сортов. Телефона в карточке нет — директора.
    const pay = await org("pay", {
      name: "Платит Базовый", createdAt: ago(120 * DAY), inn: "301234567",
      sub: { plan: "basic", status: "active", currentPeriodEnds: ahead(40 * DAY) },
      ceo: { lastSignInAt: ago(3 * DAY), phone: "+998911234567" },
    });
    await order(pay.id, pay.ceoId, ago(20 * DAY), "1000.50");
    await order(pay.id, pay.ceoId, ago(2 * DAY), "2000.00", { status: "delivered" });
    await order(pay.id, pay.ceoId, ago(5 * DAY), "5000.00", { status: "cancelled" });
    await order(pay.id, pay.ceoId, ago(6 * DAY), "7000.00", { deletedAt: ago(5 * DAY) });
    await order(pay.id, pay.ceoId, ago(40 * DAY), "9000.00", { status: "delivered" });

    // Продление через 10 дней; телефон и почта — в карточке.
    await org("renew", {
      name: "Продление Про", createdAt: ago(200 * DAY), ownerPhone: "+998901112233", ownerEmail: "boss@renew.uz", inn: "",
      sub: { plan: "pro", status: "active", currentPeriodEnds: ahead(10 * DAY + HOUR) },
      ceo: { lastSignInAt: ago(HOUR), phone: "+998990000000" },
    });

    // Пробный, молчит шесть дней.
    await org("trial", {
      name: "Пробный Тихий", createdAt: ago(8 * DAY),
      sub: { plan: "trial", status: "trialing", trialEndsAt: ahead(5 * DAY) }, ceo: { lastSignInAt: ago(6 * DAY) },
    });

    // Не клиенты: приостановленная (по подписке «платит» и молчит) и песочница.
    await org("suspended", {
      name: "Приостановлена", status: "suspended", createdAt: ago(300 * DAY),
      sub: { plan: "pro", status: "active", currentPeriodEnds: ahead(5 * DAY) }, ceo: { lastSignInAt: ago(60 * DAY) },
    });
    await org("sandbox", {
      name: "Песочница", isSandbox: true, createdAt: ago(10 * DAY),
      sub: { plan: "exclusive", status: "active", currentPeriodEnds: ahead(300 * DAY) }, ceo: { lastSignInAt: ago(9 * DAY) },
    });
  });

  const list = async () => {
    const { tenantRouter } = await import("../../tenant-router");
    return tenantRouter.createCaller(ctxFor(db, systemId, superId, "superadmin")).list();
  };
  const row = async (key: string) => (await list()).find(r => r.id === ids[key])!;

  it("за 30 дней: без отменённых, удалённых и старых; деньги целыми; прежние счётчики на месте", async () => {
    const r = await row("pay");
    expect(r.orders30).toBe(2);
    expect(r.revenue30).toBe(3001);
    expect(r.orderCount, "за всё время — все пять, как раньше").toBe(5);
    expect(r.orderTotal).toBeCloseTo(24000.5, 2);
    expect(r.userCount).toBe(1);
    const quiet = await row("trial");
    expect(quiet).toMatchObject({ orders30: 0, revenue30: 0, orderCount: 0, lastOrderAt: null });
  });

  it("последний заказ, последний вход и активность — что позже", async () => {
    const r = await row("pay");
    expect(Math.abs(new Date(r.lastOrderAt!).getTime() - ago(2 * DAY).getTime())).toBeLessThan(2000);
    expect(Math.abs(new Date(r.lastLoginAt!).getTime() - ago(3 * DAY).getTime())).toBeLessThan(2000);
    expect(new Date(r.lastActivityAt).getTime()).toBe(new Date(r.lastOrderAt!).getTime());
    const t = await row("trial");
    expect(new Date(t.lastActivityAt).getTime()).toBe(new Date(t.lastLoginAt!).getTime());
  });

  it("контакт: из карточки, иначе директора; ИНН из реквизитов, пустой — нет", async () => {
    expect(await row("pay")).toMatchObject({ contactPhone: "+998911234567", contactEmail: "ceo2@test.uz", inn: "301234567" });
    expect(await row("renew")).toMatchObject({ contactPhone: "+998901112233", contactEmail: "boss@renew.uz", inn: null });
    expect((await row("trial")).inn).toBeNull();
  });

  it("сегменты: платит, продление, пробный, молчит; не клиенты — без сегментов", async () => {
    // Цена — та, что платит организация (contracts/pricing.ts): прежние тарифы по
    // прежней цене до 05.10.2027, потом — «Стандарт» без полевых, то есть минимум.
    const old = tashkentDay(new Date()) < GRANDFATHER_UNTIL;
    expect((await row("pay")).segment).toMatchObject({ client: true, paying: true, trial: false, renewalDays: null, silentDays: null, price: old ? 299_000 : monthlyPrice(0) });
    expect((await row("renew")).segment).toMatchObject({ paying: true, renewalDays: 11, silentDays: null, price: old ? 599_000 : monthlyPrice(0) });
    expect((await row("trial")).segment).toMatchObject({ paying: false, trial: true, trialLive: true, silentDays: 6, active7: true });
    for (const k of ["suspended", "sandbox"]) {
      expect((await row(k)).segment, k).toMatchObject({ client: false, paying: false, silentDays: null, renewalDays: null, price: 0 });
    }
    expect((await list()).some(r => r.slug === "system"), "системная в списке").toBe(false);
  });

  it("как панель владельца: те же платящие, молчащие, продления и активные", async () => {
    const { tenantRouter } = await import("../../tenant-router");
    const panel = await tenantRouter.createCaller(ctxFor(db, systemId, superId, "superadmin")).ownerPanel();
    const rows = await list();
    const idsOf = (xs: Array<{ tenantId?: number; id?: number }>) => xs.map(x => x.tenantId ?? x.id).sort();
    expect(idsOf(rows.filter(r => r.segment.paying))).toEqual(idsOf(panel.paying.list));
    expect(idsOf(rows.filter(r => r.segment.silentDays !== null))).toEqual(idsOf(panel.silent));
    expect(idsOf(rows.filter(r => r.segment.renewalDays !== null))).toEqual(idsOf(panel.renewals));
    expect(rows.filter(r => r.segment.active7).length).toBe(panel.activeLast7);
    expect(rows.filter(r => r.segment.paying).reduce((s, r) => s + r.segment.price, 0)).toBe(panel.paying.mrr);
  });

  it("только суперадмину: директор получает отказ", async () => {
    const { tenantRouter } = await import("../../tenant-router");
    await expect(tenantRouter.createCaller(ctxFor(db, ids.pay, 1, "ceo")).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

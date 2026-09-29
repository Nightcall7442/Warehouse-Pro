import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { cache } from "../../lib/cache";
import { OWNER_PANEL_CACHE_KEY } from "../../services/owner-panel";

/**
 * Панель владельца «Кто платит и кто уходит» и вечерняя сводка — на
 * настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У суперадмина — «организаций», «заказов» и «выручка» по всей платформе, и ни
 * одного ответа: сколько денег в месяц приносят клиенты, кто из платящих
 * замолчал, у кого кончается оплаченный срок, где застревают пробные.
 * Телефон владельца — только в карточке организации. Вечерняя сводка не
 * говорила, кому звонить.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Через настоящую ручку tenant.ownerPanel (superAdminQuery) на наборе
 * организаций во всех состояниях: платит; бессрочная оплаченная; продление
 * через 10 и через 3 дня; истёкшая; перешедшая с пробного; пробные на пяти
 * разных этапах (в том числе с заказом оператора, а не агента, и с истёкшим
 * пробным); молчащие платящая и пробная; и три, которых в панели быть не
 * должно, хотя по подписке они «платят» и молчат: системная, песочница
 * интегратора, приостановленная. Проверяются числа и списки целиком, контакт
 * из карточки или директора, копия на минуту, отказ не суперадмину. Сводка —
 * через runAdminDigest: две новые строки.
 *
 * Нарочная поломка (проверено 29.09.2026): убрать `eq(tenants.isSandbox,
 * false)` — песочница становится платящей и молчащей, падают «числа», «копия»
 * и «сводка»; считать бессрочную неоплаченной — «числа», «контакт», «копия»;
 * считать заказом агента любой agent_id без роли — «пробные по этапам»;
 * убрать вход из активности — «числа» и «сводка»; убрать копию — «копия на
 * минуту»; выкинуть строку «Молчат» из шаблона сводки — «сводка» (и
 * admin-telegram.test.ts).
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
const out = vi.hoisted(() => ({ admin: [] as string[] }));
vi.mock("../../lib/telegram", async (orig) => ({
  ...(await orig<object>()),
  notifyAdmin: vi.fn(async (text: string) => { out.admin.push(text); return true; }),
}));

const DAY = 86_400_000;
const HOUR = 3_600_000;
/*
  Время — в целых секундах, с отступом в прошлое. Столбцы хранятся без долей
  секунды, и MySQL долю ОКРУГЛЯЕТ вверх: «8 дней назад» в 12:00:00.6 ложилось
  как 12:00:01 — на 0,4 с меньше восьми суток, и в части прогонов панель
  честно показывала «молчит 7 дней» (CI #141, 29.09.2026). То же с «через
  N дней» у продления: ceil давал N+1.
*/
const wholeSec = (t: number) => new Date(Math.floor(t / 1000) * 1000);
const ago = (ms: number) => wholeSec(Date.now() - ms);
const ahead = (ms: number) => wholeSec(Date.now() + ms);

describe.skipIf(!hasRealDb)("панель владельца на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let superId = 0;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  /* ── Стенд ─────────────────────────────────────────────────────────────── */

  type Sub = { plan: "trial" | "basic" | "pro" | "exclusive"; status: "trialing" | "active"; trialEndsAt?: Date | null; currentPeriodEnds?: Date | null };
  async function org(o: {
    name: string; slug?: string; status?: "active" | "suspended"; isSandbox?: boolean;
    createdAt: Date; trialEndsAt?: Date | null; ownerPhone?: string | null; ownerEmail?: string | null;
    signupSource?: string | null; sub: Sub;
    ceo: { lastSignInAt: Date; verified?: boolean; phone?: string | null; email?: string };
  }): Promise<{ id: number; ceoId: number }> {
    n++;
    const [t] = await d().insert(schema.tenants).values({
      slug: o.slug ?? `org-${n}`, name: o.name, plan: o.sub.plan, status: o.status ?? "active",
      isSandbox: o.isSandbox ?? false, createdAt: o.createdAt, trialEndsAt: o.trialEndsAt ?? null,
      ownerPhone: o.ownerPhone ?? null, ownerEmail: o.ownerEmail ?? null, signupSource: o.signupSource ?? null,
    });
    const id = Number(t.insertId);
    const [u] = await d().insert(schema.users).values({
      tenantId: id, name: `Директор ${n}`, email: o.ceo.email ?? `ceo${n}@test.uz`, passwordHash: "x",
      role: "ceo", phone: o.ceo.phone ?? null, lastSignInAt: o.ceo.lastSignInAt,
      emailVerifiedAt: o.ceo.verified === false ? null : o.createdAt, createdAt: o.createdAt,
    });
    await d().insert(schema.subscriptions).values({
      id: randomUUID(), tenantId: id, plan: o.sub.plan, status: o.sub.status,
      trialEndsAt: o.sub.trialEndsAt ?? null, currentPeriodEnds: o.sub.currentPeriodEnds ?? null,
    });
    return { id, ceoId: Number(u.insertId) };
  }
  const person = async (tenantId: number, role: "agent" | "operator", lastSignInAt: Date) => {
    n++;
    const [u] = await d().insert(schema.users).values({
      tenantId, name: `${role} ${n}`, email: `${role}${n}@test.uz`, passwordHash: "x", role, lastSignInAt,
    });
    return Number(u.insertId);
  };
  const product = (tenantId: number) =>
    d().insert(schema.products).values({ tenantId, code: `P-${++n}`, name: "Сок", unitPrice: "100.00" });
  const order = async (tenantId: number, agentId: number, createdAt: Date, status: "new" | "delivered" = "new") => {
    const [s] = await d().insert(schema.shops).values({ tenantId, name: `Магазин ${++n}` });
    await d().insert(schema.orders).values({
      tenantId, orderNumber: `ORD-${n}`, shopId: Number(s.insertId), agentId, status, createdAt,
    });
  };

  beforeEach(async () => {
    await truncateAll();
    cache.invalidate(OWNER_PANEL_CACHE_KEY);
    out.admin.length = 0;
    n = 0;

    // Системная: дом суперадмина. «Платит» бессрочно и работает — но не клиент.
    const sys = await org({
      name: "Система", slug: "system", createdAt: ago(400 * DAY),
      sub: { plan: "exclusive", status: "active" }, ceo: { lastSignInAt: ago(HOUR) },
    });
    systemId = sys.id;
    superId = await (async () => {
      const [u] = await d().insert(schema.users).values({
        tenantId: sys.id, name: "Суперадмин", email: "root@system.local", passwordHash: "x", role: "superadmin", lastSignInAt: new Date(),
      });
      return Number(u.insertId);
    })();
    await order(sys.id, superId, ago(HOUR));

    // Платит, работает.
    const pay = await org({
      name: "Платит Базовый", createdAt: ago(60 * DAY), ownerPhone: "+998901110001", ownerEmail: "pay@test.uz",
      sub: { plan: "basic", status: "active", currentPeriodEnds: ahead(40 * DAY) }, ceo: { lastSignInAt: ago(3 * DAY) },
    });
    await order(pay.id, pay.ceoId, ago(DAY));

    // Бессрочная оплаченная, контакта в карточке нет — берётся директор.
    await org({
      name: "Бессрочный Про", createdAt: ago(90 * DAY),
      sub: { plan: "pro", status: "active", currentPeriodEnds: null },
      ceo: { lastSignInAt: ago(2 * DAY), phone: "+998 91 000 00 01", email: "ceo@forever.uz" },
    });

    // Продление через 10 дней, работает.
    const renew = await org({
      name: "Продление Эксклюзив", createdAt: ago(80 * DAY), ownerPhone: "+998901110003",
      sub: { plan: "exclusive", status: "active", currentPeriodEnds: ahead(10 * DAY - HOUR) }, ceo: { lastSignInAt: ago(DAY) },
    });
    await order(renew.id, renew.ceoId, ago(2 * HOUR));

    // Продление через 3 дня и шестой день тишины.
    await org({
      name: "Продление Скоро", createdAt: ago(50 * DAY), ownerPhone: "+998901110004",
      sub: { plan: "pro", status: "active", currentPeriodEnds: ahead(3 * DAY - HOUR) }, ceo: { lastSignInAt: ago(6 * DAY + 2 * HOUR) },
    });

    // Платит, но молчит седьмой день: последний вход 7 дн., последний заказ 9 дн.
    const quiet = await org({
      name: "Молчит Про", createdAt: ago(70 * DAY), ownerPhone: "+998901110005",
      sub: { plan: "pro", status: "active", currentPeriodEnds: ahead(60 * DAY) }, ceo: { lastSignInAt: ago(7 * DAY + 2 * HOUR) },
    });
    await order(quiet.id, quiet.ceoId, ago(9 * DAY));

    // Оплаченный срок кончился два дня назад — не платит, не молчащая «платящая».
    await org({
      name: "Истёкшая", createdAt: ago(100 * DAY), ownerPhone: "+998901110006",
      sub: { plan: "basic", status: "active", currentPeriodEnds: ago(2 * DAY) }, ceo: { lastSignInAt: ago(20 * DAY) },
    });

    // Перешла с пробного на платный: в воронке — «перешёл», в списке пробных её нет.
    const conv = await org({
      name: "Перешёл", createdAt: ago(24 * DAY), trialEndsAt: ago(10 * DAY), ownerPhone: "+998901110007",
      sub: { plan: "basic", status: "active", trialEndsAt: ago(10 * DAY), currentPeriodEnds: ahead(20 * DAY) },
      ceo: { lastSignInAt: ago(DAY) },
    });
    await product(conv.id);

    // ── Пробные на разных этапах ──
    const trial = (days: number) => ({ plan: "trial" as const, status: "trialing" as const, trialEndsAt: ahead(days * DAY) });

    // Только что зарегистрировался, почту не подтвердил.
    await org({
      name: "Пробный Новый", createdAt: ago(DAY), trialEndsAt: ahead(13 * DAY), ownerPhone: "+998901110008",
      signupSource: "answer=instagram; utm_source=ig_sept", sub: trial(13), ceo: { lastSignInAt: ago(DAY), verified: false },
    });

    // Завёл товары и замолчал на восемь дней.
    const goods = await org({
      name: "Пробный Товары", createdAt: ago(9 * DAY), trialEndsAt: ahead(5 * DAY), ownerPhone: "+998901110009",
      sub: trial(5), ceo: { lastSignInAt: ago(8 * DAY) },
    });
    await product(goods.id);

    // Дошёл до доставки: агент, его заказ, доставлен.
    const deliv = await org({
      name: "Пробный Доставка", createdAt: ago(6 * DAY), trialEndsAt: ahead(8 * DAY), ownerPhone: "+998901110010",
      sub: trial(8), ceo: { lastSignInAt: ago(5 * DAY) },
    });
    await product(deliv.id);
    const agent = await person(deliv.id, "agent", ago(3 * DAY));
    await order(deliv.id, agent, ago(2 * DAY), "delivered");

    // Агент заведён, но заказ оформил оператор — «заказа агентом» нет.
    const op = await org({
      name: "Пробный Оператор", createdAt: ago(12 * DAY), trialEndsAt: ahead(2 * DAY), ownerPhone: "+998901110011",
      sub: trial(2), ceo: { lastSignInAt: ago(10 * DAY) },
    });
    await product(op.id);
    await person(op.id, "agent", ago(11 * DAY));
    const operator = await person(op.id, "operator", ago(10 * DAY));
    await order(op.id, operator, ago(4 * DAY));

    // Пробный кончился три дня назад.
    await org({
      name: "Пробный Истёк", createdAt: ago(17 * DAY), trialEndsAt: ago(3 * DAY), ownerPhone: "+998901110012",
      sub: { plan: "trial", status: "trialing", trialEndsAt: ago(3 * DAY) }, ceo: { lastSignInAt: ago(3 * DAY) },
    });

    // ── Не клиенты, хотя по подписке «платят» и молчат ──
    await org({
      name: "Песочница — Бекдринкс", isSandbox: true, createdAt: ago(30 * DAY),
      sub: { plan: "exclusive", status: "active", currentPeriodEnds: ahead(300 * DAY) }, ceo: { lastSignInAt: ago(30 * DAY) },
    });
    await org({
      name: "Приостановлена", status: "suspended", createdAt: ago(40 * DAY), ownerPhone: "+998901110013",
      sub: { plan: "basic", status: "active", currentPeriodEnds: ahead(5 * DAY) }, ceo: { lastSignInAt: ago(15 * DAY) },
    });
  });

  const panel = async () => {
    const { tenantRouter } = await import("../../tenant-router");
    return tenantRouter.createCaller(ctxFor(db, systemId, superId, "superadmin")).ownerPanel();
  };

  it("числа и списки: платят, MRR, активные, молчат, продление", async () => {
    const p = await panel();

    expect(p.clients, "клиентов — без системной, песочницы и приостановленной").toBe(12);
    expect(p.paying.count).toBe(6);
    expect(p.paying.list.map(r => r.name).sort()).toEqual(
      ["Бессрочный Про", "Молчит Про", "Перешёл", "Платит Базовый", "Продление Скоро", "Продление Эксклюзив"].sort(),
    );
    // Прайс: Exclusive 1 299 000 + три Pro по 599 000 + два Basic по 299 000.
    expect(p.paying.mrr).toBe(1_299_000 + 3 * 599_000 + 2 * 299_000);
    expect(p.paying.list.find(r => r.name === "Бессрочный Про")?.periodEnds).toBeNull();

    expect(p.activeLast7).toBe(9);

    expect(p.silent.map(r => [r.name, r.kind, r.silentDays])).toEqual([
      ["Молчит Про", "paying", 7],
      ["Продление Скоро", "paying", 6],
      ["Пробный Товары", "trial", 8],
    ]);
    expect(p.silent[0].phone).toBe("+998901110005");

    expect(p.renewals.map(r => [r.name, r.daysLeft, r.price])).toEqual([
      ["Продление Скоро", 3, 599_000],
      ["Продление Эксклюзив", 10, 1_299_000],
    ]);
  });

  it("контакт — из карточки, а без неё — директора", async () => {
    const p = await panel();
    const forever = p.paying.list.find(r => r.name === "Бессрочный Про")!;
    expect(forever).toMatchObject({ phone: "+998 91 000 00 01", email: "ceo@forever.uz" });
    const pay = p.paying.list.find(r => r.name === "Платит Базовый")!;
    expect(pay).toMatchObject({ phone: "+998901110001", email: "pay@test.uz" });
  });

  it("пробные по этапам: счётчики и текущий этап каждого", async () => {
    const p = await panel();

    expect(Object.fromEntries(p.funnel.stages.map(s => [s.key, s.reached]))).toEqual({
      registered: 6, emailVerified: 5, products: 4, agent: 2, agentOrder: 1, delivered: 1, paid: 1,
    });
    expect(p.funnel.trials.map(r => [r.name, r.stage, r.trialExpired])).toEqual([
      ["Пробный Новый", "registered", false],
      ["Пробный Доставка", "delivered", false],
      ["Пробный Товары", "products", false],
      ["Пробный Оператор", "agent", false],
      ["Пробный Истёк", "emailVerified", true],
    ]);
    const op = p.funnel.trials.find(r => r.name === "Пробный Оператор")!;
    expect(op.done).toEqual(["registered", "emailVerified", "products", "agent"]);
    const fresh = p.funnel.trials.find(r => r.name === "Пробный Новый")!;
    expect(fresh).toMatchObject({ phone: "+998901110008", source: "answer=instagram; utm_source=ig_sept" });
  });

  it("копия на минуту: новая организация видна после сброса копии, а не сразу", async () => {
    expect((await panel()).paying.count).toBe(6);
    await org({
      name: "Новый платящий", createdAt: ago(DAY),
      sub: { plan: "basic", status: "active", currentPeriodEnds: ahead(30 * DAY) }, ceo: { lastSignInAt: ago(HOUR) },
    });
    expect((await panel()).paying.count, "ответ собирается заново на каждый запрос").toBe(6);
    cache.invalidate(OWNER_PANEL_CACHE_KEY);
    expect((await panel()).paying.count).toBe(7);
  });

  it("только суперадмину: директор и оператор получают отказ", async () => {
    const { tenantRouter } = await import("../../tenant-router");
    for (const role of ["ceo", "operator"]) {
      await expect(tenantRouter.createCaller(ctxFor(db, systemId, superId, role)).ownerPanel())
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("вечерняя сводка: продление на этой неделе по названиям и число молчащих", async () => {
    const { runAdminDigest } = await import("../../cron/admin-digest");
    await runAdminDigest();

    expect(out.admin).toHaveLength(1);
    const msg = out.admin[0];
    // Эксклюзив продлевается через 10 дней — это не эта неделя.
    expect(msg).toContain("🔁 Продление на этой неделе: 1 (Продление Скоро)");
    expect(msg).toContain("🤫 Молчат 5+ дней: 3");
  });
});

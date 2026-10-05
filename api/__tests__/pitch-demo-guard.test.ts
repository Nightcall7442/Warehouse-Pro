import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Демо-организация жюри (/demo): что закрыто демо-сессии и что нет.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Не было ничего: страница /demo — новая. Но вход по кнопке без пароля даёт
 * сессию ОДНОГО пользователя на всё жюри. Без запретов первый же любопытный
 * сменил бы этому пользователю пароль или включил 2FA — и остальные не
 * вошли бы; выпустил бы ключ API, пригласил людей, отвязал Telegram.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Признак демо — только при ОБОИХ условиях: номер из PITCH_DEMO_TENANT_ID и
 *    пометка песочницы в базе. Переменная не задана, мусор, номер живой
 *    организации — не демо.
 * 2. Каждая закрытая мутация отказывает демо-сессии ИМЕННО демо-отказом и
 *    НЕ отказывает им обычной сессии (та упирается в следующую калитку —
 *    подписку, — значит демо-страж её пропустил). Вызов идёт через настоящий
 *    роутер, а не через функцию-предикат.
 * 3. Рабочие мутации (заказ, оплата, визит, доставка) демо открыты.
 * 4. Список не гниёт: каждое имя в нём — существующая мутация роутера, а
 *    любая мутация со словами «пароль», «логин», «почта», «ключ», «2FA»,
 *    «приглашение», «Telegram», «1С», «оплата» — закрыта. Новая
 *    user.changeEmail без строчки в списке уронит этот тест.
 */

vi.mock("../lib/feature-gating", async (orig) => ({
  ...(await orig<object>()),
  // Следующая калитка после демо-стража — подписка. «Нет подписки» здесь
  // значит: демо-страж запрос пропустил, и отказал уже кто-то другой.
  hasSubscriptionAccess: vi.fn(async () => false),
}));
vi.mock("../queries/connection", () => ({
  getDb: () => { throw new Error("в этом наборе базы нет"); },
  getPool: () => null,
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

import { appRouter } from "../router";
import { ErrorMessages } from "@contracts/constants";
import {
  DEMO_BLOCKED_MUTATIONS, DEMO_BLOCKED_NAMESPACES, isBlockedForDemo, isDemoTenant, pitchDemoTenantId,
} from "../services/pitch-demo";

type Proc = { _def: { type: string } };
const procedures = (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;
const mutations = Object.keys(procedures).filter(p => procedures[p]._def.type === "mutation");

const DEMO_ID = 4242;
const SANDBOX = { id: DEMO_ID, isSandbox: true };

let uid = 10_000;
function ctxFor(tenant: { id: number; isSandbox: boolean }, role = "ceo") {
  const id = ++uid;
  return {
    req: new Request("http://localhost/api/trpc/x", { method: "POST" }),
    resHeaders: new Headers(),
    db: {} as never,
    user: { id, tenantId: tenant.id, role, status: "active", name: "t", email: `u${id}@t.local`, tokenVersion: 0 } as never,
    tenant: { id: tenant.id, isSandbox: tenant.isSandbox, status: "active", plan: "exclusive", slug: "s", name: "n" } as never,
  };
}

/** Текст ошибки вызова через настоящий роутер; "ok" — если прошло. */
async function outcome(ctx: ReturnType<typeof ctxFor>, path: string): Promise<string> {
  const caller = appRouter.createCaller(ctx as never) as unknown as Record<string, unknown>;
  const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], caller) as (i: unknown) => Promise<unknown>;
  try { await fn({}); return "ok"; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

const blockedPaths = mutations.filter(isBlockedForDemo);

/** Мутация без сессии (вход по ссылке-приглашению и т. п.): демо-сессия к ней отношения не имеет. */
async function isPublic(path: string): Promise<boolean> {
  const anon = { req: new Request("http://localhost/api/trpc/x", { method: "POST" }), resHeaders: new Headers(), db: {} as never };
  return (await outcome(anon as never, path)) !== ErrorMessages.unauthenticated;
}

beforeEach(() => { process.env.PITCH_DEMO_TENANT_ID = String(DEMO_ID); });
afterEach(() => { delete process.env.PITCH_DEMO_TENANT_ID; });

describe("признак демо-организации", () => {
  it("переменная не задана — демо нет ни у кого, даже у песочницы", () => {
    delete process.env.PITCH_DEMO_TENANT_ID;
    expect(pitchDemoTenantId()).toBeNull();
    expect(isDemoTenant(SANDBOX)).toBe(false);
  });

  it("мусор в переменной — выключено, а не «организация 0» или NaN", () => {
    for (const v of ["", " ", "abc", "-4", "0", "4.2", "4242abc", "12345678901"]) {
      process.env.PITCH_DEMO_TENANT_ID = v;
      expect(pitchDemoTenantId(), v).toBeNull();
    }
  });

  it("номер совпал, но организация не песочница — не демо (опечатка не делает живого арендатора демо)", () => {
    expect(isDemoTenant({ id: DEMO_ID, isSandbox: false })).toBe(false);
  });

  it("песочница, но не та, что в переменной — не демо", () => {
    expect(isDemoTenant({ id: DEMO_ID + 1, isSandbox: true })).toBe(false);
  });

  it("номер совпал и песочница — демо", () => {
    expect(isDemoTenant(SANDBOX)).toBe(true);
  });
});

describe("список закрытого не гниёт", () => {
  it("каждое имя в списке — существующая мутация", () => {
    const missing = DEMO_BLOCKED_MUTATIONS.filter(p => procedures[p]?._def.type !== "mutation");
    expect(missing).toEqual([]);
  });

  it("каждое закрытое пространство существует и в нём есть мутации", () => {
    for (const ns of DEMO_BLOCKED_NAMESPACES) {
      expect(mutations.some(p => p.startsWith(`${ns}.`)), ns).toBe(true);
    }
  });

  it("любая мутация про пароль, логин, почту, ключи, 2FA, приглашения, Telegram, 1С и оплату — закрыта", () => {
    // auth.* — публичные потоки без сессии (сброс пароля по письму), демо-сессия их не касается.
    const risky = /password|totp|login|email|apikey|invite|telegram|onec|billing|stripe|offboard|logoutall|credential|deactivate|operatoraccess/i;
    const open = mutations.filter(p => !p.startsWith("auth.") && risky.test(p) && !isBlockedForDemo(p));
    expect(open).toEqual([]);
  });

  it("закрыто именно то, о чём просил владелец", () => {
    for (const p of [
      "user.changePassword", "user.changeMyLogin", "user.totpSetup", "user.totpEnable", "user.totpDisable",
      "user.update", "user.deactivate", "user.resetPassword", "tenant.inviteUser", "invite.send",
      "apiKey.create", "apiKey.revoke", "apiKey.setStatus",
      "billing.requestUpgrade", "stripe.createCheckoutSession",
      "onec.wizard.saveConfig", "telegram.saveChatId", "telegram.setUserChatId",
      "tenant.offboard", "settings.update", "access.setOperatorAccess",
    ]) expect(isBlockedForDemo(p), p).toBe(true);
  });
});

describe("демо-страж в настоящем роутере", () => {
  it("набор закрытых мутаций не пуст", () => {
    expect(blockedPaths.length).toBeGreaterThan(40);
  });

  it("публичных среди закрытых — только приём приглашения (его токен демо выпустить не может: invite.send закрыт)", async () => {
    const pub: string[] = [];
    for (const p of blockedPaths) if (await isPublic(p)) pub.push(p);
    expect(pub).toEqual(["invite.accept"]);
  });

  it("демо-сессия: каждая закрытая мутация — демо-отказ", async () => {
    const wrong: string[] = [];
    for (const p of blockedPaths) {
      if (p === "invite.accept") continue;
      const msg = await outcome(ctxFor(SANDBOX), p);
      if (msg !== ErrorMessages.demoBlocked) wrong.push(`${p}: ${msg}`);
    }
    expect(wrong).toEqual([]);
  });

  it("та же мутация у обычной организации — демо-страж пропускает", async () => {
    const wrong: string[] = [];
    for (const p of blockedPaths) {
      const msg = await outcome(ctxFor({ id: DEMO_ID + 7, isSandbox: false }), p);
      if (msg === ErrorMessages.demoBlocked) wrong.push(p);
    }
    expect(wrong).toEqual([]);
  });

  it("у той же песочницы при выключенном демо — пропускает", async () => {
    delete process.env.PITCH_DEMO_TENANT_ID;
    for (const p of ["user.changePassword", "apiKey.create", "settings.update"]) {
      expect(await outcome(ctxFor(SANDBOX), p)).not.toBe(ErrorMessages.demoBlocked);
    }
  });

  it("у организации с номером демо, но без пометки песочницы — пропускает", async () => {
    for (const p of ["user.changePassword", "apiKey.create", "settings.update"]) {
      expect(await outcome(ctxFor({ id: DEMO_ID, isSandbox: false }), p)).not.toBe(ErrorMessages.demoBlocked);
    }
  });

  it("рабочие мутации демо открыты — жюри пробует продукт", async () => {
    const work = [
      "order.create", "order.recordPartialPayment", "order.close", "agent.createPlan", "agent.updatePlanStatus",
      "courier.markDelivered", "shop.create", "shop.addPayment", "merchandiser.submitReport",
      "returns.create", "arrival.create", "priceList.update", "notification.markAllRead", "upload.file",
    ];
    for (const p of work) {
      expect(procedures[p]?._def.type, p).toBe("mutation");
      expect(isBlockedForDemo(p), p).toBe(false);
      expect(await outcome(ctxFor(SANDBOX), p), p).not.toBe(ErrorMessages.demoBlocked);
    }
  });

  it("чтение в закрытых пространствах открыто: демо видит экран ключей, но не выпускает ключ", async () => {
    const reads = Object.keys(procedures).filter(p => procedures[p]._def.type === "query" && DEMO_BLOCKED_NAMESPACES.some(ns => p.startsWith(`${ns}.`)));
    expect(reads.length).toBeGreaterThan(0);
    for (const p of reads.slice(0, 10)) {
      expect(await outcome(ctxFor(SANDBOX), p), p).not.toBe(ErrorMessages.demoBlocked);
    }
  });
});

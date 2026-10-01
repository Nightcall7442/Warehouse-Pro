import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { Session } from "@contracts/constants";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Суперадмин меняет СВОЙ логин — настоящим путём: /api/login за кукой,
 * POST /api/trpc/user.changeMyLogin с ней, auth.me и снова /api/login.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Логин суперадмина (superadmin@system.local из засева) сменить было нельзя
 * нигде: сотруднику организации логин меняет директор или суперадмин
 * (tenant.changeUserLogin), а над суперадмином никого нет. Владелец,
 * 01.10.2026: «логин и пароль чтобы можно было изменить».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - смена по паролю (второй фактор выключен): логин новый, другая сессия
 *     погасла, текущая получила новую куку и жива, вход по новому логину
 *     проходит, по старому — нет, след в журнале, сообщение владельцу;
 *   - второй фактор включён: без кода и с неверным кодом — отказ и логин
 *     прежний; с верным — сменён;
 *   - неверный пароль — отказ, логин и версия ключа прежние;
 *   - логин, занятый кем угодно в любой организации (и в другом регистре), —
 *     отказ: вход ищет по почте во всех организациях сразу;
 *   - директор и оператор ручкой не владеют — отказ, их логин прежний;
 *   - шестая попытка за четверть часа — отказ счётчика «changeMyLogin».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
const tg = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("../../telegram-router", async (orig) => ({
  ...(await orig<object>()),
  notifyAdmin: vi.fn(async (m: string) => { tg.sent.push(m); return true; }),
}));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  const over: Record<string, unknown> = { appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789" };
  return { env: new Proxy(real.env, { get: (o, k) => (k in over ? over[k as string] : o[k as string]) }) };
});

const PASSWORD = "тестовый-пароль-1";

describe.skipIf(!hasRealDb)("суперадмин меняет свой логин", () => {
  let db: ServiceDb;
  let s: Seeded;
  let hash: string;
  let superId: number;
  let ceoId: number;
  let operatorId: number;

  beforeAll(async () => {
    db = await connectRealDb(); current = db;
    // Один хеш на всех: 600 000 итераций на каждого — лишние секунды, а вход
    // всё равно ищет человека по почте, не по хешу.
    hash = await (await import("../../auth/password")).hashPassword(PASSWORD);
  }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    tg.sent.length = 0;
    const { _resetKeyForTests } = await import("../../lib/secret-box");
    _resetKeyForTests();
    const [sa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Владелец платформы", email: "superadmin@system.local", passwordHash: hash, role: "superadmin" });
    superId = Number(sa.insertId);
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@velora.uz", passwordHash: hash, role: "ceo" });
    ceoId = Number(ceo.insertId);
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@velora.uz", passwordHash: hash, role: "operator" });
    operatorId = Number(op.insertId);
    // После очистки номера строк начинаются заново, а вход держит прочитанного
    // человека десять секунд (auth/index.ts): без сброса новый суперадмин
    // получил бы из памяти прошлого, с его версией ключа.
    const { invalidateAuthUser, invalidateAuthTenant } = await import("../../auth");
    for (const id of [superId, ceoId, operatorId]) invalidateAuthUser(id);
    for (const id of [s.tenantId, s.otherTenantId]) invalidateAuthTenant(id);
    const { checkRateLimit } = await import("../../lib/rate-limit");
    vi.mocked(checkRateLimit).mockReset().mockImplementation(async () => true);
  });

  const app = async () => (await import("../../boot")).default;
  const cookieOf = (setCookie: string | null) => {
    const pair = (setCookie ?? "").split(";")[0];
    return pair.startsWith(`${Session.cookieName}=`) && pair.length > Session.cookieName.length + 1 ? pair : "";
  };
  const login = async (email: string, extra: Record<string, unknown> = {}) => {
    const res = await (await app()).request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, ...extra }),
    });
    return { status: res.status, body: await res.json() as any, cookie: cookieOf(res.headers.get("set-cookie")) };
  };
  const change = async (cookie: string, input: Record<string, unknown>) => {
    const res = await (await app()).request("/api/trpc/user.changeMyLogin", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ json: input }),
    });
    const body = await res.json() as any;
    return { status: res.status, body, message: body?.error?.json?.message as string | undefined, cookie: cookieOf(res.headers.get("set-cookie")) };
  };
  const me = async (cookie: string) => {
    const res = await (await app()).request("/api/trpc/auth.me", { headers: { Cookie: cookie } });
    const body = await res.json() as any;
    return { status: res.status, email: body?.result?.data?.json?.email as string | undefined };
  };
  const row = async (id: number) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];
  const enableTotp = async () => {
    const { generateTotpSecret } = await import("../../lib/totp");
    const { seal } = await import("../../lib/secret-box");
    const secret = generateTotpSecret();
    await db.update(schema.users).set({ totpSecret: seal(secret), totpEnabledAt: new Date() }).where(eq(schema.users.id, superId));
    const { invalidateAuthUser } = await import("../../auth");
    invalidateAuthUser(superId);
    return secret;
  };

  it("по паролю: логин сменён, чужая сессия погасла, своя жива, вход — только по новому, след и сообщение", async () => {
    const here = await login("superadmin@system.local");
    const there = await login("superadmin@system.local");
    expect(here.status).toBe(200);
    expect(here.cookie).not.toBe("");
    expect(there.cookie).not.toBe(here.cookie);
    const tvBefore = (await row(superId)).tokenVersion ?? 0;

    const r = await change(here.cookie, { email: "  Owner@Warehouse.UZ ", currentPassword: PASSWORD });
    expect(r.status, r.message).toBe(200);
    expect(r.body.result.data.json).toEqual({ email: "owner@warehouse.uz" });
    expect(r.cookie, "текущей вкладке не выдали новую куку — она вылетит следом за остальными").not.toBe("");

    const u = await row(superId);
    expect(u.email).toBe("owner@warehouse.uz");
    expect(u.tokenVersion).toBe(tvBefore + 1);
    expect(u.passwordHash).toBe(hash);

    expect(await me(r.cookie)).toEqual({ status: 200, email: "owner@warehouse.uz" });
    expect((await me(there.cookie)).status, "другое устройство осталось в системе").not.toBe(200);
    expect((await me(here.cookie)).status, "прежняя кука этой вкладки должна замениться новой, а не жить рядом").not.toBe(200);

    expect((await login("owner@warehouse.uz")).status).toBe(200);
    expect((await login("superadmin@system.local")).status).toBe(401);

    expect(await countOf("audit_log", `action = 'user.login_changed' AND target_id = ${superId} AND actor_id = ${superId}`)).toBe(1);
    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "user.login_changed"));
    expect(entry.meta).toMatchObject({ oldEmail: "superadmin@system.local", newEmail: "owner@warehouse.uz", by: "self", withTotp: false });

    await vi.waitFor(() => expect(tg.sent).toHaveLength(1));
    expect(tg.sent[0]).toContain("Сменён логин суперадмина");
    expect(tg.sent[0]).toContain("superadmin@system.local");
    expect(tg.sent[0]).toContain("owner@warehouse.uz");
  }, 60_000);

  it("второй фактор включён: без кода и с чужим кодом — отказ и логин прежний; с кодом — сменён", async () => {
    const here = await login("superadmin@system.local");
    const secret = await enableTotp();
    const { totpCode } = await import("../../lib/totp");

    const noCode = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: PASSWORD });
    expect(noCode.status).toBe(400);
    expect(noCode.message).toMatch(/код из приложения/i);

    const now = Date.now();
    const valid = new Set([-1, 0, 1].map(k => totpCode(secret, now + k * 30_000)));
    const wrong = ["000000", "111111", "222222", "333333"].find(c => !valid.has(c))!;
    const badCode = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: PASSWORD, code: wrong });
    expect(badCode.status).toBe(400);
    expect(badCode.message).toMatch(/Неверный код/);
    expect((await row(superId)).email).toBe("superadmin@system.local");

    // Код верный, а пароль нет — пароль проверяется и при включённом коде.
    const badPw = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: "не-тот-пароль", code: totpCode(secret) });
    expect(badPw.status).toBe(400);
    expect((await row(superId)).email).toBe("superadmin@system.local");

    const ok = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: PASSWORD, code: totpCode(secret) });
    expect(ok.status, ok.message).toBe(200);
    expect((await row(superId)).email).toBe("owner@warehouse.uz");
    expect((await me(ok.cookie)).email).toBe("owner@warehouse.uz");
    // Пароль к новому логину подходит — вход дошёл до вопроса о коде.
    expect((await login("owner@warehouse.uz")).body.code).toBe("TOTP_REQUIRED");
    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "user.login_changed"));
    expect(entry.meta).toMatchObject({ withTotp: true });
  }, 60_000);

  it("неверный пароль — отказ; логин, версия ключа и сессия прежние, следа нет", async () => {
    const here = await login("superadmin@system.local");
    const before = await row(superId);
    const r = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: "не-тот-пароль" });
    expect(r.status).toBe(400);
    expect(r.message).toBe("Неверный текущий пароль");
    expect(r.cookie).toBe("");
    const after = await row(superId);
    expect(after.email).toBe("superadmin@system.local");
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expect((await me(here.cookie)).status).toBe(200);
    expect(await countOf("audit_log", "action = 'user.login_changed'")).toBe(0);
    expect(tg.sent).toHaveLength(0);
  }, 60_000);

  it("логин, занятый кем угодно в любой организации (в любом регистре), — отказ", async () => {
    const here = await login("superadmin@system.local");
    for (const email of ["agent@test.local", "CEO@Velora.uz"]) {
      const r = await change(here.cookie, { email, currentPassword: PASSWORD });
      expect(r.status, email).toBe(409);
      expect(r.message).toMatch(/занят/);
    }
    expect((await row(superId)).email).toBe("superadmin@system.local");
    // Свой же логин — не «смена»: отказ без следа.
    const same = await change(here.cookie, { email: "SuperAdmin@System.local", currentPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(await countOf("audit_log", "action = 'user.login_changed'")).toBe(0);
  }, 60_000);

  it("директор и оператор ручкой не владеют — отказ, их логин прежний", async () => {
    for (const [email, id] of [["ceo@velora.uz", ceoId], ["op@velora.uz", operatorId]] as const) {
      const who = await login(email);
      expect(who.status, email).toBe(200);
      const r = await change(who.cookie, { email: `new-${id}@velora.uz`, currentPassword: PASSWORD });
      expect(r.status, email).toBe(403);
      expect((await row(id)).email).toBe(email);
      expect((await me(who.cookie)).status, "отказ не должен гасить их сессию").toBe(200);
    }
    expect(await countOf("audit_log", "action = 'user.login_changed'")).toBe(0);
  }, 60_000);

  it("счётчик попыток — свой, «changeMyLogin», пять на четверть часа; исчерпан — отказ до проверки пароля", async () => {
    const here = await login("superadmin@system.local");
    const { checkRateLimit } = await import("../../lib/rate-limit");
    const seen: Array<{ namespace?: string; limit?: number; windowMs?: number }> = [];
    vi.mocked(checkRateLimit).mockImplementation((async (_subject: string, opts?: { namespace?: string; limit?: number; windowMs?: number }) => {
      if (opts) seen.push(opts);
      return opts?.namespace !== "changeMyLogin";
    }) as never);
    const r = await change(here.cookie, { email: "owner@warehouse.uz", currentPassword: PASSWORD });
    expect(r.status).toBe(429);
    expect(seen).toContainEqual(expect.objectContaining({ namespace: "changeMyLogin", limit: 5, windowMs: 15 * 60 * 1000 }));
    expect((await row(superId)).email).toBe("superadmin@system.local");
  }, 60_000);
});

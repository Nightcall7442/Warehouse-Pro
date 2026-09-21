import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { Session } from "@contracts/constants";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Подтверждение почты — весь путь на настоящей базе: миграция (колонка с
 * умолчанием «сейчас», засеянные люди подтверждены), регистрация с сайта
 * (директор с пустым полем, письмо со ссылкой), вход закрыт с кодом, ссылка
 * ставит дату, вход открыт, повтор ссылки дату не двигает, письмо ещё раз —
 * только пока не подтверждён.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../../telegram-router", async (orig) => ({ ...(await orig<object>()), notifyAdmin: vi.fn(async () => {}) }));
const mail = vi.hoisted(() => ({ verify: [] as Array<{ to: string; url: string }>, other: [] as string[] }));
vi.mock("../../lib/mailer", () => ({
  sendVerifyEmail: vi.fn(async (to: string, _n: string, _o: string, url: string) => { mail.verify.push({ to, url }); }),
  sendEmail: vi.fn(async (o: { subject: string }) => { mail.other.push(o.subject); }),
}));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  return { env: { ...real.env, appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789" } };
});

const publicCtx = (db: ServiceDb): any => ({ req: new Request("http://localhost/"), resHeaders: new Headers(), db });

describe.skipIf(!hasRealDb)("подтверждение почты на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); mail.verify.length = 0; mail.other.length = 0; });

  const login = async (body: Record<string, unknown>) => {
    const app = (await import("../../boot")).default;
    const res = await app.request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any, cookie: res.headers.get("set-cookie") ?? "" };
  };

  it("засеянные и приглашённые люди подтверждены умолчанием колонки", async () => {
    const [agent] = await db.select({ v: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, s.agentId));
    expect(agent.v).toBeInstanceOf(Date);
    const [[col]] = await db.execute(sql`SELECT COLUMN_DEFAULT AS d, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_verified_at'`) as unknown as [Array<{ d: string; n: string }>];
    expect(col.n).toBe("YES");
    expect(String(col.d).toLowerCase()).toContain("now()");
  });

  it("регистрация → вход закрыт (403, код) → ссылка → вход открыт → повтор ссылки дату не двигает", async () => {
    const { tenantRouter } = await import("../../tenant-router");
    const { authRouter } = await import("../../auth-router");
    const r = await tenantRouter.createCaller(publicCtx(db)).register({ orgName: "Ферганский сок", name: "Дилноза", email: "dilnoza@sok.uz", password: "пароль-восемь" });
    expect(r.message).toContain("Письмо отправлено");

    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "dilnoza@sok.uz"));
    expect(u.role).toBe("ceo");
    expect(u.emailVerifiedAt, "директор с формы засчитан подтверждённым").toBeNull();
    expect(mail.verify).toHaveLength(1);
    expect(mail.verify[0].to).toBe("dilnoza@sok.uz");
    const token = new URL(mail.verify[0].url).searchParams.get("token")!;

    const closed = await login({ email: "dilnoza@sok.uz", password: "пароль-восемь" });
    expect(closed.status).toBe(403);
    expect(closed.body.code).toBe("EMAIL_UNVERIFIED");
    expect(closed.cookie).not.toContain(Session.cookieName);

    await expect(authRouter.createCaller(publicCtx(db)).verifyEmail({ token })).resolves.toEqual({ ok: true });
    const [v1] = await db.select({ v: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, u.id));
    expect(v1.v).toBeInstanceOf(Date);

    const open = await login({ email: "dilnoza@sok.uz", password: "пароль-восемь" });
    expect(open.status).toBe(200);
    expect(open.cookie).toContain(Session.cookieName);

    await new Promise(r => setTimeout(r, 1100));
    await expect(authRouter.createCaller(publicCtx(db)).verifyEmail({ token })).resolves.toEqual({ ok: true });
    const [v2] = await db.select({ v: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, u.id));
    expect(v2.v!.getTime(), "повтор ссылки переписал дату").toBe(v1.v!.getTime());
  });

  it("письмо ещё раз уходит только неподтверждённому; подделанная ссылка — отказ без записи", async () => {
    const { tenantRouter } = await import("../../tenant-router");
    const { authRouter } = await import("../../auth-router");
    const auth = authRouter.createCaller(publicCtx(db));
    await tenantRouter.createCaller(publicCtx(db)).register({ orgName: "Сок", name: "Дилноза", email: "dilnoza@sok.uz", password: "пароль-восемь" });
    mail.verify.length = 0;

    await auth.resendVerification({ email: "dilnoza@sok.uz" });
    expect(mail.verify).toHaveLength(1);
    const token = new URL(mail.verify[0].url).searchParams.get("token")!;

    await expect(auth.verifyEmail({ token: token.slice(0, -2) + "zz" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [still] = await db.select({ v: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.email, "dilnoza@sok.uz"));
    expect(still.v).toBeNull();

    await auth.verifyEmail({ token });
    mail.verify.length = 0;
    await auth.resendVerification({ email: "dilnoza@sok.uz" });
    expect(mail.verify, "подтверждённому ушло письмо").toHaveLength(0);
    // Засеянный агент подтверждён умолчанием — ему тоже ничего.
    await auth.resendVerification({ email: "agent@test.local" });
    expect(mail.verify).toHaveLength(0);
  });
});

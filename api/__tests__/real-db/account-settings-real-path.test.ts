import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { Session } from "@contracts/constants";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Профиль аккаунта — настоящим путём: /api/login за кукой и запросы к
 * /api/trpc такими же пачками, какими их шлёт сайт.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * 01.10.2026, #150 убрал user.me. Установленный на телефон сайт (PWA) — это
 * копия, которая обновляется только по согласию человека, и старая копия
 * владельца на /super-admin просила user.me в одной пачке с
 * tenant.platformStats: ответ 207 с отказом, на экране — ошибка.
 *
 * Там же: владелец получил ключ второго фактора и не смог его включить. На
 * стенде, при проверке нового мастера снимками, нашлось ещё одно: после
 * включения auth.me ещё несколько секунд отдавал «выключено» (вход держит
 * прочитанного человека в памяти), и «Мой профиль» на /super-admin показывал
 * «Выключен» у только что включившего.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - пачка старой копии (user.me + tenant.platformStats) отвечает 200, а
 *     user.me — тем же, что и до #150: человек без хеша пароля и секрета;
 *   - мастер целиком: totpSetup выдаёт ключ и строку otpauth с ним, код,
 *     посчитанный из ключа, включает второй фактор, и auth.me СРАЗУ отвечает
 *     «включён»; выключение кодом — СРАЗУ «выключен»;
 *   - неверный код — отказ BAD_REQUEST, второй фактор не включён;
 *   - «Выйти на всех устройствах» гасит и другое устройство, и это — сразу.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  const over: Record<string, unknown> = { appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789" };
  return { env: new Proxy(real.env, { get: (o, k) => (k in over ? over[k as string] : o[k as string]) }) };
});

const PASSWORD = "тестовый-пароль-1";

describe.skipIf(!hasRealDb)("профиль аккаунта настоящим путём", () => {
  let db: ServiceDb;
  let s: Seeded;
  let hash: string;
  let superId: number;

  beforeAll(async () => {
    db = await connectRealDb(); current = db;
    hash = await (await import("../../auth/password")).hashPassword(PASSWORD);
  }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const { _resetKeyForTests } = await import("../../lib/secret-box");
    _resetKeyForTests();
    const [sa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Владелец платформы", email: "superadmin@system.local", passwordHash: hash, role: "superadmin", phone: "+998901112233" });
    superId = Number(sa.insertId);
    const { invalidateAuthUser, invalidateAuthTenant } = await import("../../auth");
    invalidateAuthUser(superId);
    for (const id of [s.tenantId, s.otherTenantId]) invalidateAuthTenant(id);
    const { checkRateLimit } = await import("../../lib/rate-limit");
    vi.mocked(checkRateLimit).mockReset().mockImplementation(async () => true);
  });

  const app = async () => (await import("../../boot")).default;
  const cookieOf = (setCookie: string | null) => {
    const pair = (setCookie ?? "").split(";")[0];
    return pair.startsWith(`${Session.cookieName}=`) && pair.length > Session.cookieName.length + 1 ? pair : "";
  };
  const login = async () => {
    const res = await (await app()).request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "superadmin@system.local", password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return cookieOf(res.headers.get("set-cookie"));
  };
  // Пачка запросов — как её шлёт сайт (httpBatchLink): пути через запятую.
  const batch = async (cookie: string, paths: string[]) => {
    const input = encodeURIComponent(JSON.stringify(Object.fromEntries(paths.map((_, i) => [i, { json: null, meta: { values: ["undefined"] } }]))));
    const res = await (await app()).request(`/api/trpc/${paths.join(",")}?batch=1&input=${input}`, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json() as any[] };
  };
  const call = async (cookie: string, path: string, input?: unknown) => {
    const res = await (await app()).request(`/api/trpc/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ json: input ?? null }),
    });
    const body = await res.json() as any;
    return { status: res.status, data: body?.result?.data?.json, code: body?.error?.json?.data?.code as string | undefined };
  };
  const meTotp = async (cookie: string) => (await batch(cookie, ["auth.me"])).body[0]?.result?.data?.json?.totpEnabledAt ?? null;

  it("старая копия сайта: пачка user.me + tenant.platformStats — 200, user.me отвечает как до #150", async () => {
    const cookie = await login();
    const r = await batch(cookie, ["user.me", "tenant.platformStats"]);
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
    expect(r.body.map(x => Boolean(x.error)), "в пачке есть отказ — старая копия покажет ошибку").toEqual([false, false]);

    const me = r.body[0].result.data.json;
    expect(me).toMatchObject({ id: superId, email: "superadmin@system.local", name: "Владелец платформы", role: "superadmin", phone: "+998901112233" });
    expect(me, "хеш пароля наружу").not.toHaveProperty("passwordHash");
    expect(me, "секрет второго фактора наружу").not.toHaveProperty("totpSecret");

    // Ровно то, что auth.me, без прав (их у user.me не было и до #150).
    const auth = (await batch(cookie, ["auth.me"])).body[0].result.data.json;
    const { can: _can, ...authWithoutCan } = auth;
    expect(me).toEqual(authWithoutCan);
    // Первая проверка поднимает приложение целиком (boot): с холодным кэшем
    // сборки это дольше общего потолка в 20 секунд.
  }, 90_000);

  it("мастер второго фактора: ключ → код из ключа → включён, и auth.me знает это сразу; выключение — тоже сразу", async () => {
    const cookie = await login();
    expect(await meTotp(cookie)).toBeNull();

    const setup = await call(cookie, "user.totpSetup");
    expect(setup.status).toBe(200);
    const { secret, url } = setup.data as { secret: string; url: string };
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    // Кнопка «Открыть в приложении» и QR-код несут одну строку — с этим ключом.
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(new URL(url).searchParams.get("secret")).toBe(secret);

    const { totpCode } = await import("../../lib/totp");
    const bad = await call(cookie, "user.totpEnable", { code: totpCode(secret) === "000000" ? "111111" : "000000" });
    expect(bad.code).toBe("BAD_REQUEST");
    expect((await db.select().from(schema.users).where(eq(schema.users.id, superId)))[0].totpEnabledAt).toBeNull();

    const ok = await call(cookie, "user.totpEnable", { code: totpCode(secret) });
    expect(ok.status).toBe(200);
    expect(await meTotp(cookie), "auth.me после включения всё ещё говорит «выключено» — кэш входа не сброшен").not.toBeNull();

    // Код одноразовый: следующий шаг времени — для выключения.
    const off = await call(cookie, "user.totpDisable", { code: totpCode(secret, Date.now() + 30_000) });
    expect(off.status).toBe(200);
    expect(await meTotp(cookie), "auth.me после выключения всё ещё говорит «включено»").toBeNull();
  });

  it("«Выйти на всех устройствах» гасит и другое устройство, и это — сразу", async () => {
    const here = await login();
    const there = await login();
    expect((await batch(there, ["auth.me"])).status).toBe(200);
    expect((await call(here, "user.logoutAll")).status).toBe(200);
    expect((await batch(there, ["auth.me"])).status, "другое устройство осталось в системе").not.toBe(200);
    expect((await batch(here, ["auth.me"])).status, "это устройство тоже выходит — так и написано на экране").not.toBe(200);
  });
});

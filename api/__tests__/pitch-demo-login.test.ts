import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/demo/login и GET /api/demo/status — HTTP-обвязка демо-входа.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Кого впускать, решает findDemoUser (переменная, пометка песочницы, роль) —
 * это проверяется на настоящей базе в real-db/pitch-demo.test.ts. Здесь —
 * то, что между ним и браузером:
 *
 * 1. Роль только из трёх: директор, агент, супервайзер. «superadmin»,
 *    «operator», мусор — 400, и до базы дело не доходит.
 * 2. Отказы различимы: выключено — 404 (адреса будто нет), не песочница —
 *    403, некого впустить — 404. Ни в одном нет куки.
 * 3. Успех ставит httpOnly-куку сессии, и её токен — сессия ИМЕННО того
 *    пользователя, которого выбрал findDemoUser.
 * 4. Счёт входов: десять с адреса за десять минут, одиннадцатый — 429 с
 *    Retry-After; соседний адрес при этом входит. Плюс общий потолок на всех
 *    — на случай, когда адрес не определён.
 *
 * Ограничитель настоящий (в памяти), а не заглушка: проверяется, что он
 * действительно срабатывает на этом маршруте.
 */

vi.hoisted(() => { process.env.TRUSTED_PROXY_COUNT = "1"; });

const findDemoUser = vi.fn();
const demoStatus = vi.fn();
vi.mock("../services/pitch-demo", async (orig) => ({
  ...(await orig<object>()),
  findDemoUser: (...a: unknown[]) => findDemoUser(...a),
  demoStatus: (...a: unknown[]) => demoStatus(...a),
}));
vi.mock("../queries/connection", () => ({ getDb: () => ({}), getPool: () => null }));

import routes, { DEMO_LOGIN_IP_LIMIT, DEMO_LOGIN_ALL_LIMIT } from "../http/demo";
import { verifySessionToken } from "../auth/session";

let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const login = (body: unknown, ip = freshIp()) => routes.request("/api/demo/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": ip },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

beforeEach(() => {
  findDemoUser.mockReset();
  demoStatus.mockReset();
  findDemoUser.mockResolvedValue({ ok: true, userId: 77, tokenVersion: 3 });
});

describe("демо-вход: роль", () => {
  it.each(["superadmin", "operator", "courier", "CEO", "", null, 1])("роль %s — 400, база не спрашивается", async (role) => {
    const r = await login({ role });
    expect(r.status).toBe(400);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(findDemoUser).not.toHaveBeenCalled();
  });

  it("тело не JSON — 400", async () => {
    const r = await login("не json");
    expect(r.status).toBe(400);
  });
});

describe("демо-вход: отказы", () => {
  it.each([
    ["disabled", 404],
    ["not_sandbox", 403],
    ["no_user", 404],
  ] as const)("%s — %i и без куки", async (reason, status) => {
    findDemoUser.mockResolvedValue({ ok: false, reason });
    const r = await login({ role: "ceo" });
    expect(r.status).toBe(status);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(((await r.json()) as { reason: string }).reason).toBe(reason);
  });
});

describe("демо-вход: успех", () => {
  it.each(["ceo", "agent", "supervisor"] as const)("%s — кука сессии выбранного пользователя", async (role) => {
    const r = await login({ role });
    expect(r.status).toBe(200);
    expect(findDemoUser).toHaveBeenCalledWith(expect.anything(), role);
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    const token = cookie.split(";")[0].split("=")[1];
    const claim = await verifySessionToken(token);
    expect(claim).toMatchObject({ userId: 77, tv: 3 });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("демо-вход: счёт входов", () => {
  it("пределы такие, как задуманы", () => {
    expect(DEMO_LOGIN_IP_LIMIT).toMatchObject({ windowMs: 600_000, limit: 10 });
    expect(DEMO_LOGIN_ALL_LIMIT.limit).toBeGreaterThan(DEMO_LOGIN_IP_LIMIT.limit);
  });

  it("десять с одного адреса проходят, одиннадцатый — 429 с Retry-After; другой адрес входит", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < DEMO_LOGIN_IP_LIMIT.limit; i++) {
      expect((await login({ role: "agent" }, ip)).status, `вход ${i + 1}`).toBe(200);
    }
    const blocked = await login({ role: "agent" }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect((await login({ role: "agent" }, "203.0.113.10")).status).toBe(200);
  });

  it("общий потолок держит даже тогда, когда адреса разные", async () => {
    let lastStatus = 200;
    // Уже потрачено выше; добиваем до потолка с новых адресов.
    for (let i = 0; i < DEMO_LOGIN_ALL_LIMIT.limit + 5 && lastStatus === 200; i++) {
      lastStatus = (await login({ role: "ceo" })).status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("состояние демо", () => {
  it("отдаёт то, что сказал demoStatus, и не кэшируется", async () => {
    demoStatus.mockResolvedValue({ enabled: true, roles: ["ceo", "agent"], apiKey: null });
    const r = await routes.request("/api/demo/status");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ enabled: true, roles: ["ceo", "agent"], apiKey: null });
  });

  it("сбой базы — «выключено», а не 500 на публичной странице", async () => {
    demoStatus.mockRejectedValue(new Error("база легла"));
    const r = await routes.request("/api/demo/status");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: false, roles: [], apiKey: null });
  });
});

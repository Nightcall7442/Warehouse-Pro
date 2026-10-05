import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { signSessionToken, sessionCookie } from "../auth/session";
import { checkRateLimit, rateLimitSubject } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { demoStatus, findDemoUser, isDemoRole } from "../services/pitch-demo";

/*
  Демо-вход для жюри: GET /api/demo/status и POST /api/demo/login.
  Правила — в services/pitch-demo.ts; здесь только HTTP.

  Два счёта на вход. По адресу — десять входов за десять минут: жюри хватит
  с запасом, перебор ролей скриптом упрётся. И общий на всех — потому что
  адрес известен не всегда: без TRUSTED_PROXY_COUNT rateLimitSubject не знает
  адреса и счёт по нему не ведётся вовсе (lib/rate-limit.ts). Общий потолок
  держит выпуск сессий даже тогда.
*/
export const DEMO_LOGIN_IP_LIMIT = { windowMs: 10 * 60_000, limit: 10, namespace: "demo-login" };
export const DEMO_LOGIN_ALL_LIMIT = { windowMs: 10 * 60_000, limit: 200, namespace: "demo-login-all" };

const routes = new Hono();

routes.get("/api/demo/status", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    return c.json(await demoStatus(getDb()));
  } catch (e) {
    logger.warn("demo status failed", { error: e instanceof Error ? e.message : String(e) });
    return c.json({ enabled: false, roles: [], apiKey: null });
  }
});

routes.post("/api/demo/login", async (c) => {
  c.header("Cache-Control", "no-store");
  const fromAddress = rateLimitSubject(c.req.raw);
  if (!(await checkRateLimit(fromAddress, DEMO_LOGIN_IP_LIMIT))
    || !(await checkRateLimit("all", DEMO_LOGIN_ALL_LIMIT))) {
    return c.json({ error: "Too many demo sign-ins. Try again in a few minutes.", reason: "rate_limited" }, 429, { "Retry-After": "600" });
  }

  let role: unknown;
  try { role = ((await c.req.json()) as { role?: unknown })?.role; } catch { role = undefined; }
  if (!isDemoRole(role)) return c.json({ error: "Unknown demo role.", reason: "bad_role" }, 400);

  const found = await findDemoUser(getDb(), role);
  if (!found.ok) {
    // «Выключено» неотличимо от «такого адреса нет»: демо в этой выкладке нет.
    const status = found.reason === "not_sandbox" ? 403 : 404;
    if (found.reason === "not_sandbox") logger.warn("demo login refused: PITCH_DEMO_TENANT_ID is not an active sandbox");
    return c.json({ error: "Demo is not available.", reason: found.reason }, status);
  }

  const token = await signSessionToken({ userId: found.userId, tv: found.tokenVersion });
  c.header("set-cookie", sessionCookie(token));
  return c.json({ success: true, role });
});

export default routes;

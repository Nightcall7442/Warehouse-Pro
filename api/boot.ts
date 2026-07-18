import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { logger as honoLogger } from "hono/logger";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { registerStripeWebhook } from "./webhooks/stripe";
import onecWebhooks from "./webhooks/onec";
import publicApi from "./public-api";
import { createSSEResponse } from "./sse-router";
import { authenticateRequest } from "./auth";
import { cache } from "./lib/cache";
import { getDb } from "./queries/connection";
import { tenants } from "@db/schema";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { recordRequest } from "./system-router";
import { logError } from "./lib/error-log";
import { safeEqual } from "./lib/safe-compare";


const APP_VERSION = "1.0.0";

const app = new Hono<{ Bindings: HttpBindings }>();

// ── Request logging with correlation IDs ──────────────────────────────────────
if (env.isProduction) {
  app.use("*", async (c, next) => {
    const start = Date.now();
    const corrId = c.req.header("x-correlation-id") ?? crypto.randomUUID().slice(0, 12);
    c.header("x-correlation-id", corrId);
    await next();
    const ms = Date.now() - start;
    recordRequest(ms, c.res.status >= 400);
    logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
      correlationId: corrId,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    });
  });
} else {
  app.use(honoLogger());
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'"],
    styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],  // Google Fonts + Tailwind
    imgSrc:     ["'self'", "data:", "https:"],  // product photos, S3, base64 avatars
    connectSrc: ["'self'"],                      // tRPC, SSE, WebSocket
    fontSrc:    ["'self'", "data:", "https://fonts.gstatic.com"],             // Google Fonts files
    frameAncestors: ["'none'"],
    objectSrc:  ["'none'"],
    baseUri:    ["'self'"],
    formAction: ["'self'"],
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use("/api/*", cors({
  origin: env.isProduction
    ? (origin) => (origin && env.allowedOrigins.includes(origin)) ? origin : null
    : (origin) => (origin && env.allowedOrigins.includes(origin)) ? origin : null,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning", "x-correlation-id", "Last-Event-ID"],
  credentials: true,
  maxAge: 86400,
}));

// ── Stripe webhook (must be BEFORE bodyLimit — needs raw body) ───────────────
registerStripeWebhook(app);

// ── 1C webhook (receives payments & stock updates) ───────────────────────────
app.use("/api/webhooks/1c/*", bodyLimit({ maxSize: 256 * 1024 })); // 256 KB max
app.route("/api/webhooks/1c", onecWebhooks);

// ── Public REST API (Exclusive tier) ─────────────────────────────────────────
app.route("/api/v1", publicApi);

// ── Cron: trial ending reminders ─────────────────────────────────────────────
app.get("/api/cron/trial-reminders", async (c) => {
  if (!env.cronSecret) {
    return c.json({ error: "Cron endpoint not configured" }, 401);
  }
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  if (!safeEqual(secret ?? "", env.cronSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { runTrialReminders } = await import("./cron/trial-reminders");
  const result = await runTrialReminders();
  return c.json(result);
});

app.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// ── SSE endpoint ─────────────────────────────────────────────────────────────
app.get("/api/events", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw.headers);
    if (!auth.user || !auth.tenant) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const lastEventId = c.req.header("Last-Event-ID");
    return createSSEResponse(auth.tenant.id, auth.user.id, lastEventId ?? undefined);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

// ── Simple endpoints (без tRPC) ──────────────────────────────────────────────
import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { verifyPassword } from "./auth/password";
import { findUserByEmailAnyTenant, updateUserLastSignIn } from "./queries/users";
import { findTenantById } from "./queries/tenants";
import { signSessionToken } from "./auth/session";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20, namespace: "login" };

app.post("/api/login", async (c) => {
  try {
    const ip = getClientIp(c.req.raw);
    if (!checkRateLimit(ip, LOGIN_RATE_LIMIT)) {
      return c.json({ error: "Too many login attempts. Please try again in 15 minutes." }, 429);
    }

    const { email, password } = await c.req.json();
    if (!email || !password) return c.json({ error: "Email and password required" }, 400);

    const user = await findUserByEmailAnyTenant(email);
    const dummyHash = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(128);
    const valid = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, dummyHash).then(() => false);

    if (!user || !valid) return c.json({ error: "Invalid email or password" }, 401);
    if (user.status !== "active") return c.json({ error: "Account is inactive" }, 403);

    const tenant = await findTenantById(user.tenantId);
    if (!tenant || tenant.status !== "active") return c.json({ error: "Organisation is suspended" }, 403);

    await updateUserLastSignIn(user.id);
    const token = await signSessionToken({ userId: user.id });

    c.header("set-cookie", cookie.serialize(Session.cookieName, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Session.maxAgeMs / 1000,
    }));

    return c.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } },
    });
  } catch (e) {
    console.error("[LOGIN ERROR]", e instanceof Error ? e.message : String(e), e instanceof Error ? e.stack : "");
    return c.json({ error: "Login failed" }, 500);
  }
});

app.post("/api/logout", async (c) => {
  c.header("set-cookie", cookie.serialize(Session.cookieName, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    expires: new Date(0),
  }));
  return c.json({ success: true });
});

// ── tRPC handler ─────────────────────────────────────────────────────────────

app.use("/api/trpc/*", async (c) => {
  // Сохраняем ссылку на resHeaders перед вызовом tRPC
  const resHeaders = new Headers();

  const res = await fetchRequestHandler({
    endpoint:      "/api/trpc",
    req:           c.req.raw,
    router:        appRouter,
    createContext: async (opts) => {
      const ctx = await createContext(opts);
      ctx.resHeaders = resHeaders;
      return ctx;
    },
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error("tRPC internal error", { path, error: error.cause ?? error.message });
      }
      logError({
        message: error.message,
        code: error.code,
        path: path ?? "unknown",
        method: "POST",
        statusCode: 500,
        stack: error.cause instanceof Error ? error.cause.stack : undefined,
      });
    },
  });

  // Пересылаем заголовки (set-cookie) из tRPC контекста в HTTP ответ
  if (resHeaders.entries().next().value) {
    const headers = new Headers(res.headers);
    for (const [key, value] of resHeaders.entries()) {
      headers.append(key, value);
    }
    return new Response(res.body, { status: res.status, headers });
  }

  return res;
});

// ── HTTP error logger ────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  if (c.res.status >= 400) {
    logError({
      message: `HTTP ${c.res.status}`,
      code: `HTTP_${c.res.status}`,
      path: c.req.path,
      method: c.req.method,
      statusCode: c.res.status,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim(),
      correlationId: c.req.header("x-correlation-id"),
    });
  }
});

// ── Health check for 1C connection ──────────────────────────────────────────
app.get("/health/1c", async (c) => {
  try {
    const { getBridge } = await import("./lib/onec-bridge");
    const bridge = getBridge();
    const healthy = await bridge.healthCheck();
    return c.json({ healthy, service: "1c-bridge", timestamp: new Date().toISOString() }, healthy ? 200 : 503);
  } catch (e) {
    return c.json({ healthy: false, error: (e as Error).message }, 503);
  }
});

// ── Health check with version info ───────────────────────────────────────────
app.get("/health", async (c) => {
  const dbHealthy = await checkDatabaseHealth();
  return c.json({
    status: dbHealthy ? "ok" : "degraded",
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    ts: Date.now(),
    env: env.isProduction ? "production" : "development",
    cache: cache.getStats(),
    database: dbHealthy ? "connected" : "disconnected",
  });
});

// ── Readiness probe (for k8s/PM2 — checks DB connectivity) ───────────────────
app.get("/health/ready", async (c) => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok" }, 200);
  } catch {
    return c.json({ status: "error" }, 503);
  }
});

// ── API version info ─────────────────────────────────────────────────────────
app.get("/api/v1/version", (c) => c.json({
  version: APP_VERSION,
  api: "v1",
  features: [
    "sso",
    "multi-tenant",
    "real-time-events",
    "white-label",
  ],
}));

// ── Cache stats (admin only, dev only) ──────────────────────────────────────
app.get("/api/debug/cache", (c) => {
  if (env.isProduction) return c.json({ error: "Not Found" }, 404);
  return c.json(cache.getStats());
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const db = getDb();
    await db.select({ id: tenants.id }).from(tenants).limit(1);
    return true;
  } catch {
    return false;
  }
}

export default app;

if (env.isProduction) {
  const { serve }            = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { attachWebSocket }  = await import("./lib/ws");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info("server started", { port, version: APP_VERSION });
  });
  attachWebSocket(server);
  logger.info("websocket attached");
}

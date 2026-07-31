import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
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
import photos from "./photos";
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
import { rememberSocketIp, warnIfClientIpUnavailable } from "./lib/rate-limit";


import * as Sentry from "@sentry/node";

const APP_VERSION = "1.0.0";

// Always init Sentry — if DSN is empty, it's a no-op
Sentry.init({
  dsn: env.sentryDsn || undefined,
  environment: env.isProduction ? "production" : "development",
  tracesSampleRate: env.isProduction ? 0.2 : 1.0,
  debug: !env.isProduction,
  release: APP_VERSION,
  sendDefaultPii: false,
});

const app = new Hono<{ Bindings: HttpBindings }>();

// ── Response compression ─────────────────────────────────────────────────────
// Must be the outermost middleware so it wraps every body: JS/CSS bundles and
// tRPC JSON alike. text/event-stream is excluded by the middleware itself, so
// the SSE endpoint keeps streaming uncompressed.
app.use("*", compress());

// ── Client identity for rate limiting ────────────────────────────────────────
// FIX: P0.2 — a Fetch Request exposes no connection info, so record the TCP peer
// address while the Node request object is still reachable. getClientIp() falls
// back to it when TRUSTED_PROXY_COUNT=0, where proxy headers can't be trusted.
app.use("*", async (c, next) => {
  rememberSocketIp(c.req.raw, c.env?.incoming?.socket?.remoteAddress);
  return next();
});

// ── Sentry error handler + Telegram notification ─────────────────────────────
app.use("*", async (c, next) => {
  try {
    await next();
  } catch (err) {
    const status = c.res?.status ?? 500;
    const method = c.req.method;
    const path = c.req.path;

    // P1-10 FIX: Resolve auth before withScope so user context is available when scope closes
    let authUser: { id: number; email: string } | undefined;
    let authTenant: { id: number; slug: string } | undefined;
    try {
      const auth = await authenticateRequest(c.req.raw.headers);
      if (auth.user) authUser = { id: auth.user.id, email: auth.user.email };
      if (auth.tenant) authTenant = { id: auth.tenant.id, slug: auth.tenant.slug };
    } catch { /* not authenticated */ }

    // Set Sentry context and tags for alert targeting
    Sentry.withScope((scope) => {
      scope.setTag("method", method);
      scope.setTag("path", path);
      scope.setTag("status", String(status));
      scope.setTag("error_type", err instanceof Error ? err.constructor.name : "Unknown");

      if (authUser) {
        scope.setUser({ id: String(authUser.id), username: authUser.email });
        scope.setContext("tenant", authTenant);
      }

      // Set request context
      scope.setContext("request", {
        method,
        path,
        url: c.req.url,
        userAgent: c.req.header("user-agent"),
        ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim(),
      });

      Sentry.captureException(err);
    });

    // Telegram alert for server errors (5xx)
    // P1-11 FIX: Only alert on 5xx errors that are not Zod validation errors
    if (status >= 500 && !(err instanceof Error && err.message.includes("ZodError"))) {
      try {
        const { notifyAdmin } = await import("./telegram-router");
        const msg = `🔴 <b>Server Error</b>\n<code>${method} ${path}</code>\n${err instanceof Error ? err.message : String(err).slice(0, 200)}`;
        notifyAdmin(msg);
      } catch { /* Telegram not configured — skip */ }
    }

    throw err;
  }
});

// ── Global JSON error handler (catches unhandled throws) ─────────────────────
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error("Unhandled error", { error: message, stack });
  return c.json({ error: "Internal server error" }, 500);
});

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
    scriptSrc:  ["'self'", "https://api-maps.yandex.ru", "https://core.apimaps.yandex.ru", "https://yastatic.net", "https://*.maps.yandex.net", "https://*.yandex.ru"],
    styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.gstatic.com"],  // Google Fonts + Tailwind + Translate
    imgSrc:     ["'self'", "data:", "blob:", "https:"],  // product photos, S3, base64 avatars, blob previews
    connectSrc: ["'self'", "https://api-maps.yandex.ru", "https://*.ingest.de.sentry.io", "https://*.sentry.io"],
    workerSrc:  ["'self'", "blob:"],                      // tRPC, SSE, WebSocket, Yandex Maps
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
  origin: (origin) => (origin && env.allowedOrigins.includes(origin)) ? origin : null,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning", "x-correlation-id", "x-csrf-token", "Last-Event-ID"],
  credentials: true,
  maxAge: 86400,
}));

// ── CSRF double-submit cookie ────────────────────────────────────────────────
// State-changing POST requests must echo the CSRF cookie value in x-csrf-token header.
// This prevents cross-site form submissions from triggering mutations.
const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE_RE = new RegExp(`${CSRF_COOKIE}=([^;]+)`);
// Set CSRF cookie on every response so the client can read it (non-httpOnly).
// Skipped for hashed static assets — a Set-Cookie there only makes long-lived
// cacheable responses harder for proxies to reuse.
app.use("*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/assets/")) return;
  const existing = c.req.header("cookie")?.match(CSRF_COOKIE_RE);
  if (!existing) {
    const token = crypto.randomUUID();
    const cookie = `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict; ${env.isProduction ? "Secure; " : ""}Max-Age=86400`;
    c.header("set-cookie", cookie, { append: true });
  }
});
// Validate CSRF on state-changing POST requests (skip webhooks, tRPC, public API, auth endpoints)
app.use("/api/*", async (c, next) => {
  // CSRF protection: skip for tRPC (JSON API protected by CORS + SameSite cookies),
  // webhooks (Stripe signature), and auth endpoints.
  // Bearer token auth (mobile) is also skipped — token is explicitly in header, not auto-sent.
  if (c.req.method === "POST" && !c.req.path.includes("/trpc/") && !c.req.path.includes("/webhooks/") && !c.req.path.includes("/logout") && !c.req.path.includes("/login")) {
    const authHeader = c.req.header("authorization");
    const isBearerAuth = authHeader?.startsWith("Bearer ");
    if (!isBearerAuth) {
      const cookieToken = c.req.header("cookie")?.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`))?.[1];
      const headerToken = c.req.header(CSRF_HEADER);
      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return c.json({ error: "CSRF token mismatch" }, 403);
      }
    }
  }
  await next();
});

// ── Stripe webhook (must be BEFORE bodyLimit — needs raw body) ───────────────
registerStripeWebhook(app);

// ── 1C webhook (receives payments & stock updates) ───────────────────────────
app.use("/api/webhooks/1c/*", bodyLimit({ maxSize: 256 * 1024 })); // 256 KB max
app.route("/api/webhooks/1c", onecWebhooks);

// ── Public REST API (Exclusive tier) ─────────────────────────────────────────
app.route("/api/v1", publicApi);

// ── Photo delivery (keeps base64 blobs out of list responses) ────────────────
app.route("/api/photos", photos);

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

// ── Cron: daily database backup ──────────────────────────────────────────────
app.get("/api/cron/backup", async (c) => {
  if (!env.cronSecret) {
    return c.json({ error: "Cron endpoint not configured" }, 401);
  }
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  if (!safeEqual(secret ?? "", env.cronSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { runBackup } = await import("./cron/backup");
  const result = await runBackup();
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
    if (!(await checkRateLimit(ip, LOGIN_RATE_LIMIT))) {
      return c.json({ error: "Too many login attempts. Please try again in 15 minutes." }, 429);
    }

    const { email, password } = await c.req.json();
    if (!email || !password) return c.json({ error: "Email and password required" }, 400);

    const user = await findUserByEmailAnyTenant(email);
    const dummyHash = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(128);
    const valid = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, dummyHash).then(() => false);

    const GENERIC_AUTH_ERROR = "Неверный email или пароль";

    if (!user || !valid) return c.json({ error: GENERIC_AUTH_ERROR }, 401);
    if (user.status !== "active") return c.json({ error: GENERIC_AUTH_ERROR }, 401);

    const tenant = await findTenantById(user.tenantId);
    if (!tenant || tenant.status !== "active") return c.json({ error: GENERIC_AUTH_ERROR }, 401);

    await updateUserLastSignIn(user.id);
    const token = await signSessionToken({ userId: user.id, tv: user.tokenVersion ?? 0 });

    c.header("set-cookie", cookie.serialize(Session.cookieName, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Session.maxAgeMs / 1000,
    }));

    return c.json({
      success: true,
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

// Token refresh — issue a new session token before the current one expires
app.post("/api/refresh-token", async (c) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (!token) return c.json({ error: "No token" }, 401);

  try {
    const { verifySessionToken, signSessionToken } = await import("./auth/session");
    const { getDb } = await import("./queries/connection");
    const { users } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");

    const claim = await verifySessionToken(token);
    if (!claim) return c.json({ error: "Invalid token" }, 401);

    const db = getDb();
    const [user] = await db.select({ id: users.id, status: users.status, tokenVersion: users.tokenVersion })
      .from(users).where(eq(users.id, claim.userId)).limit(1);
    if (!user || user.status !== "active") return c.json({ error: "User not found or inactive" }, 401);
    if ((user.tokenVersion ?? 0) !== claim.tv) return c.json({ error: "Token revoked" }, 401);

    const newToken = await signSessionToken({ userId: user.id, tv: user.tokenVersion ?? 0 });
    return c.json({ token: newToken });
  } catch {
    return c.json({ error: "Refresh failed" }, 500);
  }
});

// Logout all devices — invalidate all tokens by incrementing tokenVersion
app.post("/api/logout-all", async (c) => {
  // Rate limit: 5 per 15 minutes per IP
  const ip = getClientIp(c.req.raw);
  if (!(await checkRateLimit(ip, { windowMs: 15 * 60 * 1000, limit: 5, namespace: "logout-all" }))) {
    return c.json({ error: "Too many requests. Try again later." }, 429);
  }

  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  if (!token) return c.json({ error: "No token" }, 401);

  try {
    const { verifySessionToken } = await import("./auth/session");
    const { getDb } = await import("./queries/connection");
    const { users } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");

    const claim = await verifySessionToken(token);
    if (!claim) return c.json({ error: "Invalid token" }, 401);

    const db = getDb();
    await db.update(users)
      .set({ tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1` })
      .where(eq(users.id, claim.userId));

    c.header("set-cookie", cookie.serialize(Session.cookieName, "", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      expires: new Date(0),
    }));

    return c.json({ success: true });
  } catch (e) {
    console.error("[LOGOUT-ALL ERROR]", e);
    return c.json({ error: "Logout failed" }, 500);
  }
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

      // Capture tRPC errors in Sentry with tags for alert targeting
      if (error.code === "INTERNAL_SERVER_ERROR") {
        Sentry.withScope((scope) => {
          scope.setTag("error_type", "trpc");
          scope.setTag("trpc_path", path ?? "unknown");
          scope.setTag("trpc_code", error.code);
          scope.setContext("trpc", { path, code: error.code, message: error.message });
          Sentry.captureException(error.cause ?? new Error(error.message));
        });
      }
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

  // Check S3 if configured
  let s3Status = "not_configured";
  if (env.s3Bucket) {
    try {
      const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({ region: env.s3Region || "us-east-1" });
      await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
      s3Status = "connected";
    } catch {
      s3Status = "error";
    }
  }

  const status = dbHealthy ? "ok" : "degraded";
  return c.json({
    status,
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    ts: Date.now(),
    env: env.isProduction ? "production" : "development",
    cache: cache.getStats(),
    database: dbHealthy ? "connected" : "disconnected",
    s3: s3Status,
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
  const { connectRedis }     = await import("./lib/redis");
  serveStaticFiles(app);

  // P1-6 FIX: Connect Redis on startup for multi-instance support
  await connectRedis();
  warnIfClientIpUnavailable();
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info("server started", { port, version: APP_VERSION });
  });
  attachWebSocket(server);
  logger.info("websocket attached");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    server.close(() => {
      logger.info("HTTP server closed");
    });
    // Close DB connections
    try {
      const { getDb } = await import("./queries/connection");
      const db = getDb();
      await db.$client.end();
      logger.info("Database connections closed");
    } catch (e) {
      logger.error("Error closing database", { error: String(e) });
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

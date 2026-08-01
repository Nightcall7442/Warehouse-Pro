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
import { checkDatabaseHealth, closeDb, getDb, runWithDb, waitForDatabase } from "./queries/connection";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { recordRequest } from "./system-router";
import { logError, logTrpcError } from "./lib/error-log";
import { stripBoundParams } from "./lib/db-error";
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
/**
 * FIX: P2.3 — in-flight request accounting for graceful shutdown.
 *
 * `server.close()` stops accepting connections but says nothing about requests
 * already running; without this the process either exits mid-write or hangs.
 */
let inFlight = 0;
let draining = false;

function activeRequests(): number {
  return inFlight;
}

app.use("*", async (c, next) => {
  rememberSocketIp(c.req.raw, c.env?.incoming?.socket?.remoteAddress);
  // Health probes must keep answering while draining — that is how the load
  // balancer learns to stop sending traffic here.
  if (draining && !c.req.path.startsWith("/health")) {
    return c.json({ error: "Server is shutting down" }, 503, { "connection": "close" });
  }

  inFlight += 1;
  try {
    // FIX: P0.3 — bind the database handle for this request's async context, so
    // getDb() deep inside a call chain resolves the same handle the request
    // started with (and joins an open transaction instead of committing beside it).
    return await runWithDb(getDb(), () => next());
  } finally {
    inFlight -= 1;
  }
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
  // Scrubbed for the same reason as the tRPC path: a Drizzle failure reaching
  // here carries its bound parameters in both the message and the stack.
  const message = stripBoundParams(err instanceof Error ? err.message : String(err));
  const stack = err instanceof Error && err.stack ? stripBoundParams(err.stack) : undefined;
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
  // FIX: P0.4 — a failed backup must answer non-2xx, otherwise the external cron
  // caller records a success and nobody notices there is no artifact. Note this
  // endpoint needs the MySQL client binaries, which only the `backup` image ships;
  // the scheduled run happens there (see dist/cron/backup-runner.js).
  return c.json(result, result.success ? 200 : 500);
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
    onError: ({ error, type, path, req }) => {
      // Status comes from the tRPC code (UNAUTHORIZED → 401, NOT_FOUND → 404, …)
      // and the method from the actual request — both used to be hard-coded to
      // 500/POST, which turned one expired session into three "server errors".
      // logTrpcError also picks the sink: the error feed for 5xx, the client-issue
      // counters for 4xx, so an expected condition never pollutes the feed.
      // `db` is the driver-level reason (ER_TRUNCATED_WRONG_VALUE, sqlMessage,
      // column) when the failure came from MySQL — the detail that used to stop
      // at Drizzle's `.cause` and never reach any sink.
      const { statusCode, method, isServerFault, db } = logTrpcError({
        error,
        path,
        method: req?.method,
      });
      const errorPath = path ?? "unknown";

      // 4xx: an expected client condition (expired session, rejected input, rate
      // limit). Counted above and warned here, so an auth outage or brute-force
      // burst is still detectable without competing with real faults.
      if (!isServerFault) {
        logger.warn("tRPC client error", {
          path: errorPath,
          method,
          type,
          statusCode,
          code: error.code,
          message: error.message,
        });
        return;
      }

      // Log the message, not the error object: a DrizzleQueryError keeps `query`
      // and `params` as own enumerable properties, so serialising it writes every
      // bound value — customer names, prices, phone numbers — to stderr.
      logger.error("tRPC internal error", {
        path: errorPath,
        method,
        statusCode,
        code: error.code,
        error: stripBoundParams(error.message),
        db,
      });

      // Capture tRPC errors in Sentry with tags for alert targeting
      Sentry.withScope((scope) => {
        scope.setTag("error_type", "trpc");
        scope.setTag("trpc_path", errorPath);
        scope.setTag("trpc_code", error.code);
        // Alertable on its own: a spike of one driver code is a schema or data
        // problem, not a generic 500.
        if (db?.driverCode) scope.setTag("db_code", db.driverCode);
        scope.setContext("trpc", {
          path,
          code: error.code,
          message: stripBoundParams(error.message),
        });
        if (db) scope.setContext("db", { ...db });
        Sentry.captureException(error.cause ?? new Error(error.message));
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

  const { isRedisAvailable } = await import("./lib/redis");
  const redisConfigured = Boolean(env.redisUrl);
  const redisHealthy = redisConfigured ? isRedisAvailable() : true;

  // Redis is optional (in-memory fallback), so a missing one is not degraded —
  // a configured one that is down is.
  const status = dbHealthy && redisHealthy ? "ok" : "degraded";
  return c.json({
    status,
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    ts: Date.now(),
    env: env.isProduction ? "production" : "development",
    cache: cache.getStats(),
    database: dbHealthy ? "connected" : "disconnected",
    redis: !redisConfigured ? "not_configured" : redisHealthy ? "connected" : "disconnected",
    inFlight: activeRequests(),
    s3: s3Status,
  }, status === "ok" ? 200 : 503);
});

// ── Readiness probe (for k8s/PM2 — checks DB connectivity) ───────────────────
app.get("/health/ready", async (c) => {
  if (draining) return c.json({ status: "draining" }, 503);
  return (await checkDatabaseHealth())
    ? c.json({ status: "ok" }, 200)
    : c.json({ status: "error" }, 503);
});

// ── Liveness probe ───────────────────────────────────────────────────────────
// Deliberately dependency-free: it answers "this process is still running its
// event loop". Tying it to the database would make a database blip restart every
// container, which turns a recoverable outage into a crash loop.
app.get("/health/live", (c) => c.json({
  status: draining ? "draining" : "ok",
  uptime: Math.floor(process.uptime()),
  inFlight: activeRequests(),
}, draining ? 503 : 200));

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

  // FIX: P0.3 — refuse to serve traffic before the database answers. Retries with
  // exponential backoff (1s, 2s, 4s, 8s); a server that can't reach its database
  // would otherwise come up healthy and answer every request with a 500.
  if (!(await waitForDatabase())) {
    logger.error("startup aborted: database unreachable");
    process.exit(1);
  }
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info("server started", { port, version: APP_VERSION });
  });
  attachWebSocket(server);
  logger.info("websocket attached");

  /**
   * FIX: P2.3 — drain, then close, in dependency order.
   *
   * The previous handler called `server.close()` without awaiting it, then ended
   * the pool and called `process.exit(0)` immediately — killing in-flight
   * requests mid-query and leaving SSE and WebSocket clients to notice a dropped
   * socket. Order matters here: stop taking work, let what is running finish,
   * then take away the resources it was using.
   */
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn(`${signal} received while already shutting down, ignoring`);
      return;
    }
    shuttingDown = true;
    draining = true;
    const startedAt = Date.now();
    logger.info(`${signal} received, starting graceful shutdown`, { inFlight: activeRequests() });

    // 1. Stop accepting new connections. Existing ones keep going.
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("HTTP server closed to new connections");
        resolve();
      });
      // Long-lived streams keep the server "open" — the drain below bounds it.
      setTimeout(resolve, 5_000);
    });

    // 2. End the streams that would otherwise never finish on their own.
    try {
      const { sseBus } = await import("./lib/sse");
      const closedSse = sseBus.closeAll();
      const { closeWebSockets } = await import("./lib/ws");
      const closedWs = await closeWebSockets();
      logger.info("streams closed", { sse: closedSse, websocket: closedWs });
    } catch (e) {
      logger.error("Error closing streams", { error: String(e) });
    }

    // 3. Wait for in-flight requests, but not forever: the platform's own
    //    SIGKILL is usually 30s behind SIGTERM, so exiting first is better than
    //    being killed halfway through cleanup.
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (activeRequests() > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (activeRequests() > 0) {
      logger.warn("shutdown timeout reached with requests still running", {
        inFlight: activeRequests(),
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
    }

    // 4. Release resources, most dependent first.
    try {
      const { disconnectRedis } = await import("./lib/redis");
      await disconnectRedis();
      logger.info("Redis disconnected");
    } catch (e) {
      logger.error("Error disconnecting Redis", { error: String(e) });
    }

    try {
      await closeDb();
      logger.info("Database connections closed");
    } catch (e) {
      logger.error("Error closing database", { error: String(e) });
    }

    logger.info("graceful shutdown complete", { durationMs: Date.now() - startedAt });
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

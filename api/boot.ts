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
import { sql, type SQL } from "drizzle-orm";
import { logger } from "./lib/logger";
import { recordRequest } from "./system-router";
import { logError } from "./lib/error-log";
import { safeEqual } from "./lib/safe-compare";


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
        scope.setContext("tenant", authTenant ?? null);
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
        const { notifyAdmin, tgEscape } = await import("./telegram-router");
        // Error text is the likeliest thing in the whole system to contain <>&
        // — a MySQL message quoting a value, a stack frame with a generic type.
        // Unescaped, the alert about a 500 is itself rejected by Telegram, so
        // the outages you most need to hear about were the quiet ones.
        const detail = err instanceof Error ? err.message : String(err).slice(0, 200);
        const msg = `🔴 <b>Server Error</b>\n<code>${tgEscape(method)} ${tgEscape(path)}</code>\n${tgEscape(detail)}`;
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
  // Non-200 on failure so an external cron/uptime monitor watching this
  // endpoint's status code (not just its body) actually notices a bad backup.
  return c.json(result, result.success ? 200 : 500);
});

// ── Cron: incremental backup (every 6 hours) ───────────────────────────────
app.get("/api/cron/backup-incremental", async (c) => {
  if (!env.cronSecret) {
    return c.json({ error: "Cron endpoint not configured" }, 401);
  }
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  if (!safeEqual(secret ?? "", env.cronSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Changes since midnight today
  const sinceDate = new Date();
  sinceDate.setHours(0, 0, 0, 0);
  const { runIncrementalBackup } = await import("./services/db-incremental");
  const result = await runIncrementalBackup(sinceDate);
  return c.json(result, result.success ? 200 : 500);
});

// ── Резервная копия по требованию: суперадмин скачивает SQL-дамп ────────────
//
// Снимки диска, которые делает платформа, — первая линия и остаются на месте.
// Но они защищают только от смерти диска. От ошибки человека — «удалили не тот
// заказ», «испортили цены импортом» — они предлагают откатить базу целиком на
// сутки назад, вместе со всем, что записано после. Вдобавок восстановление
// снимка на Railway удаляет все копии, сделанные позже восстанавливаемой,
// поэтому и проверить его нельзя, не израсходовав сам запас.
//
// Этот путь даёт то, чего там нет: копию вне платформы, из которой можно
// достать одну таблицу, и которую можно развернуть у себя и убедиться, что она
// разворачивается, ничего при этом не потратив.
//
// Отдаётся потоком, файл на сервере не появляется: писать копию всей базы на
// диск контейнера незачем — он не переживает следующий деплой, а до тех пор
// лежит лишней целью.
app.get("/api/admin/backup/download", async (c) => {
  let auth;
  try {
    auth = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Выгрузка содержит данные всех организаций разом, поэтому доступна только
  // суперадмину — владелец одной организации не вправе получить чужие.
  if (auth.user.role !== "superadmin") {
    logger.warn("backup download refused: not a superadmin", { userId: auth.user.id, role: auth.user.role });
    return c.json({ error: "Forbidden" }, 403);
  }

  // Выгрузка стоит дорого и базе, и процессу. Ограничение считается по
  // пользователю, а не по адресу: адрес подделывается заголовком, а
  // идентификатор берётся из проверенной сессии.
  const allowed = await checkRateLimit(String(auth.user.id), { limit: 3, windowMs: 60 * 60_000, namespace: "backup-download" });
  if (!allowed) {
    return c.json({ error: "Слишком часто. Выгрузка доступна три раза в час." }, 429);
  }

  const { startDump, DumpUnavailableError } = await import("./services/db-dump");
  let dump;
  try {
    dump = await startDump();
  } catch (e) {
    // Ответ об ошибке возможен только здесь: startDump ждёт первых байт, а
    // после отправки заголовков сменить код ответа уже нельзя.
    const message = e instanceof DumpUnavailableError ? e.message : String(e);
    logger.error("backup download failed to start", { userId: auth.user.id, error: message });
    return c.json({ error: `Не удалось сделать выгрузку: ${message}` }, 500);
  }

  // Кто и когда унёс полную копию базы — это то, что обязано остаться в
  // журнале. Запись делается до отдачи потока: оборвись передача на середине,
  // данные всё равно уже покинули сервер.
  const { recordAudit } = await import("./services/audit-log");
  await recordAudit(getDb(), {
    tenantId: auth.tenant.id,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "system.backup_downloaded",
    targetType: "database",
    meta: { filename: dump.filename },
  });

  const { Readable } = await import("node:stream");
  return new Response(Readable.toWeb(dump.stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${dump.filename}"`,
      // Копия базы не должна осесть ни в одном промежуточном кеше.
      "Cache-Control": "no-store",
    },
  });
});

// ── Restore: restore database from S3 backup ──────────────────────────────
app.post("/api/admin/backup/restore", async (c) => {
  let auth;
  try {
    auth = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (auth.user.role !== "superadmin") {
    logger.warn("restore refused: not a superadmin", { userId: auth.user.id });
    return c.json({ error: "Forbidden" }, 403);
  }

  // Rate limit: 1 restore per hour
  const allowed = await checkRateLimit(String(auth.user.id), { limit: 1, windowMs: 60 * 60_000, namespace: "backup-restore" });
  if (!allowed) {
    return c.json({ error: "Слишком часто. Восстановление доступно раз в час." }, 429);
  }

  let body: { backupKey?: string; confirm?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.confirm) {
    return c.json({
      error: "Требуется подтверждение",
      hint: 'Отправьте { "backupKey": "backups/warehouse-pro-YYYY-MM-DD.sql.gz", "confirm": true }',
    }, 400);
  }

  if (!body.backupKey || !body.backupKey.startsWith("backups/")) {
    return c.json({ error: "Invalid backupKey — must start with backups/" }, 400);
  }

  // Audit log BEFORE restore
  const { recordAudit } = await import("./services/audit-log");
  await recordAudit(getDb(), {
    tenantId: auth.tenant.id,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "system.backup_restore_started",
    targetType: "database",
    meta: { backupKey: body.backupKey },
  });

  logger.warn("DATABASE RESTORE INITIATED", { userId: auth.user.id, backupKey: body.backupKey });

  const { restoreFromS3 } = await import("./services/db-restore");
  const result = await restoreFromS3(body.backupKey);

  // Audit log after restore
  await recordAudit(getDb(), {
    tenantId: auth.tenant.id,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: result.success ? "system.backup_restore_completed" : "system.backup_restore_failed",
    targetType: "database",
    meta: { backupKey: body.backupKey, success: result.success, message: result.message },
  });

  return c.json(result, result.success ? 200 : 500);
});

// ── Incremental backup: dump only rows changed since last full backup ─────
app.post("/api/admin/backup/incremental", async (c) => {
  let auth;
  try {
    auth = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (auth.user.role !== "superadmin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Default: changes since midnight today
  const sinceDate = new Date();
  sinceDate.setHours(0, 0, 0, 0);

  const { runIncrementalBackup } = await import("./services/db-incremental");
  const result = await runIncrementalBackup(sinceDate);

  return c.json(result, result.success ? 200 : 500);
});

// ── Cron: debt reminders ────────────────────────────────────────────────────
app.get("/api/cron/debt-reminders", async (c) => {
  if (!env.cronSecret) {
    return c.json({ error: "Cron endpoint not configured" }, 401);
  }
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  if (!safeEqual(secret ?? "", env.cronSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { runDebtReminders } = await import("./cron/debt-reminders");
  const result = await runDebtReminders();
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
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20, namespace: "login" };

app.post("/api/login", async (c) => {
  try {
    const { email, password } = await c.req.json();
    if (!email || !password) return c.json({ error: "Email and password required" }, 400);

    // Per account, read after the body so the address is available. Brute force
    // targets one account, so counting attempts against that account is both
    // the real defence and unspoofable — unlike a client-supplied IP header.
    // Counting them globally, as this did, meant twenty wrong passwords from
    // anyone locked every tenant out of the product for fifteen minutes.
    const subject = rateLimitSubject(c.req.raw, `email:${String(email).trim().toLowerCase()}`);
    if (!(await checkRateLimit(subject, LOGIN_RATE_LIMIT))) {
      return c.json({ error: "Too many login attempts. Please try again in 15 minutes." }, 429);
    }

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
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  if (!token) return c.json({ error: "No token" }, 401);

  // Rate limit: 5 per 15 minutes per session token. The caller already proved
  // possession of one, so it names the subject better than any header does.
  const subject = rateLimitSubject(c.req.raw, `token:${token.slice(-24)}`);
  if (!(await checkRateLimit(subject, { windowMs: 15 * 60 * 1000, limit: 5, namespace: "logout-all" }))) {
    return c.json({ error: "Too many requests. Try again later." }, 429);
  }

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

  // Backup status (lightweight — just reads in-memory state)
  let backupStatus = "unknown";
  try {
    const { lastBackup } = await import("./cron/backup");
    if (lastBackup) {
      const ageMs = Date.now() - new Date(lastBackup.date).getTime();
      const ageDays = Math.floor(ageMs / 86_400_000);
      backupStatus = lastBackup.success ? (ageDays <= 2 ? "ok" : `stale_${ageDays}d`) : "failed";
    }
  } catch { /* backup module not loaded */ }

  return c.json({
    status,
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    ts: Date.now(),
    env: env.isProduction ? "production" : "development",
    cache: cache.getStats(),
    database: dbHealthy ? "connected" : "disconnected",
    s3: s3Status,
    backup: backupStatus,
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

/**
 * Сколько ждать базу при запуске, прежде чем сдаться.
 *
 * Пять минут покрывают обычный перезапуск MySQL — он занимает секунды — и
 * оставляют запас на затяжной. Если база не вернулась и за это время, дело не
 * в перезапуске, и висеть дольше вредно: платформа так и не увидит рабочего
 * экземпляра, а причина останется незамеченной.
 */
const DB_STARTUP_WAIT_MS = 5 * 60_000;

/**
 * Дождаться, пока база начнёт отвечать.
 *
 * Проверка — самый дешёвый запрос, какой существует: важно отличить «сервер
 * принимает соединения» от «сервер поднялся, но ещё не готов». Пауза между
 * попытками растёт до пяти секунд, чтобы перезапускающаяся база не получила
 * шквал соединений в момент, когда ей тяжелее всего.
 *
 * Ошибка последней попытки пробрасывается наружу, а не заменяется своей: в ней
 * написано, что именно произошло — отказ в соединении, неверный пароль,
 * неизвестное имя узла, — и подменять это словами «база недоступна» значит
 * потерять единственную подсказку.
 */
export async function waitForDatabase(
  // Метод, а не поле с функцией: у настоящего drizzle execute перегружен, и
  // строгая проверка типов не пустила бы его в поле, объявленное через
  // стрелку. Здесь нужен лишь способ задать один запрос — форму базы целиком
  // требовать незачем, иначе тест не сможет подставить двойник.
  getDbFn: () => { execute(query: SQL): Promise<unknown> },
  maxWaitMs: number,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  now: () => number = Date.now,
): Promise<void> {
  const startedAt = now();
  let attempt = 0;

  for (;;) {
    try {
      await getDbFn().execute(sql`SELECT 1`);
      if (attempt > 0) {
        logger.info("database reachable again", { attempts: attempt + 1, waitedMs: now() - startedAt });
      }
      return;
    } catch (e) {
      attempt++;
      const waited = now() - startedAt;
      // Проверка «время вышло» стоит ПОСЛЕ попытки, а не до неё: иначе при
      // нулевом или крошечном лимите не случилось бы ни одного обращения к
      // базе, и запуск падал бы, ни разу её не спросив.
      if (waited >= maxWaitMs) throw e;
      const delay = Math.min(5_000, 500 * 2 ** Math.min(attempt - 1, 4));
      logger.warn("database not reachable yet — retrying", {
        attempt, waitedMs: waited, nextRetryInMs: delay,
        error: e instanceof Error ? e.message : String(e),
      });
      await sleep(delay);
    }
  }
}

/**
 * Назвать миграции, которые drizzle пропустил, не сказав об этом.
 *
 * Мигратор применяет только записи журнала, чья метка `when` больше самой
 * поздней уже применённой. Меткам полагается расти вместе с номером, но три
 * записи (0018, 0019, 0020) получили проставленные вручную даты из будущего —
 * у 0020 это 13 августа. После неё каждая миграция с меньшей меткой, то есть
 * ВСЕ с 0021 по 0038, пропускается молча и навсегда.
 *
 * Обнаружилось это тем, что супервайзер не мог создать план визита: колонка
 * daily_plans.visited_at из миграции 0038 в базе так и не появилась, а drizzle
 * перечисляет во вставке все колонки схемы, поэтому падала любая запись плана.
 * Схема при этом «держалась» ровно потому, что недостающее досыпали руками, —
 * и то, что досыпать забыли, вылезло через несколько дней и совсем в другом
 * месте.
 *
 * Проверка сравнивает журнал с таблицей __drizzle_migrations и пишет в лог
 * список нанесённых, но не записанных миграций. Она НЕ останавливает запуск:
 * сейчас незаписанными числятся и те, что применили руками, — падение на них
 * положило бы рабочий продукт ради предупреждения.
 */
async function reportSkippedMigrations(): Promise<void> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { getDb }    = await import("./queries/connection");
    const { sql }      = await import("drizzle-orm");

    const journal = JSON.parse(
      await readFile("./db/migrations/meta/_journal.json", "utf-8"),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };

    const [rows] = await getDb().execute(
      sql`SELECT created_at FROM __drizzle_migrations`,
    ) as unknown as [Array<{ created_at: number | string }>, unknown];
    const applied = new Set((rows ?? []).map(r => String(Number(r.created_at))));

    // 0038 не записана и записана не будет: её пропустили из-за метки из
    // будущего у 0020, а переписать её метку нельзя — файл содержит
    // `ADD COLUMN IF NOT EXISTS`, синтаксис MariaDB, который MySQL отвергнет и
    // остановит запуск. Её действие целиком перекрыто миграцией 0039. Держать
    // о ней вечное сообщение об ошибке значит приучить читателя пролистывать
    // этот лог — а он нужен именно для того, чтобы его читали.
    const superseded = new Set(["0038_daily_plans_visited_at"]);

    const missing = journal.entries
      .filter(e => !applied.has(String(e.when)) && !superseded.has(e.tag))
      .map(e => e.tag);

    if (missing.length > 0) {
      logger.error("МИГРАЦИИ НЕ ЗАПИСАНЫ КАК ПРИМЕНЁННЫЕ — схема может расходиться с кодом", {
        count: missing.length,
        migrations: missing,
        hint: "метки when в _journal.json должны строго расти; запись из будущего заставляет мигратор пропускать всё, что после неё",
      });
    }
  } catch (e) {
    // Проверка диагностическая: её собственный сбой не повод не запускаться.
    logger.warn("не удалось сверить журнал миграций с базой", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export default app;

if (env.isProduction) {
  const { serve }            = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { attachWebSocket }  = await import("./lib/ws");
  const { connectRedis }     = await import("./lib/redis");
  serveStaticFiles(app);

  // Bring the schema up to date before serving a single request.
  //
  // This used to be a `drizzle-kit migrate` step in the Dockerfile's CMD, but
  // railway.json sets its own startCommand, which silently replaced it — so
  // migrations never ran in production at all, and the schema was kept in
  // step by hand. Columns the code depended on went missing, which surfaced
  // as "Failed query" errors long after the deploy that introduced them.
  //
  // Running it in-process removes the possibility of that override: there is
  // no separate command to forget. drizzle-orm ships the migrator, so nothing
  // needs installing at boot either.
  //
  // A failure here stops the process. Serving against a schema the code does
  // not match is what caused the outages this replaces; a deploy that fails
  // loudly is recoverable, one that half-works is not.
  // Недоступная база и несовпадающая схема — разные беды, и путать их дорого.
  //
  // Отказ стартовать задуман против второй: схема, которой код не соответствует,
  // уже приводила к авариям, и деплой, упавший громко, лучше наполовину
  // работающего. Но под то же правило попадала и первая, а это просто «база
  // сейчас перезапускается». Процесс выходил с ошибкой за секунды, платформе
  // разрешено ограниченное число перезапусков, и они сгорали за минуту — после
  // чего приложение не поднималось само даже тогда, когда база возвращалась.
  // Именно так вышло 7 августа: база лежала около сорока минут.
  //
  // Поэтому сначала дожидаемся соединения, и только потом применяем миграции.
  // Ожидание конечно: если база не вернулась за отведённое время, выходим с
  // ошибкой, как раньше. Падение самой миграции по-прежнему останавливает
  // запуск немедленно, без единой повторной попытки — повторять сломанный SQL
  // бессмысленно, и растянутое ожидание только спрячет причину.
  try {
    const { getDb } = await import("./queries/connection");
    await waitForDatabase(getDb, DB_STARTUP_WAIT_MS);
  } catch (e) {
    logger.error("database unreachable at startup — refusing to start", {
      waitedMs: DB_STARTUP_WAIT_MS,
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }

  try {
    const { migrate } = await import("drizzle-orm/mysql2/migrator");
    const { getDb } = await import("./queries/connection");
    await migrate(getDb(), { migrationsFolder: "./db/migrations" });
    logger.info("database migrations up to date");
    await reportSkippedMigrations();
  } catch (e) {
    logger.error("database migration failed — refusing to start", {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }

  // P1-6 FIX: Connect Redis on startup for multi-instance support
  await connectRedis();
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info("server started", { port, version: APP_VERSION });
  });
  attachWebSocket(server);
  logger.info("websocket attached");

  // Notify superadmin about server start
  try {
    const { notifyAdmin } = await import("./telegram-router");
    await notifyAdmin(`🟢 <b>Сервер запущен</b>\n📦 v${APP_VERSION}\n🔌 Port ${port}`);
  } catch { /* Telegram not configured */ }

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

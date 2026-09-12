/**
 * Трассировка. До этой правки initTelemetry не вызывался нигде: модуль был
 * написан и мёртв, задавать OTEL_EXPORTER_OTLP_ENDPOINT можно было сколько
 * угодно. Почему промежутки ставятся руками, а не автоматической подменой,
 * подробно разобрано в api/lib/telemetry.ts.
 */
import { initTelemetry, shutdownTelemetry, isTracingEnabled, getTracer } from "./lib/telemetry";
initTelemetry();

import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { logger as honoLogger } from "hono/logger";
import type { HttpBindings } from "@hono/node-server";
import { env } from "./lib/env";
import { registerStripeWebhook } from "./webhooks/stripe";
import onecWebhooks from "./webhooks/onec";
import alertmanagerWebhook from "./webhooks/alertmanager";
import { telegramBot } from "./telegram/bot";
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
import { noteStaleAssetHit } from "./lib/deploy-signals";
import { logError } from "./lib/error-log";
import { safeEqual } from "./lib/safe-compare";
import { isAppError } from "@contracts/errors";
import {
  getMetricsText,
  prometheusContentType,
  httpRequestsTotal,
  clientRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestsActive,
  httpRequestErrorsTotal,
} from "./prometheus-metrics";


import * as Sentry from "@sentry/node";
import backupRoutes from "./http/backup";
import authRoutes from "./http/auth";
import trpcAdapter from "./http/trpc-adapter";

const APP_VERSION = "1.0.0";

/**
 * Разбор x-client-version: «web/1.4.2» или «mobile/2.0.1». Всё, что не
 * похоже на это, — unknown: метка из произвольной строки раздула бы метрику.
 */
export function clientVersionOf(header: string | undefined): { client: string; version: string } {
  const m = /^(web|mobile)\/([0-9A-Za-z.+-]{1,32})$/.exec((header ?? "").trim());
  return m ? { client: m[1], version: m[2] } : { client: "unknown", version: "unknown" };
}


/*
  Sentry — про ошибки. Трассировка у нас своя, в Jaeger.

  ── Что было в логе ─────────────────────────────────────────────────────────

  При каждом запуске сервер писал:

      Error: @opentelemetry/api: Attempted duplicate registration of API: trace
        at registerGlobalTracerProvider (@sentry/node/.../initOtel.js)

  Строкой 8 initTelemetry() поднимает наш OpenTelemetry и регистрирует
  глобального поставщика трасс — того, что шлёт промежутки в Jaeger. Следом
  Sentry.init поднимал СВОЙ OpenTelemetry и пытался зарегистрировать своего
  поставщика поверх. OpenTelemetry второго не принимает: пишет ошибку и
  оставляет первого.

  То есть трассировка Sentry не работала ни дня — её просто не пускали. И
  tracesSampleRate, стоявший здесь, не делал ничего: сэмплировать было нечего.
  Настройка выглядела включённой, а была мёртвой — тот же род дефекта, что и
  проверка подписки, написанная и не вызванная ниоткуда.

  ── Почему так, а не наоборот ───────────────────────────────────────────────

  Развести их можно было двумя способами: отдать трассы Sentry или оставить их
  себе. Оставляем себе. У платформы уже стоит свой стек наблюдения — Jaeger,
  Prometheus, Loki, Grafana, — и трассы идут туда. Дублировать их в Sentry
  значило бы платить за второй экземпляр того же и связывать порядок запуска
  двух систем ради этого.

  skipOpenTelemetrySetup говорит Sentry: OpenTelemetry настроен, не трогай.
  Ошибки, релизы и хлебные крошки он собирает по-прежнему; промежутков не
  создаёт — их создаёт наш слой, и они уходят в Jaeger.
*/
Sentry.init({
  dsn: env.sentryDsn || undefined,
  environment: env.isProduction ? "production" : "development",
  skipOpenTelemetrySetup: true,
  debug: !env.isProduction,
  // Не APP_VERSION: та зашита в код числом «1.0.0» и одинакова во всех
  // выкладках — по ней нельзя сказать, какая из них сломалась. Здесь
  // отпечаток коммита, тот же, что у браузерной части.
  release: env.sentryRelease || APP_VERSION,
  sendDefaultPii: false,
});

/*
  Последняя линия защиты процесса.

  Node 22 завершает процесс на необработанном отказе промиса. Обработчиков
  здесь не было, и любой `void something()` без catch — тик планировщика при
  недоступной базе, забытое уведомление — ронял всё приложение для всех
  организаций разом, а в журнале оставалась одна строка стека без контекста.

  Отказ промиса — пишем и живём дальше: состояние процесса не повреждено,
  упала одна ветка. Исключение вне промиса — состояние неизвестно, поэтому
  пишем, досылаем в Sentry и выходим с кодом 1: Railway перезапустит, а в
  журнале останется причина, а не тишина.
*/
process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error("unhandled promise rejection", { error: error.message, stack: error.stack });
  Sentry.captureException(error);
});
process.on("uncaughtException", (error) => {
  logger.error("uncaught exception, exiting", { error: error.message, stack: error.stack });
  Sentry.captureException(error);
  void Sentry.flush(2000).finally(() => process.exit(1));
});

const app = new Hono<{ Bindings: HttpBindings }>();

// ── Response compression ─────────────────────────────────────────────────────
// Must be the outermost middleware so it wraps every body: JS/CSS bundles and
// tRPC JSON alike. text/event-stream is excluded by the middleware itself, so
// the SSE endpoint keeps streaming uncompressed.
app.use("*", compress());

// ── Prometheus metrics collection ────────────────────────────────────────────
// Wraps every request so /metrics reflects the whole app, including requests
// that later throw. Kept close to the outermost middleware so the measured
// duration is as close as possible to what a client actually observed.
if (env.prometheusEnabled) {
  app.use("*", async (c, next) => {
    const method = c.req.method;
    httpRequestsActive.inc();
    const endTimer = httpRequestDurationSeconds.startTimer();

    try {
      await next();
    } finally {
      /**
       * Шаблон маршрута известен только ПОСЛЕ next().
       *
       * До вызова c.req.routePath отдаёт шаблон самого промежуточного слоя,
       * то есть "/*" — и это правда для любого запроса, а не только для
       * непойманных. Пока ярлык брался до next(), все запросы приложения
       * слипались в одну строку path="/*": в Grafana выходил один график на
       * всё приложение, и увидеть, какая именно ручка тормозит или сыплет
       * ошибками, было нельзя — то есть разбивки, ради которой всё это и
       * заводилось, не существовало.
       *
       * Запасного варианта c.req.path здесь намеренно нет. Сырой путь развёл
       * бы по отдельной временной строке каждый запрос: /wp-admin, /.env и
       * прочее, чем сканеры перебирают публичный сайт. Непойманные запросы
       * остаются под общим "/*" — их объём виден, а память не растёт.
       */
      const path = c.req.routePath ?? "/*";
      const status = String(c.res?.status ?? 500);

      endTimer({ method, path, status });
      httpRequestsTotal.inc({ method, path, status });
      // Только запросы приложения: сканеры и статика версией не подписаны.
      if (path.startsWith("/api/")) clientRequestsTotal.inc(clientVersionOf(c.req.header("x-client-version")));
      if (Number(status) >= 500) httpRequestErrorsTotal.inc({ method, path, status });
      httpRequestsActive.dec();
    }
  });
}

// ── Трассировка запроса ──────────────────────────────────────────────────────
// Один промежуток на запрос. Имя и атрибуты проставляются ПОСЛЕ next() по той
// же причине, что и ярлыки метрик: до вызова c.req.routePath отдаёт шаблон
// самого слоя ("/*"), а не маршрута, который в итоге отработал.
if (isTracingEnabled()) {
  app.use("*", async (c, next) => {
    const span = getTracer().startSpan("http");
    try {
      await next();
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      const path = c.req.routePath ?? "/*";
      const status = c.res?.status ?? 500;
      span.updateName(`${c.req.method} ${path}`);
      span.setAttributes({
        "http.request.method": c.req.method,
        "http.route": path,
        "http.response.status_code": status,
        // По нему та же история находится в журнале Loki: трассировка
        // показывает, ЧТО было медленным, журнал — почему.
        "app.correlation_id": c.res?.headers.get("x-correlation-id") ?? "",
      });
      span.end();
    }
  });
}

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
        // Без почты: рядом объявлено sendDefaultPii: false, и отправлять её
        // вопреки этому нельзя. Идентификатора и организации достаточно —
        // человек находится по ним в своей же базе.
        scope.setUser({ id: String(authUser.id) });
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
    // Ошибка — это 5xx. Тем же правилом считают Prometheus (см.
    // httpRequestErrorsTotal) и тревоги; до этого страница мониторинга
    // расходилась с ними и показывала 1,8% на исправной системе.
    recordRequest(ms, c.res.status >= 500);
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
  allowHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning", "x-correlation-id", "x-csrf-token", "x-client-version", "Last-Event-ID"],
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
// Второй канал тревог: AlertManager → уведомления и push суперадминам.
app.route("/api/webhooks/alertmanager", alertmanagerWebhook);

/*
  Телеграм-бот.

  Раньше этот вебхук объявлялся в api/cron/telegram-ai-bot.ts и НИКУДА не
  подключался: в бою POST /api/webhooks/telegram отвечал 404, то есть бот не
  работал ни дня. Молча не работала и кнопка «связать Telegram одним
  нажатием» — ссылка вела к боту, которому некому было ответить.
*/
app.route("/", telegramBot);

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

// ── Резервные копии: крон и скачивание дампа — api/http/backup.ts ──────────
app.route("/", backupRoutes);

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

/*
  ── Cron: телеграм ──────────────────────────────────────────────────────────

  Две ручки той же формы, что и остальные кроны: ключ в запросе, работа внутри.

  Разбор очереди зовётся часто (раз в несколько минут): в ней лежит то, что
  пришло ночью и ждёт восьми утра. Сводка — раз в день вечером; час выбирает
  расписание снаружи, а не код, чтобы её можно было позвать руками и проверить,
  не дожидаясь вечера.
*/
const cronGuard = (c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }) => {
  if (!env.cronSecret) return "Cron endpoint not configured";
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  return safeEqual(secret ?? "", env.cronSecret) ? null : "Unauthorized";
};

app.get("/api/cron/telegram-outbox", async (c) => {
  const denied = cronGuard(c);
  if (denied) return c.json({ error: denied }, 401);
  const { drainOutbox } = await import("./services/telegram-notify");
  return c.json(await drainOutbox());
});

app.get("/api/cron/telegram-digest", async (c) => {
  const denied = cronGuard(c);
  if (denied) return c.json({ error: denied }, 401);
  const { runTelegramDigest } = await import("./cron/telegram-digest");
  return c.json(await runTelegramDigest());
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
  } catch (e) {
    if (!isAppError(e)) return c.json({ error: "Не удалось проверить сессию" }, 503);
    return c.json({ error: "Unauthorized" }, 401);
  }
});

// ── Вход/выход/обновление сессии — api/http/auth.ts ───────────────────────
app.route("/", authRoutes);

// ── Prometheus scrape endpoint ───────────────────────────────────────────────
// Public by design — Prometheus scrapers don't carry session cookies or CSRF
// tokens. PROMETHEUS_METRICS_TOKEN is optional extra protection: when set, the
// scraper must send it as a Bearer token or ?token= query param. Left unset by
// default so the endpoint keeps working out of the box against an internal
// Prometheus that Railway's networking already keeps off the public internet.
app.get("/metrics", async (c) => {
  if (!env.prometheusEnabled) {
    return c.json({ error: "Not Found" }, 404);
  }
  /**
   * Без ключа в рабочей среде ручка не открывается вовсе.
   *
   * Приложение отвечает на публичном домене, а не во внутренней сети: всё,
   * что здесь отдаётся, был бы доступно любому желающему — перечень
   * маршрутов, объёмы трафика по каждому, доли ошибок, время ответа, память,
   * задержка цикла событий и версия Node. Это и разведка для нападающего, и
   * сведения о делах компании.
   *
   * Отвечаем 404, а не 401: существование ручки тоже не стоит подтверждать.
   */
  if (env.isProduction && !env.prometheusMetricsToken) {
    return c.json({ error: "Not Found" }, 404);
  }
  if (env.prometheusMetricsToken) {
    /*
      Ключ — только заголовком. Запасной приём из адреса (?token=) снят: адрес
      оседает в журналах прокси, а это долгоживущий общий секрет. Prometheus и
      так шлёт его как Bearer (docs/observability/prometheus.yml), так что
      запасной путь никого не обслуживал — только расширял поверхность.
    */
    const authHeader = c.req.header("authorization");
    const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
    if (!provided || !safeEqual(provided, env.prometheusMetricsToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  const metrics = await getMetricsText();
  return c.text(metrics, 200, { "Content-Type": prometheusContentType });
});

// ── tRPC handler — api/http/trpc-adapter.ts ──────────────────────────────
app.route("/", trpcAdapter);

/* ── Что считать ошибкой ─────────────────────────────────────────────────────

   В журнал ошибок писался ЛЮБОЙ ответ от 400 и выше, и он же шёл в долю
   ошибок на странице мониторинга. От этого журнал состоял из чужих неудач, а
   не из наших:

     · после каждой выкладки вкладки, оставшиеся на прежней сборке, просят
       свои куски приложения по старым именам с хэшем — и получают 404
       десятками подряд. Приложение это умеет чинить само
       (isStaleChunkError → recoverFromStaleApp), человек ничего не замечает;
     · 401 приходит на каждое обращение без входа, включая проверки снаружи;
     · 403 — это отработавшая защита, а не поломка.

   Ни одно из этого не значит «сервер сломан», а вместе они топят те немногие
   строки, ради которых журнал и открывают. Доля ошибок при этом показывала
   1,8% на исправной системе — и по такому числу нельзя понять ничего.

   Правило теперь совпадает с тем, по которому уже считают Prometheus и
   тревоги в AlertManager: ошибка — это 5xx, наша вина. Остальное либо не
   записывается, либо записывается отдельно и без тревоги.
   ────────────────────────────────────────────────────────────────────────── */

/** Кусок приложения с хэшем в имени: /assets/Shops-BYCKANnN.js */
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.(js|css|map)$/;

app.use("*", async (c, next) => {
  await next();
  const status = c.res.status;
  if (status < 400) return;

  /*
    Вкладка на прежней сборке — не ошибка, а событие выкладки. Считаем их
    отдельно: число само по себе полезно (видно, что выкладка прошла и люди
    ещё на старом), а в журнал ошибок ему нельзя.
  */
  if (status === 404 && HASHED_ASSET.test(c.req.path)) {
    noteStaleAssetHit();
    return;
  }

  // Отказ входа и отказ прав — не поломка. Их разбирают по журналу обращений,
  // где они и так есть со всеми подробностями.
  if (status === 401 || status === 403) return;

  if (status >= 500) {
    logError({
      message: `HTTP ${status}`,
      code: `HTTP_${status}`,
      path: c.req.path,
      method: c.req.method,
      statusCode: status,
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
      const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
      /*
        Клиент общий. Прежний создавался здесь БЕЗ ключей — проверка бакета
        уходила без подписи и на закрытом бакете всегда падала, то есть
        показывала «error» на исправно настроенном хранилище.
      */
      const { s3Client } = await import("./lib/s3");
      const s3 = await s3Client();
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

    /**
     * Миграции, которые числятся применёнными по факту, а не по журналу.
     *
     * До 1 сентября 2026 таких было пять: 0018, 0019, 0020, 0035 и 0038. Все
     * пятеро начинались со строки с синтаксисом MariaDB, MySQL её отвергал, и
     * выполнение обрывалось; действие достигалось позже другими миграциями.
     *
     * Сейчас набор пуст. Историю из 51 файла свернули в один baseline,
     * собранный из db/schema.ts, и его метка времени равна метке прежней
     * 0000_baseline — той, что уже записана в __drizzle_migrations на бою.
     * Значит на боевой базе он числится применённым и пропускается, а на
     * чистой строит схему целиком. Прежние файлы лежат в db/migrations-archive
     * и мигратором не читаются.
     *
     * Набор оставлен намеренно: он ещё понадобится, если однажды опять
     * появится миграция, применённая руками мимо журнала. Проверка ниже
     * продолжает работать в полную силу.
     */
    const superseded = new Set<string>([]);

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

  // Что догнал catchUpMigrations — уходит суперадмину вместе с «сервер запущен».
  let caughtUp: string[] = [];
  try {
    const { migrate } = await import("drizzle-orm/mysql2/migrator");
    const { getDb } = await import("./queries/connection");
    const { withMigrationLock } = await import("./lib/migration-lock");
    const db = getDb();

    /**
     * Миграции применяются под общим замком.
     *
     * Пока реплика одна, он ничего не меняет. Со второй начинается гонка: при
     * выкладке обе стартуют разом, обе читают одно состояние журнала миграций
     * и обе принимаются за один и тот же DDL. Проигравшая получает «Table
     * already exists», а это здесь означает немедленный выход — и правильно
     * означает, но выходит она из-за соседа, а не из-за поломки.
     *
     * Платформа её перезапустит, и со второй попытки миграции уже применены.
     * Однако каждая такая выкладка тратит попытки из отведённого числа
     * перезапусков, а при неудачном стечении их не остаётся вовсе.
     *
     * Замок живёт в самой базе (GET_LOCK), а не в Redis: он обязан быть там
     * же, где данные, которые защищает. Redis необязателен и может быть общим
     * для нескольких сред.
     */
    const { catchUpMigrations, isAlreadyThere } = await import("./lib/migration-catchup");

    await withMigrationLock(db.$client as never, async () => {
      /*
        Файл из нескольких выражений, оборванный на середине прошлой выкладкой
        (DDL в MySQL не откатывается), при следующем запуске падает на первом
        же выражении с «колонка уже есть» — и так на каждом запуске, навсегда.
        Это не поломка схемы, а полпути к ней: пусть догон ниже доведёт файл,
        прощая ровно то, что уже сделано. Любая другая ошибка — по-прежнему
        отказ старта.
      */
      try {
        await migrate(db, { migrationsFolder: "./db/migrations" });
      } catch (e) {
        if (!isAlreadyThere(e)) throw e;
        logger.warn("штатный мигратор споткнулся об «уже есть» — файл применён наполовину; догон доведёт его", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      /*
        Догон — под тем же замком и сразу за штатным мигратором.

        Штатный сверяет журнал с ОДНОЙ строкой — самой поздней по created_at, —
        и запись с меткой из будущего навсегда глушит всё, что после неё. Он при
        этом рапортует об успехе. Так пропали 0007, 0008 и 0009: страница зарплат
        отвечала «Внутренняя ошибка сервера», в логе стояло «Unknown column
        delivery_rate», а строкой выше — «database migrations up to date».

        Проверка ниже (reportSkippedMigrations) знала об этом и раньше, но умела
        только назвать пропущенных. Теперь их применяют.
      */
      try {
        caughtUp = await catchUpMigrations(db as never);
      } catch (e) {
        /*
          Провал догона запуск НЕ останавливает — в отличие от штатного
          мигратора выше, и разница принципиальная.

          Штатный применяет то, чего требует НОВЫЙ код: не применилось —
          работать нельзя. Догон применяет старое, пропущенное; его неудача
          означает «осталось как было», то есть ровно то состояние, в котором
          продукт только что работал. Уронить из-за неё весь продукт значит
          сделать хуже, чем было до попытки починки.

          Именно это и случилось на первой выкладке догона: он споткнулся на
          0007 и увёл в отказ старта весь сервис — вместо одной сломанной
          страницы стало ноль работающих.
        */
        logger.error("догон миграций не удался — продолжаю запуск на прежней схеме", {
          error: e instanceof Error ? e.message : String(e),
          hint: "часть экранов может отвечать ошибкой, пока расхождение не устранено",
        });
      }
    });

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
    // Суперадмину: выкладка встала (или сервер перезапустился — это тоже
    // новость), и какие миграции при этом догнали.
    void import("./telegram-router")
      .then(({ notifyAdmin, tgMessages }) => notifyAdmin(tgMessages.serverUp(env.sentryRelease || APP_VERSION, caughtUp)))
      .catch(() => { /* Telegram не настроен — молчим */ });
  });
  /*
    WebSocket здесь больше нет — и не потому, что мешал.

    Сервер поднимал канал, принимал JWT строкой запроса (?token=…) и клал
    координаты агентов. Клиента у канала не было НИ ОДНОГО: веб его не
    открывает, мобильное приложение шлёт координаты через agent.saveLocation по
    tRPC, в комнаты арендаторов никто не писал, стражей в тестах не стояло.
    Написан и не вызван ниоткуда — как вебхук бота, кроны и погрузочные листы.

    Мёртвый вход, принимающий токен из адреса, — это не «неиспользуемая
    функция», а поверхность атаки: адрес с JWT оседает в логах прокси. Аудит
    безопасности нашёл именно это; лечение — не переносить токен в заголовок
    для клиента, которого нет, а убрать вход. Понадобится живой канал — его
    заведут заново под текущий способ входа, а не унаследуют этот.
  */

  /*
    Подписка бота на вебхук. Не ждём её: сеть до Telegram может лежать ровно в
    момент выкладки, а приложение без бота работает.
  */
  void import("./telegram/register").then(m => m.registerTelegramWebhook());

  /*
    Меню команд — рядом с подпиской и по той же причине.

    Подписка решает, ДОЙДЁТ ли сообщение до нас; меню — узнает ли человек,
    что вообще можно спросить. Обе задачи молчаливые: ошибка в любой выглядит
    одинаково — «бот не работает», — и обе поэтому делаются сами при старте, а
    не разовой командой, которая живёт до первого переезда.
  */
  void import("./telegram/commands").then(m => m.registerTelegramCommands());

  /*
    Расписание работ.

    До этого ни одна работа по расписанию не запускалась НИ РАЗУ: ручки
    /api/cron/* написаны и закрыты ключом, но вызывать их было некому — по
    счётчикам Prometheus за всё время наблюдения там ноль запросов. Значит не
    уходили напоминания о долгах, об окончании пробного периода, и не делалась
    ночная копия базы.
  */
  void import("./cron/scheduler").then(m => m.startScheduler());

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    server.close(() => {
      logger.info("HTTP server closed");
    });
    // Дослать остаток журнала и закрыть трассировку до ухода процесса: иначе
    // теряются ровно те записи, ради которых в журнал и лезут после падения.
    try {
      const { shutdownLoki } = await import("./lib/loki");
      await shutdownLoki();
      await shutdownTelemetry();
    } catch (e) {
      logger.error("Error flushing observability", { error: String(e) });
    }

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

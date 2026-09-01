import "dotenv/config";
import { randomBytes } from "node:crypto";

/**
 * Обязательная переменная окружения.
 *
 * ── Почему запасное значение случайное ─────────────────────────────────────
 *
 * Раньше оно было постоянным: `dev-insecure-app-secret`. Строка лежит в
 * общедоступном репозитории, а именно ею подписывается сессионный ключ на
 * тридцать дней. Кто её знает, тот кует действительную сессию для любого
 * пользователя — достаточно подобрать его номер.
 *
 * От рабочей среды защищает выход из процесса ниже, а NODE_ENV=production
 * зашит и в образ, и в docker-compose, и в команду запуска. Но эта защита —
 * одно совпадение строки. Приложение, поднятое ВНЕ образа (скажем, node
 * dist/boot.js под systemd на голом сервере), получает NODE_ENV пустым, и
 * если APP_SECRET там тоже забыли — подпись сессий идёт общеизвестным
 * ключом, и предупреждение об этом мелькает один раз при старте.
 *
 * Случайное значение убирает саму возможность: общеизвестного ключа больше
 * не существует. Плата — при перезапуске без APP_SECRET все сессии
 * разработчика становятся недействительны. Это не помеха, а подсказка
 * задать переменную: и README, и .env.example об этом просят.
 *
 * Приставка dev-insecure сохранена: по ней значение узнаётся в журнале и в
 * защитных проверках вроде mailer.ts.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[FATAL] Missing required environment variable: ${name}`);
      process.exit(1);
    }
    console.warn(
      `[WARN] Нет переменной ${name} — взято случайное значение на этот запуск. ` +
      "Сессии не переживут перезапуск; задайте переменную в .env.",
    );
    return `dev-insecure-${name.toLowerCase().replace(/_/g, "-")}-${randomBytes(24).toString("base64url")}`;
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Core
  appSecret:            required("APP_SECRET"),
  databaseUrl:          required("DATABASE_URL"),
  appUrl:               optional("APP_URL", "http://localhost:3000"),
  isProduction:         process.env.NODE_ENV === "production",
  allowedOrigins:       optional("ALLOWED_ORIGINS").split(",").filter(Boolean),
  port:                 parseInt(optional("PORT", "3000"), 10),

  // Database
  dbConnectionLimit:    parseInt(optional("DB_CONNECTION_LIMIT", "20"), 10),

  // Cache
  cacheMaxEntries:      parseInt(optional("CACHE_MAX_ENTRIES", "500"), 10),
  cacheDefaultTtlMs:    parseInt(optional("CACHE_DEFAULT_TTL_MS", "60000"), 10),

  // Rate limiting
  rateLimitGlobalMax:   parseInt(optional("RATE_LIMIT_GLOBAL_MAX", "120"), 10),
  rateLimitWindowMs:    parseInt(optional("RATE_LIMIT_WINDOW_MS", "60000"), 10),

  // Stripe
  stripeSecretKey:        optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret:    optional("STRIPE_WEBHOOK_SECRET"),
  stripeBasicPriceId:     optional("STRIPE_BASIC_PRICE_ID"),
  stripeProPriceId:       optional("STRIPE_PRO_PRICE_ID"),
  stripeExclusivePriceId: optional("STRIPE_EXCLUSIVE_PRICE_ID"),

  // SMTP
  smtpHost:    optional("SMTP_HOST"),
  smtpPort:    parseInt(optional("SMTP_PORT", "587"), 10),
  smtpUser:    optional("SMTP_USER"),
  smtpPass:    optional("SMTP_PASS"),
  smtpFrom:    optional("SMTP_FROM", "noreply@warehousepro.app"),

  // Cron secret (protects cron endpoints)
  cronSecret:  optional("CRON_SECRET"),

  // Telegram
  telegramBotToken:    optional("TELEGRAM_BOT_TOKEN"),
  telegramAdminChatId: optional("TELEGRAM_ADMIN_CHAT_ID"),

  // S3 / File storage (for logo uploads in production)
  s3Bucket:     optional("S3_BUCKET"),
  s3Region:     optional("S3_REGION"),
  s3AccessKey:  optional("S3_ACCESS_KEY"),
  s3SecretKey:  optional("S3_SECRET_KEY"),

  // 1C Bridge
  oneCBridgeUrl:       optional("ONEC_BRIDGE_URL"),
  oneCUsername:        optional("ONEC_USERNAME"),
  oneCPassword:        optional("ONEC_PASSWORD"),
  onecWebhookSecret:   optional("ONEC_WEBHOOK_SECRET"),

  // Redis
  redisUrl:            optional("REDIS_URL"),

  // OpenTelemetry
  otelExporterUrl:     optional("OTEL_EXPORTER_OTLP_ENDPOINT"),

  // Loki — журнал уходит туда вдобавок к stdout, а не вместо него
  lokiUrl:             optional("LOKI_URL"),
  lokiBasicAuth:       optional("LOKI_BASIC_AUTH"),

  // Sentry
  sentryDsn:           optional("SENTRY_DSN"),
  // Версия выкладки. Та же, что у браузерной части и у карт кода: иначе
  // ошибки сервера и браузера лягут в Sentry под разными релизами, и связать
  // одно с другим будет нечем.
  sentryRelease:       optional("SENTRY_RELEASE") || optional("RAILWAY_GIT_COMMIT_SHA"),

  // Prometheus metrics (/metrics endpoint)
  prometheusEnabled:   optional("PROMETHEUS_ENABLED", "true") !== "false",
  prometheusMetricsToken: optional("PROMETHEUS_METRICS_TOKEN"),
} as const;

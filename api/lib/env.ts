import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[FATAL] Missing required environment variable: ${name}`);
      process.exit(1);
    }
    console.warn(`[WARN] Missing env var ${name} — using insecure default (dev only)`);
    return `dev-insecure-${name.toLowerCase().replace(/_/g, "-")}`;
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

  // Redis
  redisUrl:             optional("REDIS_URL"),

  // Cache (fallback for when Redis is unavailable)
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

  // OpenTelemetry
  otelExporterUrl:     optional("OTEL_EXPORTER_OTLP_ENDPOINT"),
} as const;

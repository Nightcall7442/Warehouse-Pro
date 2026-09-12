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
/*
   Пробелы по краям снимаются со ВСЕХ переменных.

   ── Что было ────────────────────────────────────────────────────────────────

   Пароль хранилища был вписан в панель Railway с лишним пробелом на конце —
   обычная опечатка при вставке. MinIO при чтении своей переменной пробелы
   обрезает, наш клиент S3 — нет. Значения выглядели одинаковыми до последнего
   символа: одна длина, один отпечаток, — а подпись не сходилась, и хранилище
   отвечало SignatureDoesNotMatch. Найти это можно было только сравнив оба
   значения побайтно.

   Так же молча ломается ЛЮБОЙ секрет, который сверяют посимвольно: ключ крона,
   секрет вебхука телеграма, токен метрик. Пробел на краю не значит ничего ни в
   одной переменной этого приложения — ни в адресе, ни в токене, ни в списке
   через запятую, — поэтому снимается один раз здесь, а не в каждом месте, где
   вспомнят.

   Внутренние переводы строк остаются: trim() трогает только края, и
   многострочное значение (ключ в формате PEM) не пострадает.
*/
function clean(value: string): string {
  return value.trim();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
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
  const value = process.env[name];
  return value === undefined ? fallback : clean(value);
}

export const env = {
  // Core
  appSecret:            required("APP_SECRET"),
  databaseUrl:          required("DATABASE_URL"),
  appUrl:               optional("APP_URL", "http://localhost:3000"),
  isProduction:         process.env.NODE_ENV === "production",
  allowedOrigins:       optional("ALLOWED_ORIGINS").split(",").filter(Boolean),

  // Database
  dbConnectionLimit:    parseInt(optional("DB_CONNECTION_LIMIT", "20"), 10),
  /** Потолок очереди за соединением пула; 0 — без предела (так было). */
  dbQueueLimit:         parseInt(optional("DB_QUEUE_LIMIT", "500"), 10),
  /** max_execution_time для SELECT, мс; 0 — без предела. */
  dbStatementTimeoutMs: parseInt(optional("DB_STATEMENT_TIMEOUT_MS", "30000"), 10),

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
  /*
    Секрет вебхука — отдельно от токена бота.

    Telegram присылает его заголовком в каждом входящем запросе. Ставить туда
    сам токен нельзя: токен даёт право писать от имени бота кому угодно, а
    заголовок виден всякому, кто окажется между Telegram и приложением. Плюс
    отдельную строку можно сменить, не перевыпуская бота.
  */
  telegramWebhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),

  // S3 / File storage (for logo uploads in production)
  s3Bucket:     optional("S3_BUCKET"),
  s3Region:     optional("S3_REGION"),
  s3AccessKey:  optional("S3_ACCESS_KEY"),
  s3SecretKey:  optional("S3_SECRET_KEY"),
  /*
    Свой адрес входа — для S3-совместимых хранилищ, которых не AWS.

    Пусто значит обычный Amazon. Заполнено — Cloudflare R2, Backblaze B2,
    Yandex Object Storage и прочие: протокол у них тот же, а домен свой.
  */
  s3Endpoint:   optional("S3_ENDPOINT"),
  /*
    По какому адресу файлы читают снаружи.

    Адрес входа и адрес чтения — разные вещи. У R2 в бакет пишут по
    <account>.r2.cloudflarestorage.com, а читают по выданному pub-….r2.dev или
    по своему домену. Собрать второй из первого нельзя.
  */
  s3PublicUrl:  optional("S3_PUBLIC_URL"),
  /** Имя бакета в пути, а не в поддомене. Нужно почти всем, кроме AWS. */
  s3ForcePathStyle: optional("S3_FORCE_PATH", "") !== "",

  /*
    Второе назначение ночной копии — ВНЕ площадки.

    Основное S3 — MinIO в том же проекте Railway, что и база: потерю доступа
    к проекту (спор об оплате, компрометация, ошибка поставщика) такая копия
    не переживает. Заполненный BACKUP_S3_ENDPOINT включает зеркало: дамп
    уходит и в MinIO, и сюда (R2/B2 — см. docs/deployment.md). Бакет — тот же
    S3_BACKUP_BUCKET по имени: заводить его на второй площадке тем же
    скриптом.
  */
  backupS3Endpoint:  optional("BACKUP_S3_ENDPOINT"),
  backupS3Region:    optional("BACKUP_S3_REGION", "auto"),
  backupS3AccessKey: optional("BACKUP_S3_ACCESS_KEY"),
  backupS3SecretKey: optional("BACKUP_S3_SECRET_KEY"),
  backupS3ForcePathStyle: optional("BACKUP_S3_FORCE_PATH", "") !== "",

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
  /*
    Загружаются ли карты кода. Здесь именно признак, а не сам ключ: значение
    секретное, а на страницу мониторинга уходит только «да» или «нет».
    Без карт стек в Sentry остаётся минифицированным — по нему искать нечего.
  */
  sentryMapsUploaded:  Boolean(optional("SENTRY_AUTH_TOKEN")),

  // Prometheus metrics (/metrics endpoint)
  /*
    Адреса служебных приборов — для страницы мониторинга.

    Публичный адрес и внутренний разведены намеренно. По публичному человек
    нажимает из браузера; по внутреннему приложение проверяет, жива ли служба.
    У Loki публичного нет и не должно быть: своей защиты у него нет вовсе, и с
    доменом боевые журналы читались из интернета обычным curl.

    Не заданная переменная означает «не настроено» — на экране это отдельное
    состояние, не «сломано».
  */
  grafanaUrl:              optional("GRAFANA_URL"),
  prometheusUrl:           optional("PROMETHEUS_URL"),
  prometheusInternalUrl:   optional("PROMETHEUS_INTERNAL_URL"),
  jaegerUrl:               optional("JAEGER_URL"),
  alertmanagerUrl:         optional("ALERTMANAGER_URL"),
  alertmanagerInternalUrl: optional("ALERTMANAGER_INTERNAL_URL"),
  sentryUrl:               optional("SENTRY_URL"),
  /** Имя источника данных Loki в Grafana — для ссылок в Explore. */
  grafanaLokiDatasource:   optional("GRAFANA_LOKI_DATASOURCE", "loki"),

  prometheusEnabled:   optional("PROMETHEUS_ENABLED", "true") !== "false",
  prometheusMetricsToken: optional("PROMETHEUS_METRICS_TOKEN"),
} as const;

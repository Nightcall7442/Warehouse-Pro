import { nanoid } from "nanoid";
import { AsyncLocalStorage } from "node:async_hooks";

type Level = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  userId?: number;
  tenantId?: number;
  path?: string;
  method?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

const SENSITIVE_KEYS = new Set([
  "password", "secret", "token", "authorization", "cookie",
  "appSecret", "app_secret", "stripeSecretKey", "stripe_secret_key",
  "smtpPass", "smtp_pass", "databaseUrl", "database_url",
  "s3AccessKey", "s3_secret_key", "s3SecretKey", "s3_access_key",
  "telegramBotToken", "telegram_bot_token",
]);

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(key) || [...SENSITIVE_KEYS].some(sk => lower.includes(sk.toLowerCase()))) {
      result[key] = typeof value === "string" ? "***" : undefined;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const ctx = storage.getStore();
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg: message,
  };
  if (ctx) {
    entry.correlationId = ctx.correlationId;
    if (ctx.userId) entry.userId = ctx.userId;
    if (ctx.tenantId) entry.tenantId = ctx.tenantId;
    if (ctx.path) entry.path = ctx.path;
    if (ctx.method) entry.method = ctx.method;
  }
  if (meta && Object.keys(meta).length > 0) {
    entry.meta = sanitize(meta);
  }
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info:  (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn:  (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

export function createRequestId(): string {
  return nanoid(12);
}

export function runWithLogContext(ctx: LogContext, fn: () => Promise<unknown>): Promise<unknown> {
  return storage.run(ctx, fn);
}

import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { Role } from "@contracts/types";
import { env } from "./lib/env";
import { checkSubscriptionAccess } from "./lib/feature-gating";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";

// ── Translate ZodError codes into user-friendly Russian messages ─────────────
const FIELD_LABELS: Record<string, string> = {
  name: "Название", code: "Код", phone: "Телефон", email: "Email",
  password: "Пароль", orgName: "Название организации", ownerName: "Имя владельца",
  category: "Категория", description: "Описание", city: "Город",
  district: "Район", address: "Адрес", barcode: "Штрихкод",
  unitPrice: "Цена продажи", costPrice: "Себестоимость",
  unit: "Единица измерения", unitWeight: "Вес", reorderPoint: "Порог дозаказа",
  photoUrl: "Фото", dataUrl: "Фото", base64: "Файл", filename: "Имя файла",
  type: "Тип", title: "Заголовок", message: "Сообщение", notes: "Заметки",
  role: "Роль", status: "Статус", debt: "Долг",
};

function friendlyFieldName(path: (string | number)[]): string {
  const last = String(path[path.length - 1] ?? "");
  return FIELD_LABELS[last] ?? last;
}

/** Handle ZodError from tRPC input validation — convert to friendly Russian messages */
function translateZodErrorFromCause(cause: unknown): string | null {
  if (!cause || typeof cause !== "object") return null;
  const obj = cause as Record<string, unknown>;
  // ZodError has an `issues` array
  if (!Array.isArray(obj.issues)) return null;

  const issues = obj.issues as Array<{
    code: string; path: (string | number)[];
    minimum?: number; maximum?: number;
    message: string; type?: string;
    received?: string; options?: string[];
  }>;

  const messages: string[] = [];
  for (const issue of issues) {
    const field = friendlyFieldName(issue.path);

    if (issue.code === "too_small" && issue.minimum !== undefined) {
      if (issue.type === "string") {
        messages.push(`«${field}» должно содержать минимум ${issue.minimum} ${issue.minimum === 1 ? "символ" : "символа"}`);
      } else {
        messages.push(`«${field}» должно быть не менее ${issue.minimum}`);
      }
    } else if (issue.code === "too_big" && issue.maximum !== undefined) {
      messages.push(`«${field}» слишком длинное (макс. ${issue.maximum} символов)`);
    } else if (issue.code === "invalid_type") {
      if (issue.received === "undefined" || issue.received === "null") {
        messages.push(`Поле «${field}» обязательно для заполнения`);
      } else {
        messages.push(`Неверный формат поля «${field}»`);
      }
    } else if (issue.code === "invalid_enum_value") {
      messages.push(`Неверное значение «${field}». Допустимые варианты: ${issue.options?.join(", ") ?? "проверьте форму"}`);
    } else if (issue.message) {
      messages.push(issue.message);
    }
  }
  return messages.length > 0 ? messages.join(". ") : null;
}

/** Fallback: match ZodError text patterns in the error message string */
function translateZodError(zodMsg: string): string {
  const msg = zodMsg.toLowerCase();
  if (/too_small.*string.*have >=\s*2/.test(msg)) {
    return "Поле должно содержать минимум 2 символа";
  }
  if (/too_small.*string.*have >=\s*1/.test(msg)) {
    return "Поле не может быть пустым";
  }
  if (/too_small.*number.*have >=\s*1/.test(msg)) {
    return "Значение должно быть не менее 1";
  }
  if (/too_big.*string.*have <=\s*(\d+)/.test(msg)) {
    const m = msg.match(/have <=\s*(\d+)/);
    return `Поле слишком длинное (максимум ${m?.[1] ?? ""} символов)`;
  }
  if (/invalid_type.*received.*undefined/.test(msg) || /required/.test(msg)) {
    return "Обязательное поле не заполнено";
  }
  if (/invalid_type.*received.*number/.test(msg)) {
    return "Ожидалось числовое значение";
  }
  if (/invalid_type.*received.*string/.test(msg)) {
    return "Ожидался текст";
  }
  if (/invalid_enum_value|invalid_value.*options/.test(msg)) {
    return "Выбрано недопустимое значение";
  }
  if (/invalid_email|not a valid email/.test(msg)) {
    return "Некорректный email";
  }
  if (/too_small/.test(msg)) {
    return "Значение слишком маленькое";
  }
  if (/too_big/.test(msg)) {
    return "Значение слишком большое";
  }
  if (/invalid_string/.test(msg)) {
    return "Некорректное значение";
  }
  if (/not.*valid/.test(msg)) {
    return "Некорректное значение поля";
  }
  // Match human-readable Zod messages
  if (/too small/.test(msg)) return "Значение слишком маленькое";
  if (/too long/.test(msg)) return "Значение слишком длинное";
  if (/expected/.test(msg) && /received/.test(msg)) return "Неверный формат данных";
  return "Проверьте правильность заполнения полей";
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    let message = isInternal && env.isProduction
      ? "Внутренняя ошибка сервера. Попробуйте позже."
      : shape.message;

    // Translate ZodError to user-friendly text
    // First try: parse structured issues from error.cause (most reliable)
    const zodFriendly = translateZodErrorFromCause(error.cause);
    if (zodFriendly) {
      message = zodFriendly;
    } else if (message && (
      message.includes("ZodError") || message.includes("too_small") ||
      message.includes("too_big") || message.includes("invalid_type") ||
      message.includes("invalid_string") || message.includes("required") ||
      message.includes("Expected") || message.includes("received") ||
      message.includes("Too small") || message.includes("Too long")
    )) {
      // Fallback: pattern-match the message string
      message = translateZodError(message);
    }

    return {
      ...shape,
      message,
      data: {
        ...shape.data,
        stack: env.isProduction ? undefined : shape.data.stack,
      },
    };
  },
});

export const createRouter = t.router;

// ── Correlation ID middleware ──────────────────────────────────────────────────
const withCorrelationId = t.middleware(async ({ ctx, next }) => {
  const headers = new Headers(ctx.resHeaders);
  const corrId = ctx.req.headers.get("x-correlation-id")
    ?? crypto.randomUUID().slice(0, 12);
  headers.set("x-correlation-id", corrId);
  return next({ ctx: { ...ctx, resHeaders: headers, correlationId: corrId } });
});

// ── Tenant isolation verification ────────────────────────────────────────────
const withTenantIsolation = t.middleware(async ({ ctx, next }) => {
  if (ctx.user && !ctx.tenant) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Организация не найдена. Пожалуйста, войдите заново.",
    });
  }
  return next();
});

// ── Global rate limiter ──────────────────────────────────────────────────────
const GLOBAL_RATE_LIMIT = { windowMs: 60 * 1000, limit: 120, namespace: "global" };

const withGlobalRateLimit = t.middleware(async ({ ctx, next }) => {
  const ip = getClientIp(ctx.req);
  if (!checkRateLimit(ip, GLOBAL_RATE_LIMIT)) {
    throw new TRPCError({
      code:    "TOO_MANY_REQUESTS",
      message: "Слишком много запросов. Подождите минуту.",
    });
  }
  return next();
});

// ── Require auth ──────────────────────────────────────────────────────────────
const requireAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.tenant) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant } });
});

// ── Role guard ────────────────────────────────────────────────────────────────
function requireRole(roles: Role[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role as Role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
    }
    return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant! } });
  });
}

// ── Mutation-specific rate limiters ──────────────────────────────────────────
const mutationRateLimit = (namespace: string, limit: number, windowMs: number = 15 * 60 * 1000) =>
  t.middleware(async ({ ctx, next }) => {
    if (ctx.req.method === "POST" || ctx.req.method === "PUT" || ctx.req.method === "DELETE") {
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, { windowMs, limit, namespace })) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: "Слишком много запросов. Попробуйте позже.",
        });
      }
    }
    return next();
  });

// ── Require active subscription ───────────────────────────────────────────────
export const requireActiveSubscription = t.middleware(async ({ ctx, next }) => {
  if (!ctx.tenant) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  const allowed = await checkSubscriptionAccess(ctx.tenant.id);
  if (!allowed) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      message: "Требуется активная подписка. Обновите тариф в настройках.",
    });
  }
  return next({ ctx });
});

// ── Base public procedure with correlation ID ─────────────────────────────────
const basePublic = t.procedure.use(withCorrelationId);

// Re-export as `publicQuery` — all public procedures get correlation IDs
export const publicQuery = basePublic;

// ── Compose authenticated procedures ──────────────────────────────────────────
export const authedQuery     = t.procedure.use(withCorrelationId).use(withTenantIsolation).use(withGlobalRateLimit).use(requireAuth);

// superAdminQuery — platform-level operations: manage tenants, billing, platform stats.
// Only superadmin can access these endpoints.
export const superAdminQuery = authedQuery.use(requireRole(["superadmin"]));

// adminQuery — tenant-level operations limited to the CEO role within their own
// tenant. Superadmin is excluded by design (see above).
export const adminQuery      = authedQuery.use(requireRole(["ceo"])).use(mutationRateLimit("admin", 60));
export const operatorQuery   = authedQuery.use(requireRole(["ceo", "operator"])).use(mutationRateLimit("operator", 120));

// ── Split agent permissions ──────────────────────────────────────────────────
// Field sales: agents + supervisors + merchandisers see dashboard, orders, catalog, shops
export const fieldSalesQuery = authedQuery
  .use(requireRole(["ceo", "operator", "agent", "supervisor", "merchandiser"]))
  .use(mutationRateLimit("agent", 200));

// Merchandiser visits: visits, photo proof, reports — merchandiser included
export const merchVisitQuery = authedQuery
  .use(requireRole(["ceo", "operator", "agent", "supervisor", "merchandiser"]))
  .use(mutationRateLimit("agent", 200));

// Legacy alias — kept for backward compatibility, prefer fieldSalesQuery/merchVisitQuery
export const agentQuery = fieldSalesQuery;

export const supervisorQuery = authedQuery.use(requireRole(["ceo", "supervisor"])).use(mutationRateLimit("supervisor", 120));
export const merchQuery      = authedQuery.use(requireRole(["ceo", "supervisor", "merchandiser"]));
export const courierQuery    = authedQuery.use(requireRole(["ceo", "operator", "courier"])).use(mutationRateLimit("courier", 200));
export const reportsQuery    = authedQuery.use(requireRole(["ceo", "operator", "supervisor"]));

// Subscription-gated variants
export const billedQuery     = authedQuery.use(requireActiveSubscription);
export const billedAdmin     = adminQuery.use(requireActiveSubscription);
export const billedOperator  = operatorQuery.use(requireActiveSubscription);
export const billedAgent     = fieldSalesQuery.use(requireActiveSubscription);

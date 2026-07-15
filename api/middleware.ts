import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TrpcContext } from "./context";
import type { Role } from "@contracts/types";
import { env } from "./lib/env";
import { checkSubscriptionAccess } from "./lib/feature-gating";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";
import { AppErrors } from "./lib/errors";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";

    let message = shape.message;
    if (error.cause instanceof ZodError) {
      message = error.cause.errors
        .map(e => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
    } else if (isInternal && env.isProduction) {
      message = "Внутренняя ошибка сервера. Попробуйте позже.";
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
    throw AppErrors.unauthorized("Организация не найдена. Пожалуйста, войдите заново.");
  }
  return next();
});

// ── Global rate limiter ──────────────────────────────────────────────────────
const GLOBAL_RATE_LIMIT = { windowMs: 60 * 1000, limit: 120, namespace: "global" };

const withGlobalRateLimit = t.middleware(async ({ ctx, next }) => {
  const ip = getClientIp(ctx.req);
  if (!checkRateLimit(ip, GLOBAL_RATE_LIMIT)) {
    throw AppErrors.tooManyRequests("Слишком много запросов. Подождите минуту.");
  }
  return next();
});

// ── Require auth ──────────────────────────────────────────────────────────────
const requireAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.tenant) {
    throw AppErrors.unauthorized(ErrorMessages.unauthenticated);
  }
  return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant } });
});

// ── Role guard ────────────────────────────────────────────────────────────────
function requireRole(roles: Role[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role as Role)) {
      throw AppErrors.forbidden(ErrorMessages.insufficientRole);
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
        throw AppErrors.tooManyRequests("Слишком много запросов. Попробуйте позже.");
      }
    }
    return next();
  });

// ── Require active subscription ───────────────────────────────────────────────
export const requireActiveSubscription = t.middleware(async ({ ctx, next }) => {
  if (!ctx.tenant) {
    throw AppErrors.unauthorized(ErrorMessages.unauthenticated);
  }
  const allowed = await checkSubscriptionAccess(ctx.tenant.id);
  if (!allowed) {
    throw AppErrors.forbidden("Требуется активная подписка. Обновите тариф в настройках.");
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
// Superadmin intentionally CANNOT use adminQuery endpoints — they operate at the
// tenant level (CEO context). If superadmin needs to act inside a specific tenant,
// that should be an explicit, audit-logged "impersonation" action, not a silent
// role extension.
export const superAdminQuery = authedQuery.use(requireRole(["superadmin"]));

// adminQuery — tenant-level operations limited to the CEO role within their own
// tenant. Superadmin is excluded by design (see above).
export const adminQuery      = authedQuery.use(requireRole(["ceo"])).use(mutationRateLimit("admin", 60));
export const operatorQuery   = authedQuery.use(requireRole(["ceo", "operator"])).use(mutationRateLimit("operator", 120));
export const agentQuery      = authedQuery.use(requireRole(["ceo", "operator", "agent"])).use(mutationRateLimit("agent", 200));
export const supervisorQuery = authedQuery.use(requireRole(["ceo", "supervisor"])).use(mutationRateLimit("supervisor", 120));
export const merchQuery      = authedQuery.use(requireRole(["ceo", "supervisor", "merchandiser"]));
export const courierQuery    = authedQuery.use(requireRole(["ceo", "operator", "courier"])).use(mutationRateLimit("courier", 200));
export const reportsQuery    = authedQuery.use(requireRole(["ceo", "operator", "supervisor"]));

// Subscription-gated variants
export const billedQuery     = authedQuery.use(requireActiveSubscription);
export const billedAdmin     = adminQuery.use(requireActiveSubscription);
export const billedOperator  = operatorQuery.use(requireActiveSubscription);
export const billedAgent     = agentQuery.use(requireActiveSubscription);

import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { Role } from "@contracts/types";
import { env } from "./lib/env";
import { hasSubscriptionAccess } from "./lib/feature-gating";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";

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

// ── Что можно показать человеку, а что обязано остаться «внутренней ошибкой» ──
//
// Признаки сбоя, а не разговора с оператором: код драйвера MySQL (ER_DUP_ENTRY),
// сетевой код (ECONNREFUSED), состояние SQL. Такие сообщения умеют содержать
// куски запроса и чужие данные — в том числе по-русски, из самих строк базы, —
// поэтому одной проверки «текст русский» мало.
const RUNTIME_FAILURE_MARKERS = /\b(ER_[A-Z_]+|E[A-Z]{3,}|PROTOCOL_[A-Z_]+|SQLSTATE|SELECT|INSERT|UPDATE|DELETE|WHERE|undefined|null|NaN)\b/;

/**
 * Ошибка написана для оператора, а не для разработчика?
 *
 * Бизнес-проверки в сервисах бросают обычный `new Error("Недостаточно товара на
 * складе (доступно: 3, запрошено: 10)")`. tRPC считает любой не-TRPCError
 * внутренним сбоем, и в проде текст подменялся на «Внутренняя ошибка сервера.
 * Попробуйте позже.». Агент в поле из-за этого не понимал, что надо уменьшить
 * количество, и жал повтор — каждая попытка ложилась в error-log как 500.
 *
 * Правильное место для такой проверки — сам бросок (TRPCError с кодом
 * BAD_REQUEST, как в agent-router и order.ts), и он остаётся правильным. Это —
 * подстраховка для мест, где до сих пор стоит голый throw: показать текст,
 * который заведомо написан человеку, и не показать ничего остального.
 *
 * Пропускается только то, что похоже на заготовленное сообщение: ровно класс
 * Error (TypeError и RangeError — это ошибки кода), без полей драйвера, одна
 * короткая строка, по-русски и без технических маркеров. Всё прочее, включая
 * любую ошибку mysql2 с русским значением внутри, по-прежнему маскируется.
 */
function isOperatorFacingError(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause.constructor !== Error) return false;

  const fields = cause as unknown as Record<string, unknown>;
  if (fields.code !== undefined || fields.errno !== undefined
    || fields.sqlState !== undefined || fields.syscall !== undefined) return false;

  const msg = cause.message;
  if (!msg || msg.length > 200 || /[\n\r]/.test(msg)) return false;
  if (!/[А-Яа-яЁё]/.test(msg)) return false;
  return !RUNTIME_FAILURE_MARKERS.test(msg);
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    const operatorFacing = isInternal && isOperatorFacingError(error.cause);
    if (isInternal) {
      // Разные записи намеренно: по [tRPC BUSINESS] видно места, где бизнес-отказ
      // всё ещё летит голым throw и его пора заменить на TRPCError, и эти записи
      // не выглядят падением сервера при разборе логов.
      if (operatorFacing) {
        console.warn(`[tRPC BUSINESS] ${error.message}`);
      } else {
        console.error(`[tRPC INTERNAL] ${error.message}`, error.cause ?? error);
      }
    }
    let message = isInternal && env.isProduction && !operatorFacing
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
/**
 * Общий ограничитель запросов — из настроек, а не из числа в коде.
 *
 * RATE_LIMIT_GLOBAL_MAX и RATE_LIMIT_WINDOW_MS объявлены в lib/env.ts и
 * описаны в .env.example, но не читались НИГДЕ: здесь стояли 120 и 60000
 * прямо в коде. То есть рычаг был, а действия не оказывал — поднять предел
 * во время наплыва было нечем, и понять, почему настройка не работает,
 * тоже нечем: ошибки нет, просто ничего не меняется.
 *
 * Значения по умолчанию те же, поэтому в бою ничего не меняется.
 */
const GLOBAL_RATE_LIMIT = {
  windowMs:  env.rateLimitWindowMs,
  limit:     env.rateLimitGlobalMax,
  namespace: "global",
};

const withGlobalRateLimit = t.middleware(async ({ ctx, next }) => {
  // Per user, not per IP: createContext has already resolved ctx.user from the
  // token, and "120 requests a minute" only ever meant one person's traffic.
  // Keyed on an unidentifiable IP it meant the whole platform's, and eight
  // people opening a dashboard at once spent it.
  const subject = rateLimitSubject(ctx.req, ctx.user ? `user:${ctx.user.id}` : null);
  if (!(await checkRateLimit(subject, GLOBAL_RATE_LIMIT))) {
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
      // Same reasoning as withGlobalRateLimit: "200 agent mutations per 15
      // minutes" is a budget for one agent. Shared across every agent in every
      // tenant it became roughly a dozen orders each before the day stopped.
      const subject = rateLimitSubject(ctx.req, ctx.user ? `user:${ctx.user.id}` : null);
      if (!(await checkRateLimit(subject, { windowMs, limit, namespace }))) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: "Слишком много запросов. Попробуйте позже.",
        });
      }
    }
    return next();
  });

// ── Подписка ─────────────────────────────────────────────────────────────────
/**
 * Что остаётся доступным организации с истёкшей подпиской.
 *
 * Ровно то, без чего нельзя заплатить и выйти: собственный профиль, экраны
 * тарифа и оплаты. Всё остальное — работа с товаром, заказами, складом,
 * отчётами — закрыто, потому что это и есть продукт.
 *
 * Список по префиксу пути, а не по отдельным процедурам: новая процедура в
 * billing или stripe должна открываться сама, без правки этого файла. Обратное
 * направление — новый рабочий роутер — закрывается по умолчанию, и это главное
 * свойство: забыть закрыть нельзя, можно только забыть открыть, а это заметят
 * сразу.
 */
const SUBSCRIPTION_EXEMPT_PREFIXES = [
  "auth.",     // me, восстановление пароля
  "billing.",  // тариф, лимиты, заявка на продление
  "stripe.",   // оплата и портал
  "system.",   // платформенные метрики, и так только для суперадмина
];

function isExemptFromSubscription(path: string): boolean {
  return SUBSCRIPTION_EXEMPT_PREFIXES.some(p => path.startsWith(p));
}

/**
 * Требовать действующую подписку.
 *
 * Стоит в основании authedQuery, а не отдельной процедурой сбоку — и это
 * единственная причина, по которой проверка вообще работает.
 *
 * До этой правки существовали billedQuery, billedAdmin, billedOperator и
 * billedAgent: аккуратно написанные, покрывающие все роли, и не вызванные
 * НИ РАЗУ ни в одном из 38 роутеров. Проверка подписки была написана,
 * продумана и мертва, а организации с истёкшим тарифом продолжали работать —
 * один из них оформил заказ через пять дней после окончания оплаты. В
 * Layout.tsx рядом с клиентской проверкой стояло признание: «это только
 * клиентская проверка, её можно обойти, нужна серверная».
 *
 * Калитка, которую надо не забыть поставить в двухстах местах, не ставится
 * никогда. Поэтому здесь она — умолчание, а исключения перечислены поимённо
 * и их четыре.
 *
 * Суперадмин не проверяется вовсе: он платформа, а не арендатор, и запирать
 * его за подпиской чужой организации бессмысленно — именно он и продлевает.
 */
const withSubscriptionGate = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.user || !ctx.tenant) return next();          // разберётся requireAuth
  if (ctx.user.role === "superadmin") return next();
  if (isExemptFromSubscription(path)) return next();

  if (!(await hasSubscriptionAccess(ctx.tenant.id))) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      // Текст общий с клиентом: по нему веб уводит на экран оплаты.
      message: ErrorMessages.subscriptionRequired,
    });
  }
  return next();
});

// ── Base public procedure with correlation ID ─────────────────────────────────
const basePublic = t.procedure.use(withCorrelationId);

// Re-export as `publicQuery` — all public procedures get correlation IDs
export const publicQuery = basePublic;

// ── Compose authenticated procedures ──────────────────────────────────────────
export const authedQuery     = t.procedure.use(withCorrelationId).use(withTenantIsolation).use(withGlobalRateLimit).use(requireAuth).use(withSubscriptionGate);

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

/*
  Свой собственный KPI — включая курьера.

  fieldSalesQuery курьера не пускает, и правильно: за ним магазины, товары и
  заказы, которых курьеру не надо. Но у него в нижней панели есть «KPI», и
  маршрут его туда пускает — а обе процедуры страницы отвечали отказом. То
  есть пункт меню всегда вёл в «не удалось загрузить», и «Повторить»
  повторяло тот же отказ: запрос отклонён не сбоем, а правами.

  Считать курьеру есть что: расчёт KPI уже берёт доставки по orders.courier_id
  и собранные деньги по payments.created_by — это его собственные числа.
  Процедуры на этом виде обязаны отдавать данные ТОЛЬКО вызывающего: ничего
  чужого он тут увидеть не должен.
*/
export const selfKpiQuery = authedQuery
  .use(requireRole(["ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]));

export const supervisorQuery = authedQuery.use(requireRole(["ceo", "supervisor"])).use(mutationRateLimit("supervisor", 120));
export const merchQuery      = authedQuery.use(requireRole(["ceo", "supervisor", "merchandiser"]));
export const courierQuery    = authedQuery.use(requireRole(["ceo", "operator", "courier"])).use(mutationRateLimit("courier", 200));
export const reportsQuery    = authedQuery.use(requireRole(["ceo", "operator", "supervisor", "merchandiser"]));
export const auditQuery      = authedQuery.use(requireRole(["ceo", "superadmin"]));

/**
 * Cost price and profit.
 *
 * These are the numbers that say what the company makes on every item — the
 * supplier's price, the margin, the bottom line. reportsQuery covers everyone
 * who needs *sales* reporting, which includes merchandisers walking shop
 * floors and operators taking phone orders, and none of them have any business
 * seeing the markup. An agent who knows the cost knows exactly how far a shop
 * can push on price.
 *
 * Kept separate from adminQuery so that widening who may administer the system
 * never quietly widens who may read the margin.
 */
export const financeQuery    = authedQuery.use(requireRole(["ceo"]));

/**
 * The team's numbers, as opposed to your own.
 *
 * Quotas, targets and progress for everyone in the company: management sees the
 * whole board, field staff see the row with their name on it. Narrower than
 * reportsQuery, which also admits merchandisers — they walk shop floors and
 * have no business reading the sales team's plan.
 */
export const managementQuery = authedQuery.use(requireRole(["ceo", "operator", "supervisor"]));

// Здесь были billedQuery, billedAdmin, billedOperator и billedAgent — те самые
// четыре процедуры, которых не позвал никто. Они удалены намеренно: теперь
// подписка проверяется в authedQuery, то есть во всех них сразу, и держать
// рядом второй, необязательный способ сделать то же самое значит снова
// предложить его забыть.

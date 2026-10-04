import { ErrorMessages, type OperatorCapability } from "@contracts/constants";
import { INTERNAL_ERROR_TEXT, localizeServerMessage, parseUiLang, type UiLang } from "@contracts/error-messages";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { Role } from "@contracts/types";
import { env } from "./lib/env";
import { hasSubscriptionAccess } from "./lib/feature-gating";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";
import { trpcProcedureDurationSeconds, trpcProcedureErrorsTotal } from "./prometheus-metrics";

// ── Ошибки проверки входа (zod) — словами, на языке интерфейса ───────────────
const FIELD_LABELS: Record<string, { ru: string; uz: string }> = {
  name: { ru: "Название", uz: "Nomi" }, code: { ru: "Код", uz: "Kod" },
  phone: { ru: "Телефон", uz: "Telefon" }, email: { ru: "Email", uz: "Email" },
  password: { ru: "Пароль", uz: "Parol" }, orgName: { ru: "Название организации", uz: "Tashkilot nomi" },
  ownerName: { ru: "Имя владельца", uz: "Egasining ismi" }, category: { ru: "Категория", uz: "Kategoriya" },
  description: { ru: "Описание", uz: "Tavsif" }, city: { ru: "Город", uz: "Shahar" },
  district: { ru: "Район", uz: "Tuman" }, address: { ru: "Адрес", uz: "Manzil" },
  barcode: { ru: "Штрихкод", uz: "Shtrixkod" }, unitPrice: { ru: "Цена продажи", uz: "Sotuv narxi" },
  costPrice: { ru: "Себестоимость", uz: "Tannarx" }, unit: { ru: "Единица измерения", uz: "O'lchov birligi" },
  unitWeight: { ru: "Вес", uz: "Og'irlik" }, reorderPoint: { ru: "Порог дозаказа", uz: "Qayta buyurtma chegarasi" },
  photoUrl: { ru: "Фото", uz: "Foto" }, dataUrl: { ru: "Фото", uz: "Foto" },
  base64: { ru: "Файл", uz: "Fayl" }, filename: { ru: "Имя файла", uz: "Fayl nomi" },
  type: { ru: "Тип", uz: "Turi" }, title: { ru: "Заголовок", uz: "Sarlavha" },
  message: { ru: "Сообщение", uz: "Xabar" }, notes: { ru: "Заметки", uz: "Izohlar" },
  role: { ru: "Роль", uz: "Rol" }, status: { ru: "Статус", uz: "Holat" }, debt: { ru: "Долг", uz: "Qarz" },
};

function friendlyFieldName(path: (string | number)[], lang: UiLang): string {
  const last = String(path[path.length - 1] ?? "");
  return FIELD_LABELS[last]?.[lang] ?? last;
}

/**
 * Ошибки zod из cause — по одной фразе на поле.
 *
 * Свой текст проверки (`.min(1, "Введите пароль")`, `.refine(f, "…")`)
 * написан для человека и точнее общей фразы — он и показывается, через
 * словарь переводов. Общая фраза — только там, где своего текста нет и zod
 * отдал английский по умолчанию.
 */
function translateZodErrorFromCause(cause: unknown, lang: UiLang): string | null {
  if (!cause || typeof cause !== "object") return null;
  const obj = cause as Record<string, unknown>;
  // ZodError has an `issues` array
  if (!Array.isArray(obj.issues)) return null;

  const issues = obj.issues as Array<{
    code: string; path: (string | number)[];
    minimum?: number | bigint; maximum?: number | bigint;
    message: string; type?: string; origin?: string;
    received?: string; options?: string[]; values?: unknown[];
  }>;

  const uz = lang === "uz";
  const messages: string[] = [];
  for (const issue of issues) {
    if (issue.message && /[А-Яа-яЁё]/.test(issue.message)) {
      messages.push(localizeServerMessage(issue.message, lang) ?? issue.message);
      continue;
    }
    const field = friendlyFieldName(issue.path, lang);
    const kind = issue.type ?? issue.origin;

    if (issue.code === "too_small" && issue.minimum !== undefined) {
      const min = Number(issue.minimum);
      if (kind === "string") {
        messages.push(uz
          ? `«${field}» kamida ${min} belgidan iborat bo'lishi kerak`
          : `«${field}» должно содержать минимум ${min} ${min === 1 ? "символ" : "символа"}`);
      } else {
        messages.push(uz ? `«${field}» kamida ${min} bo'lishi kerak` : `«${field}» должно быть не менее ${min}`);
      }
    } else if (issue.code === "too_big" && issue.maximum !== undefined) {
      const max = Number(issue.maximum);
      messages.push(uz ? `«${field}» juda uzun (ko'pi bilan ${max} belgi)` : `«${field}» слишком длинное (макс. ${max} символов)`);
    } else if (issue.code === "invalid_type") {
      const missing = issue.received === "undefined" || issue.received === "null"
        || /received (undefined|null)/i.test(issue.message ?? "");
      if (missing) {
        messages.push(uz ? `«${field}» maydonini to'ldirish shart` : `Поле «${field}» обязательно для заполнения`);
      } else {
        messages.push(uz ? `«${field}» maydoni formati noto'g'ri` : `Неверный формат поля «${field}»`);
      }
    } else if (issue.code === "invalid_enum_value" || issue.code === "invalid_value") {
      const options = issue.options ?? issue.values?.map(String);
      messages.push(uz
        ? `«${field}» qiymati noto'g'ri. Mumkin bo'lganlari: ${options?.join(", ") ?? "shaklni tekshiring"}`
        : `Неверное значение «${field}». Допустимые варианты: ${options?.join(", ") ?? "проверьте форму"}`);
    } else {
      messages.push(uz ? `«${field}» maydoni noto'g'ri to'ldirilgan` : `Поле «${field}» заполнено неверно`);
    }
  }
  return messages.length > 0 ? messages.join(". ") : null;
}

/** Fallback: match ZodError text patterns in the error message string */
function translateZodError(zodMsg: string, lang: UiLang): string {
  const msg = zodMsg.toLowerCase();
  const bilingual = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  if (/too_small.*string.*have >=\s*2/.test(msg)) return bilingual("Поле должно содержать минимум 2 символа", "Maydon kamida 2 belgidan iborat bo'lishi kerak");
  if (/too_small.*string.*have >=\s*1/.test(msg)) return bilingual("Поле не может быть пустым", "Maydon bo'sh bo'lishi mumkin emas");
  if (/too_small.*number.*have >=\s*1/.test(msg)) return bilingual("Значение должно быть не менее 1", "Qiymat kamida 1 bo'lishi kerak");
  if (/too_big.*string.*have <=\s*(\d+)/.test(msg)) {
    const m = msg.match(/have <=\s*(\d+)/);
    return bilingual(`Поле слишком длинное (максимум ${m?.[1] ?? ""} символов)`, `Maydon juda uzun (ko'pi bilan ${m?.[1] ?? ""} belgi)`);
  }
  if (/invalid_type.*received.*undefined/.test(msg) || /required/.test(msg)) return bilingual("Обязательное поле не заполнено", "Majburiy maydon to'ldirilmagan");
  if (/invalid_type.*received.*number/.test(msg)) return bilingual("Ожидалось числовое значение", "Son kutilgan edi");
  if (/invalid_type.*received.*string/.test(msg)) return bilingual("Ожидался текст", "Matn kutilgan edi");
  if (/invalid_enum_value|invalid_value.*options/.test(msg)) return bilingual("Выбрано недопустимое значение", "Ruxsat etilmagan qiymat tanlangan");
  if (/invalid_email|not a valid email/.test(msg)) return bilingual("Некорректный email", "Email noto'g'ri");
  if (/too_small/.test(msg)) return bilingual("Значение слишком маленькое", "Qiymat juda kichik");
  if (/too_big/.test(msg)) return bilingual("Значение слишком большое", "Qiymat juda katta");
  if (/invalid_string/.test(msg)) return bilingual("Некорректное значение", "Qiymat noto'g'ri");
  if (/not.*valid/.test(msg)) return bilingual("Некорректное значение поля", "Maydon qiymati noto'g'ri");
  // Match human-readable Zod messages
  if (/too small/.test(msg)) return bilingual("Значение слишком маленькое", "Qiymat juda kichik");
  if (/too long/.test(msg)) return bilingual("Значение слишком длинное", "Qiymat juda uzun");
  if (/expected/.test(msg) && /received/.test(msg)) return bilingual("Неверный формат данных", "Ma'lumot formati noto'g'ri");
  return bilingual("Проверьте правильность заполнения полей", "Maydonlar to'g'ri to'ldirilganini tekshiring");
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
 *
 * Отдельно — отказы подключения к 1С (OneCError, BlockedAddressError): их
 * тексты написаны для того, кто настраивает обмен («1С не подключена:
 * заполните подключение в настройках», «1С: неверный логин или пароль»), а
 * экран 1С видел вместо них «Внутреннюю ошибку сервера» (04.10.2026).
 */
const OPERATOR_FACING_CLASSES = new Set(["OneCError", "BlockedAddressError"]);

function isOperatorFacingError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (OPERATOR_FACING_CLASSES.has(cause.name)) {
    return !!cause.message && cause.message.length <= 300 && !/[\n\r]/.test(cause.message);
  }
  if (cause.constructor !== Error) return false;

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
  /*
    Отказ — на языке интерфейса. Клиент шлёт его заголовком x-lang; без
    заголовка (старое мобильное приложение) — русский, как было всегда.
    `data.lang` говорит клиенту: текст уже на этом языке и написан для
    человека, показывай как есть. Нет пометки — текст сервер не узнал, и
    клиент скажет своё по коду отказа. Подробно — contracts/error-messages.ts.
  */
  errorFormatter: ({ shape, error, ctx }) => {
    const lang = parseUiLang(ctx?.req?.headers?.get?.("x-lang"));
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

    let message = shape.message;
    let localized = false;
    if (isInternal && env.isProduction && !operatorFacing) {
      message = INTERNAL_ERROR_TEXT[lang];
      localized = true;
    } else {
      // Словарь — раньше разбора zod: «Authentication required» содержит
      // «required», и разбор принимал вход без сессии за пустое поле формы.
      const known = localizeServerMessage(message, lang);
      const zodFriendly = known === null ? translateZodErrorFromCause(error.cause, lang) : null;
      if (known !== null) {
        message = known;
        localized = true;
      } else if (zodFriendly) {
        message = zodFriendly;
        localized = true;
      } else if (message && (
        message.includes("ZodError") || message.includes("too_small") ||
        message.includes("too_big") || message.includes("invalid_type") ||
        message.includes("invalid_string") || message.includes("required") ||
        message.includes("Expected") || message.includes("received") ||
        message.includes("Too small") || message.includes("Too long")
      )) {
        message = translateZodError(message, lang);
        localized = true;
      }
    }

    return {
      ...shape,
      message,
      data: {
        ...shape.data,
        stack: env.isProduction ? undefined : shape.data.stack,
        ...(localized ? { lang } : {}),
      },
    };
  },
});

export const createRouter = t.router;

// ── Correlation ID middleware ──────────────────────────────────────────────────
/*
  Время и исход каждой процедуры — в Prometheus. Первым слоем, чтобы в
  замер попали и отказы доступа, и лимиты: медленная ручка и ручка, которую
  все получают 429, — обе видны. Ошибка процедуры не проглатывается:
  считается и летит дальше.
*/
const withProcedureMetrics = t.middleware(async ({ path, type, next }) => {
  const end = trpcProcedureDurationSeconds.startTimer({ path, type });
  const result = await next();
  end({ ok: result.ok ? "1" : "0" });
  if (!result.ok) trpcProcedureErrorsTotal.inc({ path, code: result.error.code });
  return result;
});

/*
  Номер запроса — в ctx, заголовки ответа — не трогать.

  Здесь ctx.resHeaders подменялся копией (new Headers), и всё, что процедура
  писала в заголовки ответа, уходило в копию, которую адаптер
  (http/trpc-adapter.ts) не видит: он пересылает свой, исходный объект. Вышло
  наружу 01.10.2026 — смена логина суперадмином выдавала вкладке новую куку, а
  та не доезжала, и вкладка вылетала вместе с остальными сессиями. Заголовок
  x-correlation-id из копии тоже никогда не уходил; в ответ его ставит
  HTTP-слой (boot.ts), здесь он только для логов процедур.
*/
const withCorrelationId = t.middleware(async ({ ctx, next }) => {
  const corrId = ctx.req.headers.get("x-correlation-id")
    ?? crypto.randomUUID().slice(0, 12);
  return next({ ctx: { ...ctx, correlationId: corrId } });
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
const basePublic = t.procedure.use(withProcedureMetrics).use(withCorrelationId);

// Re-export as `publicQuery` — all public procedures get correlation IDs
export const publicQuery = basePublic;

// ── Compose authenticated procedures ──────────────────────────────────────────
export const authedQuery     = t.procedure.use(withProcedureMetrics).use(withCorrelationId).use(withTenantIsolation).use(withGlobalRateLimit).use(requireAuth).use(withSubscriptionGate);

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

/*
  Один заказ по номеру — всем, кто с ним работает, включая курьера.

  Экран «Оформить подробно» на телефоне курьера читает заказ через
  order.getById, а та стояла под fieldSalesQuery — без курьера. Ответ 403
  телефон показывал как «сбой связи», и частичная оплата с возвратом у двери
  не работали никогда. Что именно видит курьер, ограничивает viewerScope в
  services/order-shared.ts: только заказы, назначенные ему.
*/
export const orderReaderQuery = authedQuery
  .use(requireRole(["ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]))
  .use(mutationRateLimit("agent", 200));

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
 * Тот же круг, что у financeQuery, — для ручек, открытых шире, но с частью
 * ответа «только финансам» (ABC по прибыли в reports.abc). Список выписан
 * вторым разом, потому что стражи ролей читают requireRole([...]) из текста;
 * совпадение держит api/__tests__/director-reports-access.test.ts.
 */
export const FINANCE_ROLES: readonly string[] = ["ceo"];

/**
 * The team's numbers, as opposed to your own.
 *
 * Quotas, targets and progress for everyone in the company: management sees the
 * whole board, field staff see the row with their name on it. Narrower than
 * reportsQuery, which also admits merchandisers — they walk shop floors and
 * have no business reading the sales team's plan.
 */
export const managementQuery = authedQuery.use(requireRole(["ceo", "operator", "supervisor"]));

/* ═══════════════════════════════════════════════════════════════════════════
   Что арендатор отобрал у роли.

   Роль — потолок, одинаковый для всех организаций. Эта проверка опускает пол
   в отдельно взятой организации: «здесь оператор заказы не удаляет».
   Разрешить сверх роли она не может — только запретить.

   Ставится ПОСЛЕ проверки роли, отдельным звеном:

       delete: operatorQuery.use(can("orders.delete"))

   Именно так, а не заменой вида процедуры на свой: вид (operatorQuery) —
   единственное, по чему и человек, и проверки в наборе тестов узнают, кому
   ручка открыта. Спрячь его за обёрткой — и стражи ролей замолчат.
   ═══════════════════════════════════════════════════════════════════════════ */
export function can(capability: OperatorCapability) {
  return t.middleware(async ({ ctx, next }) => {
    /*
      Настраивается пока только оператор. Директор в каждом operatorQuery
      присутствует и правами распоряжается сам — отбирать у него через
      настройку, которую он же и ведёт, бессмысленно.
    */
    if (ctx.user?.role === "operator" && ctx.tenant) {
      const { capabilitiesOf } = await import("./lib/role-permissions");
      const map = await capabilitiesOf(ctx.db, ctx.tenant.id, ctx.user.role);
      if (map[capability] === false) {
        throw new TRPCError({
          code: "FORBIDDEN",
          // Не «недостаточно прав»: отказ здесь не от роли, а от решения
          // директора, и человек должен понимать, к кому идти.
          message: "Это действие закрыто оператору в вашей организации. Обратитесь к руководителю.",
        });
      }
    }
    return next();
  });
}

// Здесь были billedQuery, billedAdmin, billedOperator и billedAgent — те самые
// четыре процедуры, которых не позвал никто. Они удалены намеренно: теперь
// подписка проверяется в authedQuery, то есть во всех них сразу, и держать
// рядом второй, необязательный способ сделать то же самое значит снова
// предложить его забыть.

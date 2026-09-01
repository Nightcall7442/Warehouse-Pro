import * as Sentry from "@sentry/react";

/**
 * Сбор ошибок браузера.
 *
 * ── Про версию ───────────────────────────────────────────────────────────────
 *
 * release — не украшение. По нему Sentry подбирает карты кода (source maps),
 * и если версия в браузере не совпадает с версией, под которой карты
 * загружены, стек остаётся минифицированным: «t is not a function,
 * index-Bt0DF5TC.js:1». Такую ошибку нельзя прочитать вообще.
 *
 * Версию подставляет сборка (VITE_APP_VERSION), а Railway передаёт туда
 * отпечаток коммита — см. Dockerfile. Значение «dev» означает, что переменная
 * не задана: карты кода тогда тоже не загружены, и это видно сразу по релизу
 * в Sentry.
 */
const RELEASE = import.meta.env.VITE_APP_VERSION || "dev";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  integrations: [
    // Transactions are named by URL, not by route pattern. Parameterized names
    // need reactRouterBrowserTracingIntegration *and* a Sentry-wrapped <Routes>
    // in App.tsx — that integration turns off its own navigation tracking and
    // relies on the wrapper, so switching here alone would lose navigations.
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      // В записи сеанса не должно быть ни сумм, ни названий магазинов: она
      // уходит третьей стороне. Текст и поля ввода закрываются целиком.
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,

  /**
   * Записи сеансов.
   *
   * Было 0,5 — записывалась половина ВСЕХ посещений, включая те, где ничего
   * не случилось. Это и деньги (записи тарифицируются), и чужая работа на
   * стороне Sentry без всякой причины. Пишем только то, что закончилось
   * ошибкой, — ради этого записи и заводились.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  environment: import.meta.env.PROD ? "production" : "development",
  release: RELEASE,

  // Почту и адрес Sentry сам не собирает; кто наткнулся на ошибку —
  // проставляется явно и без личных данных, см. setSentryUser ниже.
  sendDefaultPii: false,

  /**
   * Шум расширений браузера и самого браузера.
   *
   * Эти сообщения приходят от чужого кода на странице и к приложению
   * отношения не имеют. Пока они летели в Sentry, разбор ошибок начинался с
   * их пролистывания.
   */
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
  ],

  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value ?? "";

    // Обрыв связи и обновление кэша приложения — не ошибки кода.
    if (
      msg.includes("workbox") ||
      msg.includes("non-precached-url") ||
      msg.includes("net::ERR") ||
      msg.includes("Failed to fetch") ||
      msg.includes("Loading chunk") ||
      msg.includes("dynamically imported module")
    ) {
      return null;
    }

    /**
     * Ожидаемые ответы сервера отсеиваются по КОДУ, а не по принципу «всё,
     * что не пятисотое».
     *
     * Прежнее условие выбрасывало любую ошибку tRPC, кроме пятисотой. Вместе
     * с шумом оно выбрасывало и настоящие поломки: 403 из-за сломанной
     * проверки прав, 400 из-за неверного запроса с клиента — то есть ровно
     * те, которые ищут глазами и не находят. Здесь отсеиваются только коды,
     * означающие обычную работу: не вошёл, слишком часто нажимал, нет такой
     * записи.
     */
    const EXPECTED = ["UNAUTHORIZED", "TOO_MANY_REQUESTS", "NOT_FOUND", "FORBIDDEN"];
    if (msg.includes("TRPCClientError") && EXPECTED.some(code => msg.includes(code))) {
      return null;
    }

    return event;
  },
});

/**
 * Кто именно наткнулся на ошибку.
 *
 * Идентификатор пользователя и организации, без почты и имени: этого хватает,
 * чтобы найти человека в своей же базе, и не отдаёт третьей стороне лишнего.
 * Без этого у каждой ошибки в Sentry стоит «аноним», и понять, у одного она
 * человека или у всей организации, нельзя.
 */
export function setSentryUser(user: { id: number; tenantId: number; role: string } | null): void {
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: String(user.id) });
  Sentry.setTag("tenant", String(user.tenantId));
  Sentry.setTag("role", user.role);
}

// Note: window.onerror and unhandledrejection handlers are in main.tsx
// (shows toast notifications to users). Sentry captures via globalHandlers integration.

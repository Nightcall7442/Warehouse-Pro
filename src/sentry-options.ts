/**
 * Сбор ошибок браузера: общие настройки приложения и сайта.
 *
 * Приложение (src/sentry.ts) добавляет к ним трассировку переходов и запись
 * сеанса; сайт для гостя (src/sentry-lite.ts) берёт их как есть — ошибки
 * формы заявки должны доходить так же, как ошибки приложения.
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
import type { BrowserOptions } from "@sentry/react";

const RELEASE = import.meta.env.VITE_APP_VERSION || "dev";

export const SENTRY_BASE = {
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  environment: import.meta.env.PROD ? "production" : "development",
  release: RELEASE,

  // Почту и адрес Sentry сам не собирает; кто наткнулся на ошибку —
  // проставляется явно и без личных данных, см. setSentryUser в sentry.ts.
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
} satisfies BrowserOptions;

import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../router";
import { createContext } from "../context";
import { logger } from "../lib/logger";
import { logError } from "../lib/error-log";
import * as Sentry from "@sentry/node";

/*
  Мост Hono → tRPC: заголовки ответа, код HTTP по коду tRPC, журнал
  ошибок и Sentry. Вынесено из boot.ts без изменений.
*/
const routes = new Hono();

/**
 * Код ошибки tRPC в код ответа HTTP.
 *
 * Свой перечень, а не разбор внутренностей tRPC: он короткий, читается глазами
 * и не ломается от смены версии. Неизвестный код считается нашей виной — это
 * безопасная сторона ошибки: лучше записать лишнее, чем потерять настоящий сбой.
 */
const TRPC_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

// ── tRPC handler ─────────────────────────────────────────────────────────────

routes.use("/api/trpc/*", async (c) => {
  // Сохраняем ссылку на resHeaders перед вызовом tRPC
  const resHeaders = new Headers();

  const res = await fetchRequestHandler({
    endpoint:      "/api/trpc",
    req:           c.req.raw,
    router:        appRouter,
    createContext: async (opts) => {
      const ctx = await createContext(opts);
      ctx.resHeaders = resHeaders;
      return ctx;
    },
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error("tRPC internal error", { path, error: error.cause ?? error.message });
      }

      /*
        Код ответа — настоящий, а не зашитое число.

        Здесь стояло statusCode: 500 для ЛЮБОЙ ошибки tRPC, и в журнал шла
        тоже любая. От этого обычное «вы не вошли» — UNAUTHORIZED, то есть
        401 — показывалось на странице мониторинга как КРИТИЧЕСКИЙ сбой
        сервера с кодом 500.

        Владелец видел три таких записи подряд: auth.me, branding.get,
        warehouseMulti.list. Это ровно те запросы, которые уходят до входа или
        на истёкшей сессии, — то есть не поломка, а обычный ход дел. Сервер
        при этом вёл себя правильно и отвечал 401; врал только журнал.

        Правило то же, что и у HTTP-запросов выше: ошибка — это 5xx, наша
        вина. Отказ входа, отказ прав и негодный ввод остаются за пределами
        журнала ошибок; в Sentry по-прежнему уходит только INTERNAL_SERVER_ERROR.
      */
      const statusCode = TRPC_STATUS[error.code] ?? 500;
      if (statusCode >= 500) {
        logError({
          message: error.message,
          code: error.code,
          path: path ?? "unknown",
          method: "POST",
          statusCode,
          stack: error.cause instanceof Error ? error.cause.stack : undefined,
        });
      }

      // Capture tRPC errors in Sentry with tags for alert targeting
      if (error.code === "INTERNAL_SERVER_ERROR") {
        Sentry.withScope((scope) => {
          scope.setTag("error_type", "trpc");
          scope.setTag("trpc_path", path ?? "unknown");
          scope.setTag("trpc_code", error.code);
          scope.setContext("trpc", { path, code: error.code, message: error.message });
          Sentry.captureException(error.cause ?? new Error(error.message));
        });
      }
    },
  });

  // Пересылаем заголовки (set-cookie) из tRPC контекста в HTTP ответ
  if (resHeaders.entries().next().value) {
    const headers = new Headers(res.headers);
    for (const [key, value] of resHeaders.entries()) {
      headers.append(key, value);
    }
    return new Response(res.body, { status: res.status, headers });
  }

  return res;
});

export default routes;

import { uiLang } from "@/lib/ui-text";

/**
 * Запрос к серверу от имени этой сборки: с версией и языком интерфейса.
 *
 * Версия сборки — в каждом запросе: по ней сервер считает, кто на какой
 * сборке (client_requests_total), и Sentry получает ту же строку.
 * Язык интерфейса — тоже: на нём сервер отвечает отказом (x-lang, см.
 * contracts/error-messages.ts). Берётся в момент запроса, а не при загрузке:
 * язык переключают без перезагрузки, а на /uz его задаёт адрес (uiLang).
 *
 * Общий для приложения (providers/trpc.client) и сайта (lib/public-api):
 * заявка с узбекской страницы должна получить отказ по-узбекски так же, как
 * любой экран приложения.
 */
export const CLIENT_VERSION = `web/${import.meta.env.VITE_APP_VERSION || "dev"}`;

export const clientFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set("x-client-version", CLIENT_VERSION);
  headers.set("x-lang", uiLang());
  return globalThis.fetch(input, { ...init, credentials: "include", headers });
};

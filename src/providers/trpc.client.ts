/* eslint-disable @typescript-eslint/no-explicit-any */
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

export const trpc = createTRPCReact<AppRouter>();

// ── Client-side ZodError translator (safety net for messages that slip through server errorFormatter)
function translateClientError(msg: string): string {
  const m = msg.toLowerCase();
  if (/too_small.*string.*have >=\s*2/.test(m)) return "Поле должно содержать минимум 2 символа";
  if (/too_small.*string.*have >=\s*1/.test(m)) return "Поле не может быть пустым";
  if (/too_small.*number.*have >=\s*1/.test(m)) return "Значение должно быть не менее 1";
  if (/too_big.*string.*have <=\s*(\d+)/.test(m)) {
    const n = msg.match(/have <=\s*(\d+)/);
    return `Поле слишком длинное (максимум ${n?.[1] ?? ""} символов)`;
  }
  if (/invalid_type.*received.*undefined/.test(m)) return "Обязательное поле не заполнено";
  if (/invalid_type.*received.*number/.test(m)) return "Ожидалось числовое значение";
  if (/invalid_type.*received.*string/.test(m)) return "Ожидался текст";
  if (/too_small/.test(m)) return "Значение слишком маленькое";
  if (/too_big/.test(m)) return "Значение слишком большое";
  if (/invalid_string/.test(m)) return "Некорректное значение";
  return msg;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,          // Don't refetch within 30s — eliminates 60-80% redundant calls
      gcTime: 5 * 60_000,        // Keep cache for 5 min after unmount
      refetchOnMount: false,      // Use cached data on mount if fresh
      refetchOnReconnect: false,  // Don't refetch on network reconnect
    },
  },
  queryCache: undefined, // will be set below
});

// Глобальный обработчик ошибок API — показывает toast для всех необработанных ошибок запросов
queryClient.getQueryCache().config.onError = (error: any) => {
  const raw = error?.message || "Ошибка загрузки данных";
  const msg = translateClientError(raw);
  // Не дублируем если компонент уже показал свой toast через onError callback
  console.error("[Query error]", msg);
};

queryClient.getMutationCache().config.onError = (error: any) => {
  const raw = error?.message || "Ошибка сервера";
  const msg = translateClientError(raw);
  console.error("[Mutation error]", msg);
  // Toast показывается в конкретных useMutation({ onError }) — глобальный fallback только логирует
};

const customFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  globalThis.fetch(input, { ...init, credentials: "include" });

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
      false: splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
        false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
      }),
    }),
  ],
});

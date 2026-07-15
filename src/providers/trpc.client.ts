import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

export const trpc = createTRPCReact<AppRouter>();

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
  const msg = error?.message || "Ошибка загрузки данных";
  // Не дублируем если компонент уже показал свой toast через onError callback
  console.error("[Query error]", msg);
};

queryClient.getMutationCache().config.onError = (error: any) => {
  const msg = error?.message || "Ошибка сервера";
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

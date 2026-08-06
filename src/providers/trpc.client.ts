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
      staleTime: 30_000,          // Не перезапрашивать в течение 30 с — снимает основную часть повторов
      gcTime: 5 * 60_000,        // Держать кэш 5 минут после размонтирования
      // refetchOnMount оставлен по умолчанию (true) намеренно.
      //
      // Со значением false запрос, помеченный устаревшим через invalidate, при
      // следующем монтировании отдавал старые данные и НЕ обновлялся никогда.
      // Отсюда шло «добавил магазин — в новом заказе его нет, помогает только
      // Ctrl+Shift+R»: жёсткая перезагрузка выкидывала кэш целиком, а ничто
      // другое его не трогало. Касалось это не только магазинов — так вело себя
      // любое окно, открытое после изменения данных.
      //
      // Экономия при этом почти не теряется: true перезапрашивает только то,
      // что уже считается устаревшим, а staleTime в 30 секунд и так гасит
      // повторные обращения.
      refetchOnReconnect: false,  // Не перезапрашивать при восстановлении сети
    },
  },
  queryCache: undefined, // will be set below
});

// Глобальный обработчик ошибок API — показывает toast для всех необработанных ошибок запросов
queryClient.getQueryCache().config.onError = (error: Error) => {
  const raw = error?.message || "Ошибка загрузки данных";
  const msg = translateClientError(raw);
  // Не дублируем если компонент уже показал свой toast через onError callback
  console.error("[Query error]", msg);
};

queryClient.getMutationCache().config.onError = (error: Error) => {
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

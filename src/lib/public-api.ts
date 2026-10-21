import { createTRPCClient, httpLink } from "@trpc/client";
import type { inferRouterInputs } from "@trpc/server";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import { clientFetch } from "@/lib/client-fetch";

/**
 * Сервер для сайта — без react-query и без приложения.
 *
 * ── Зачем отдельный клиент ──────────────────────────────────────────────────
 *
 * Форма заявки — единственный запрос, который делает гость на лендинге. Она
 * ходила через providers/trpc, а тот тянул за собой react-query, useAuth
 * (запрос auth.me на каждом заходе гостя), поток событий и Sentry с
 * трассировкой: сотни килобайт на первом экране ради одной кнопки
 * «Перезвоните мне». Здесь — голый клиент tRPC: тот же адрес, тот же
 * superjson и те же заголовки версии и языка (lib/client-fetch), поэтому
 * сервер видит заявку с сайта ровно так же, как раньше.
 *
 * Без пакетной отправки (httpLink, а не httpBatchLink): запрос один, склеивать
 * не с чем.
 */
const client = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "/api/trpc", transformer: superjson, fetch: clientFetch })],
});

export type LeadInput = inferRouterInputs<AppRouter>["lead"]["create"];

/** Заявка «перезвоните мне» с сайта (lead.create). */
export function createLead(input: LeadInput) {
  return client.lead.create.mutate(input);
}

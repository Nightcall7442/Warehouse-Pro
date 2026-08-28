import type { Page, APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Общий стенд сквозных проверок.
 *
 * Правило одно: действие — через настоящий экран, проверка — через API.
 *
 * Нарисованное на экране проверять бессмысленно ровно там, где живут денежные
 * ошибки: заказ можно провести так, что бирка «Выполнен» появится, а остаток
 * не спишется. Поэтому «что получилось» читается из того же источника, из
 * которого потом посчитают зарплату и остатки.
 *
 * Вход в приложении по cookie, а page.request работает в контексте страницы —
 * значит запросы отсюда идут уже от вошедшего человека, без отдельной
 * авторизации.
 */

/** Учётные записи из db/seed.ts. Это засев, а не чьи-то настоящие данные. */
export const SEED = {
  ceo: { email: "ceo@demo-uz.uz", password: "password123", home: "/" },
  operator: { email: "operator1@demo-uz.uz", password: "password123", home: "/" },
  agent: { email: "agent-tashkent@demo-uz.uz", password: "password123", home: "/agent" },
  supervisor: { email: "supervisor@demo-uz.uz", password: "password123", home: "/supervisor" },
} as const;

export type SeedRole = keyof typeof SEED;

/**
 * Войти и дождаться начальной страницы роли.
 *
 * Ждём именно тот адрес, куда роль попадает по ROLE_ROUTES. Прежний набор ждал
 * /dashboard для всех — туда роль не переходит, и вход не завершался никогда.
 */
export async function login(page: Page, role: SeedRole = "ceo"): Promise<void> {
  const who = SEED[role];
  await page.goto("/login");
  await page.getByTestId("login-email").fill(who.email);
  await page.getByTestId("login-password").fill(who.password);
  await page.getByTestId("login-submit").click();

  await page.waitForURL(url => new URL(url).pathname === who.home, { timeout: 20_000 });
  // Сессия действительно установлена, а не просто сработал переход.
  const me = await trpcQuery(page, "user.me");
  expect(me, `вход под ${role} не дал сессии`).toMatchObject({ email: who.email });
}

/* ── Обращения к API ───────────────────────────────────────────────────────
 *
 * tRPC настроен на superjson: входные данные заворачиваются в {"json": …},
 * ответ приходит как {"result":{"data":{"json": …}}}. Пишем это явно, чтобы не
 * тянуть в проверки клиент приложения — стенд должен ломаться от изменений в
 * приложении, а не повторять их за ним.
 */

function unwrap(body: unknown, path: string): unknown {
  const r = body as { result?: { data?: { json?: unknown } }; error?: { json?: { message?: string } } };
  if (r?.error) {
    throw new Error(`${path}: ${r.error.json?.message ?? JSON.stringify(r.error)}`);
  }
  if (!r?.result) throw new Error(`${path}: неожиданный ответ ${JSON.stringify(body).slice(0, 200)}`);
  return r.result.data?.json;
}

/** Прочитать что-нибудь у сервера от имени вошедшего. */
export async function trpcQuery<T = unknown>(
  page: Page | { request: APIRequestContext },
  path: string,
  input?: unknown,
): Promise<T> {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await page.request.get(`/api/trpc/${path}${qs}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`${path}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return unwrap(body, path) as T;
}

/** Изменить что-нибудь у сервера от имени вошедшего (для подготовки данных). */
export async function trpcMutate<T = unknown>(
  page: Page | { request: APIRequestContext },
  path: string,
  input: unknown,
): Promise<T> {
  const res = await page.request.post(`/api/trpc/${path}`, { data: { json: input } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`${path}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return unwrap(body, path) as T;
}

/**
 * Число из строки DECIMAL.
 *
 * Сервер отдаёт остатки и суммы строками («1250.000»), и сравнивать их как
 * строки нельзя: «12.50» и «12.5» — одно и то же число.
 */
export function num(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`ожидалось число, пришло ${JSON.stringify(v)}`);
  return n;
}

import type { Page } from "@playwright/test";
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
 * Вход в приложении по cookie, и запросы к API выполняются ИЗ СТРАНИЦЫ —
 * подробности ниже, у функции call. Коротко: отдельный клиент Playwright
 * Secure-куку по http не шлёт, поэтому получал бы 401 всегда.
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

/**
 * Запрос выполняется ИЗ СТРАНИЦЫ, а не клиентом Playwright.
 *
 * page.request — отдельный клиент на стороне Node, и правило Secure он
 * соблюдает буквально: такую куку он шлёт только по https. Сессионная кука
 * приложения ставится с Secure (api/lib/cookies.ts, в production), а проверки
 * ходят по http на 127.0.0.1 — поэтому каждый запрос оттуда получал 401, хотя
 * в браузере человек был вошедшим. Браузер тут отличается от клиента: Chromium
 * считает 127.0.0.1 доверенным источником и Secure-куку принимает.
 *
 * fetch внутри страницы идёт ровно тем же путём, что и запросы приложения:
 * тот же источник, та же кука, те же заголовки. Это и вернее по сути —
 * проверяется то, что доступно приложению, а не отдельному клиенту.
 */
async function call(
  page: Page,
  url: string,
  init?: { method: "POST"; body: string },
): Promise<{ ok: boolean; status: number; text: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      const res = await fetch(url, {
        method: init?.method ?? "GET",
        credentials: "same-origin",
        headers: init ? { "content-type": "application/json" } : undefined,
        body: init?.body,
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    { url, init },
  );
}

function parse(res: { ok: boolean; status: number; text: string }, path: string): unknown {
  let body: unknown = {};
  try {
    body = JSON.parse(res.text);
  } catch {
    throw new Error(`${path}: ответ не JSON (HTTP ${res.status}) ${res.text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return unwrap(body, path);
}

/** Прочитать что-нибудь у сервера от имени вошедшего. */
export async function trpcQuery<T = unknown>(page: Page, path: string, input?: unknown): Promise<T> {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  return parse(await call(page, `/api/trpc/${path}${qs}`), path) as T;
}

/** Изменить что-нибудь у сервера от имени вошедшего (для подготовки данных). */
export async function trpcMutate<T = unknown>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await call(page, `/api/trpc/${path}`, {
    method: "POST",
    body: JSON.stringify({ json: input }),
  });
  return parse(res, path) as T;
}

/** Ответ сервера без разбора — когда важен сам код, а не содержимое. */
export async function trpcStatus(page: Page, path: string): Promise<number> {
  return (await call(page, `/api/trpc/${path}`)).status;
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

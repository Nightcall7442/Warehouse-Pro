/**
 * Отказ входа — на языке интерфейса, и ответ говорит, на каком.
 *
 * Вход идёт мимо tRPC (api/http/auth.ts), поэтому пометки data.lang у него
 * нет — язык ответа приходит заголовком Content-Language. Мобильное
 * приложение по нему верит тексту отказа; без заголовка (старый сервер) —
 * решает по коду ответа.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ env: { appSecret: "тест-секрет", appUrl: "https://wp.test", isProduction: true } }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

import routes from "../http/auth";

async function login(lang?: string) {
  const res = await routes.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...(lang ? { "x-lang": lang } : {}) },
    body: JSON.stringify({ email: "", password: "" }),
  });
  return { status: res.status, lang: res.headers.get("content-language"), body: await res.json() as { error: string } };
}

describe("REST-вход отвечает на языке интерфейса", () => {
  it("x-lang: uz — узбекский текст и Content-Language: uz", async () => {
    expect(await login("uz")).toEqual({ status: 400, lang: "uz", body: { error: "Pochta va parolni kiriting." } });
  });

  it("без заголовка — русский", async () => {
    expect(await login()).toEqual({ status: 400, lang: "ru", body: { error: "Введите почту и пароль." } });
  });
});

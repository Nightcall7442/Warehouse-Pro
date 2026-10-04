/**
 * Отказ сервера — на языке интерфейса того, кто спросил.
 *
 * Проверяется через настоящий HTTP-обработчик tRPC и боевые createRouter /
 * publicQuery / authedQuery: форматтер ошибок вызывается только там.
 * Язык приходит заголовком x-lang; без заголовка — русский, как у старого
 * мобильного приложения, которое заголовка не шлёт.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ env: { isProduction: true, rateLimitWindowMs: 60_000, rateLimitGlobalMax: 1000 } }));
vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => true),
  rateLimitSubject: () => "test",
  getClientIp: () => null,
}));

import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { ErrorMessages } from "@contracts/constants";
import { INTERNAL_ERROR_TEXT } from "@contracts/error-messages";
import type { TrpcContext } from "../context";
import { authedQuery, createRouter, publicQuery } from "../middleware";

const router = createRouter({
  boom: publicQuery.query(() => { throw thrownNow; }),
  form: publicQuery
    .input(z.object({ name: z.string().min(2), password: z.string().min(1, "Введите пароль") }))
    .query(() => "ok"),
  mine: authedQuery.query(() => "ok"),
});

let thrownNow: unknown;

interface Answer { message: string; lang?: string; code?: string }

async function ask(path: string, lang?: string, input?: unknown): Promise<Answer> {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}${qs}`, { headers: lang ? { "x-lang": lang } : {} }),
    router,
    createContext: ({ req, resHeaders }) => ({ req, resHeaders, db: {}, user: null, tenant: null }) as unknown as TrpcContext,
  });
  const body = await res.json() as { error: { json: { message: string; data: { lang?: string; code?: string } } } };
  const { message, data } = body.error.json;
  return { message, lang: data.lang, code: data.code };
}

async function refuse(thrown: unknown, lang?: string): Promise<Answer> {
  thrownNow = thrown;
  return ask("boom", lang);
}

describe("отказ сервера на языке интерфейса", () => {
  it("x-lang: uz — узбекский текст и пометка lang", async () => {
    const a = await refuse(new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" }), "uz");
    expect(a).toMatchObject({ message: "Buyurtma topilmadi", lang: "uz", code: "NOT_FOUND" });
  });

  it("без заголовка — русский, как раньше", async () => {
    const a = await refuse(new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" }));
    expect(a).toMatchObject({ message: "Заказ не найден", lang: "ru" });
  });

  it("незнакомое значение заголовка — тоже русский", async () => {
    const a = await refuse(new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" }), "en");
    expect(a.message).toBe("Заказ не найден");
  });

  it("бизнес-отказ голым Error переводится со значениями", async () => {
    const a = await refuse(new Error("Недостаточно товара: «Сок 1 л» — доступно 3, нужно ещё 7"), "uz");
    expect(a).toMatchObject({ message: "Mahsulot yetarli emas: «Сок 1 л» — mavjud 3, yana 7 kerak", lang: "uz" });
  });

  it("отказ по роли — словами, а не «Insufficient permissions»", async () => {
    const thrown = () => new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
    expect((await refuse(thrown(), "uz")).message).toBe("Ruxsat yo'q: rolingizda bunga huquq yo'q.");
    expect((await refuse(thrown())).message).toBe("Нет доступа: у вашей роли нет прав на это.");
  });

  it("вход без сессии — «войдите снова», а не «обязательное поле не заполнено»", async () => {
    // «Authentication required» содержит «required», и разбор zod раньше
    // словаря выдавал его за пустое поле формы.
    expect(await ask("mine", "uz")).toMatchObject({ message: "Sessiya tugadi. Qaytadan kiring.", lang: "uz", code: "UNAUTHORIZED" });
    expect((await ask("mine")).message).toBe("Сессия закончилась. Войдите снова.");
  });

  describe("внутренняя ошибка остаётся спрятанной — на обоих языках", () => {
    it("ошибка кода", async () => {
      const thrown = () => new TypeError("Cannot read properties of undefined (reading 'id')");
      expect(await refuse(thrown(), "uz")).toMatchObject({ message: INTERNAL_ERROR_TEXT.uz, lang: "uz" });
      expect(await refuse(thrown())).toMatchObject({ message: INTERNAL_ERROR_TEXT.ru, lang: "ru" });
    });

    it("ошибка драйвера с русским значением внутри", async () => {
      const driver = Object.assign(new Error("Duplicate entry 'Магазин' for key 'name'"), { code: "ER_DUP_ENTRY", errno: 1062 });
      const a = await refuse(driver, "uz");
      expect(a.message).toBe(INTERNAL_ERROR_TEXT.uz);
      expect(a.message).not.toMatch(/Магазин|Duplicate/);
    });
  });

  describe("проверка входа (zod)", () => {
    it("своя фраза проверки — переводом из словаря", async () => {
      const a = await ask("form", "uz", { name: "Абвгд", password: "" });
      expect(a).toMatchObject({ message: "Parolni kiriting", lang: "uz", code: "BAD_REQUEST" });
      expect((await ask("form", undefined, { name: "Абвгд", password: "" })).message).toBe("Введите пароль");
    });

    it("общая фраза о поле — на языке интерфейса", async () => {
      const a = await ask("form", "uz", { name: "A", password: "x" });
      expect(a.message).toBe("«Nomi» kamida 2 belgidan iborat bo'lishi kerak");
      expect((await ask("form", "ru", { name: "A", password: "x" })).message).toBe("«Название» должно содержать минимум 2 символа");
    });
  });

  it("незнакомый текст не трогается и не помечается — решает клиент", async () => {
    const a = await refuse(new TRPCError({ code: "BAD_REQUEST", message: "Совсем новый отказ, которого нет в словаре" }), "uz");
    expect(a.message).toBe("Совсем новый отказ, которого нет в словаре");
    expect(a.lang).toBeUndefined();
  });
});

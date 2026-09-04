// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

/**
 * Что Sentry покажет, а что выбросит по дороге.
 *
 * ── Почему это важно проверять ───────────────────────────────────────────────
 *
 * beforeSend — единственное место, которое решает молча. Ошибка, отсеянная
 * здесь, не появляется нигде: ни в Sentry, ни в журнале, ни в письме. Слишком
 * широкое условие превращает сбор ошибок в его видимость.
 *
 * Ровно это и было: прежнее правило выбрасывало ЛЮБУЮ ошибку tRPC, кроме
 * пятисотой. Вместе с шумом уходили 403 из-за сломанной проверки прав и 400
 * из-за неверного запроса — то есть те самые, которые потом ищут глазами.
 *
 * Проверяется в обе стороны: что шум отсеивается И что настоящие ошибки
 * доходят. Одной первой половины мало — ей удовлетворяет `return null`.
 */

const captured = vi.hoisted(() => ({ options: null as any }));

vi.mock("@sentry/react", () => ({
  init: (options: unknown) => { captured.options = options; },
  setUser: vi.fn(),
  setTag: vi.fn(),
  browserTracingIntegration: () => ({ name: "BrowserTracing" }),
  replayIntegration: () => ({ name: "Replay" }),
}));

await import("@/sentry");

/** Событие в том виде, в каком его отдаёт Sentry в beforeSend. */
const event = (message: string) => ({ exception: { values: [{ value: message }] } });
const passes = (message: string) => captured.options.beforeSend(event(message) as any) !== null;

describe("Sentry: что отсеивается", () => {
  it("обрыв связи и обновление кэша приложения — не ошибки кода", () => {
    expect(passes("Failed to fetch")).toBe(false);
    expect(passes("net::ERR_INTERNET_DISCONNECTED")).toBe(false);
    expect(passes("Loading chunk 42 failed")).toBe(false);
    expect(passes("Failed to fetch dynamically imported module: /assets/x.js")).toBe(false);
    expect(passes("workbox-precaching: non-precached-url")).toBe(false);
  });

  it("ожидаемые ответы сервера отсеиваются по коду", () => {
    expect(passes("TRPCClientError: UNAUTHORIZED")).toBe(false);
    expect(passes("TRPCClientError: TOO_MANY_REQUESTS")).toBe(false);
    expect(passes("TRPCClientError: NOT_FOUND")).toBe(false);
  });
});

describe("Sentry: что доходит", () => {
  it("обычная ошибка кода", () => {
    expect(passes("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(true);
  });

  it("пятисотая с сервера", () => {
    expect(passes("TRPCClientError: INTERNAL_SERVER_ERROR")).toBe(true);
  });

  it("неверный запрос с клиента — это поломка, а не обычная работа", () => {
    // Прежнее правило выбрасывало это вместе с шумом: под него подпадало
    // всё, что не пятисотое.
    expect(passes("TRPCClientError: BAD_REQUEST — Ожидается число")).toBe(true);
  });

  it("ошибка без текста не теряется", () => {
    expect(passes("")).toBe(true);
  });
});

describe("Sentry: настройки, влияющие на разбор", () => {
  it("версия проставлена — иначе карты кода не подойдут к стеку", () => {
    // Без release Sentry не найдёт карты кода, и стек останется
    // минифицированным. «dev» — законное значение вне сборки, но пустым
    // поле быть не должно.
    expect(captured.options.release).toBeTruthy();
  });

  it("записи сеансов ведутся только при ошибке", () => {
    // Запись всех подряд посещений — это и деньги, и чужая работа на стороне
    // Sentry без причины.
    expect(captured.options.replaysSessionSampleRate).toBe(0);
    expect(captured.options.replaysOnErrorSampleRate).toBe(1);
  });

  it("личные данные не отправляются по умолчанию", () => {
    expect(captured.options.sendDefaultPii).toBe(false);
  });
});

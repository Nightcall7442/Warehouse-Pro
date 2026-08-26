import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Errors } from "@contracts/errors";

/**
 * Заминка базы не должна выглядеть как «войдите заново».
 *
 * ── Чем это было на самом деле ──────────────────────────────────────────────
 *
 * Мобильный клиент по ответу 401 СТИРАЕТ токен из хранилища и сбрасывает
 * состояние входа (src/api.ts, перехватчик ответа). Это правильно, когда 401
 * значит «токен негодный».
 *
 * Но authenticateRequest ходит в базу: читает пользователя и организацию. Если
 * база не ответила — пул исчерпан, соединение оборвалось, запрос упёрся в
 * таймаут — оттуда летит обычное исключение. А createContext ловил ЛЮБОЕ
 * исключение одинаково: молча оставлял ctx.user пустым, после чего requireAuth
 * отвечал 401.
 *
 * То есть секундная заминка базы выбрасывала торгового агента из аккаунта
 * посреди рабочего дня. Со стороны это и выглядело как «отправил заказ — и
 * выкинуло, надо логиниться заново»: отправка идёт несколькими запросами
 * разом, и достаточно одному попасть в заминку.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Отказ, который сервер выдал сам (нет токена, токен просрочен, запись
 * отключена), — это AppError, и он по-прежнему ведёт к 401: пользователя в
 * контексте нет, requireAuth отвечает «войдите заново».
 *
 * Всё остальное значит «не смогли проверить» — и наружу идёт
 * INTERNAL_SERVER_ERROR, то есть 500. Клиент показывает ошибку и повторяет
 * запрос, сессия остаётся на месте.
 */

const auth = vi.hoisted(() => ({ fail: null as null | (() => never) }));

vi.mock("../auth", () => ({
  authenticateRequest: vi.fn(async () => {
    if (auth.fail) auth.fail();
    return {
      user:   { id: 1, tenantId: 1, email: "agent@example.com", role: "agent", status: "active" },
      tenant: { id: 1, name: "Организация", status: "active" },
    };
  }),
}));

// Настоящее соединение здесь ни при чём: в тестах база не настроена, и getDb()
// упал бы раньше проверки — ответ был бы 500 по совершенно другой причине.
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));

import { createContext } from "../context";

function call() {
  return createContext({
    req: new Request("https://api.example.com/api/trpc/agent.myShops", {
      headers: { Authorization: "Bearer some-token" },
    }),
    resHeaders: new Headers(),
  } as any);
}

beforeEach(() => {
  auth.fail = null;
});

describe("сбой проверки сессии и негодный токен — разные вещи", () => {
  it("оборванное соединение с базой — ошибка сервера, а не «войдите заново»", async () => {
    auth.fail = () => {
      throw Object.assign(new Error("Can't add new command when connection is in closed state"),
        { code: "PROTOCOL_CONNECTION_LOST" });
    };

    await expect(call()).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === "INTERNAL_SERVER_ERROR",
      "ожидался TRPCError с кодом INTERNAL_SERVER_ERROR",
    );
  });

  it("таймаут запроса — тоже ошибка сервера", async () => {
    auth.fail = () => {
      throw Object.assign(new Error("Query execution was interrupted, maximum statement execution time exceeded"),
        { code: "ER_QUERY_TIMEOUT" });
    };

    await expect(call()).rejects.toBeInstanceOf(TRPCError);
  });

  it("негодный токен — контекст без пользователя, дальше отвечает requireAuth", async () => {
    auth.fail = () => { throw Errors.forbidden("Invalid authentication token."); };

    const ctx = await call();

    expect(ctx.user).toBeUndefined();
    expect(ctx.tenant).toBeUndefined();
  });

  it("просроченная сессия — так же", async () => {
    auth.fail = () => { throw Errors.forbidden("Session expired. Please re-login."); };

    const ctx = await call();

    expect(ctx.user).toBeUndefined();
  });

  it("отсутствие токена на публичном пути ничего не ломает", async () => {
    // Вход и регистрация вызываются без токена — там это норма.
    auth.fail = () => { throw Errors.forbidden("Invalid authentication token."); };

    await expect(call()).resolves.toBeDefined();
  });

  it("обычный запрос по-прежнему приносит пользователя и организацию", async () => {
    const ctx = await call();

    expect(ctx.user?.id).toBe(1);
    expect(ctx.tenant?.id).toBe(1);
  });
});

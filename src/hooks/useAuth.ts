import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { LOGIN_PATH } from "@/const";
import * as Sentry from "@sentry/react";

declare global {
  interface Window { __LOGGING_OUT?: boolean }
}

/**
 * Признак «в этом браузере кто-то входил».
 *
 * Сессия живёт в httpOnly-куке, поэтому до ответа `auth.me` фронтенд не знает
 * даже, стоит ли ждать пользователя. Корню сайта это важно: посетитель
 * warehouse-pro.uz должен увидеть лендинг сразу, а не спиннер на весь
 * round-trip до API, — и при этом залогиненный не должен ловить вспышку
 * лендинга перед своим разделом.
 *
 * Флаг ничего не удостоверяет и ничего не открывает: он только подсказывает,
 * что рисовать в первые 200 мс. Любая настоящая проверка по-прежнему на
 * сервере.
 */
const SESSION_HINT = "wp.hadSession";

export function hadSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

function setSessionHint(v: boolean) {
  try {
    if (v) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    /* приватный режим — подсказки просто не будет */
  }
}

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = LOGIN_PATH } =
    options ?? {};

  const navigate = useNavigate();

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  // Set Sentry user context when user data loads
  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: String(user.id), username: user.email });
      Sentry.setContext("tenant", { id: user.tenantId, role: user.role });
      setSessionHint(true);
    } else if (!isLoading) {
      Sentry.setUser(null);
      setSessionHint(false);
    }
  }, [user, isLoading]);

  const logout = useCallback(async () => {
    // Прямой POST на простой эндпоинт (без tRPC, без React state)
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      // Ошибка сервера — всё равно редиректим на /login
    }
    setSessionHint(false);
    // Жёсткий редирект на /login — полная перезагрузка страницы
    window.location.replace(LOGIN_PATH);
  }, []);

  // Редирект на логин если сессия истекла (НО НЕ при logout и НЕ если уже на /login)
  useEffect(() => {
    if (redirectOnUnauthenticated && !isLoading && !user && !window.__LOGGING_OUT) {
      const currentPath = window.location.pathname;
      if (currentPath !== "/login" && currentPath !== redirectPath) {
        navigate(redirectPath, { replace: true });
      }
    }
  }, [redirectOnUnauthenticated, isLoading, user, navigate, redirectPath]);

  return useMemo(
    () => ({
      user:            user ?? null,
      isAuthenticated: !!user,
      isLoading,
      error,
      logout,
      refresh:         refetch,
    }),
    [user, isLoading, error, logout, refetch],
  );
}

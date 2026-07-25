import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { LOGIN_PATH } from "@/const";
import * as Sentry from "@sentry/react";

declare global {
  interface Window { __LOGGING_OUT?: boolean }
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
      Sentry.setContext("tenant", { id: (user as any).tenantId, role: user.role });
    } else if (!isLoading) {
      Sentry.setUser(null);
    }
  }, [user, isLoading]);

  const logout = useCallback(async () => {
    // Прямой POST на простой эндпоинт (без tRPC, без React state)
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      // Ошибка сервера — всё равно редиректим на /login
    }
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

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { trpc, trpcClient, queryClient } from "./trpc.client";
import { useAuth } from "@/hooks/useAuth";
import { connectLiveEvents, onLiveEvent, refreshFor } from "@/lib/live-events";

// eslint-disable-next-line react-refresh/only-export-components
export { trpc, queryClient };

/*
  Единственный поток /api/events на вкладку (см. lib/live-events).

  Слушается "message", а вид события читается из поля type: сервер не пишет
  строку `event:`, и подписка по имени не срабатывала НИ РАЗУ — списки
  заказов и склада не обновлялись сами, и это списывали на «надо обновить
  страницу». Колокольчик (useNotifications) больше свой поток не открывает —
  он подписан на этот.
*/
function SSEListener() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const off = onLiveEvent(e => refreshFor(queryClient, e));
    const close = connectLiveEvents(since => trpcClient.sse.recentEvents.query({ since }));
    return () => { off(); close(); };
  }, [userId]);

  return null;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SSEListener />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}

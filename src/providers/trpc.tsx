import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { trpc, trpcClient, queryClient } from "./trpc.client";
import { useAuth } from "@/hooks/useAuth";

// eslint-disable-next-line react-refresh/only-export-components
export { trpc, queryClient };

function SSEListener() {
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attachListeners = useCallback(function attach(es: EventSource): void {
    /*
      Слушается "message", а вид события читается из поля type.

      Раньше здесь стоял addEventListener("notification.new") — и не срабатывал
      НИ РАЗУ. Сервер пишет в поток только строку `data: {...}`, без строки
      `event:`, поэтому браузер доставляет всё как обычное сообщение, а
      подписка по имени ждёт события, которого не бывает. Молча: ни ошибки, ни
      предупреждения — просто списки заказов и склада не обновлялись сами, и
      это списывали на «надо обновить страницу». Рабочий приём был рядом, в
      useNotifications: он слушает "message" и смотрит на type.
    */
    es.addEventListener("message", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "order.created" || data.type === "order.status_changed") {
          queryClient.invalidateQueries({ queryKey: [["order", "list"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "kpis"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "activity"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "trends"]] });
        }
        if (data.type === "arrival.completed") {
          queryClient.invalidateQueries({ queryKey: [["warehouse"]] });
          queryClient.invalidateQueries({ queryKey: [["product"]] });
        }
        /*
          Ответ поддержки. У него своя адресация: событие приходит тому одному
          человеку, чей это разговор, — рассылать его по организации значило бы
          показать агенту, что директору что-то ответили.
        */
        if (data.type === "support.message") {
          queryClient.invalidateQueries({ queryKey: [["support", "thread"]] });
          queryClient.invalidateQueries({ queryKey: [["support", "unread"]] });
        }
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 5s with listeners re-attached
      reconnectTimer.current = setTimeout(() => {
        if (esRef.current !== null) {
          const newEs = new EventSource("/api/events", { withCredentials: true });
          esRef.current = newEs;
          attach(newEs);
        }
      }, 5000);
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    esRef.current = es;
    attachListeners(es);

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      es.close();
      esRef.current = null;
    };
  }, [user, attachListeners]);

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

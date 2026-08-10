import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { trpc, trpcClient, queryClient } from "./trpc.client";
import { useAuth } from "@/hooks/useAuth";

// eslint-disable-next-line react-refresh/only-export-components
export { trpc, queryClient };

/**
 * Single SSE connection — handles both cache invalidation and notifications.
 *
 * Previously, SSEListener (cache) and useNotifications (unread count) each
 * opened their own EventSource, doubling server load. This component handles
 * both responsibilities so only one persistent connection exists per user.
 */
function SSEListener() {
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attachListeners = useCallback((es: EventSource) => {
    // ── Cache invalidation ──────────────────────────────────────────────
    es.addEventListener("notification.new", (e) => {
      try {
        const data = JSON.parse(e.data);

        // Order events → refresh order list and dashboard
        if (data.type === "order.created" || data.type === "order.status_changed") {
          queryClient.invalidateQueries({ queryKey: [["order", "list"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "kpis"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "activity"]] });
          queryClient.invalidateQueries({ queryKey: [["dashboard", "trends"]] });
        }

        // Arrival events → refresh warehouse and products
        if (data.type === "arrival.completed") {
          queryClient.invalidateQueries({ queryKey: [["warehouse"]] });
          queryClient.invalidateQueries({ queryKey: [["product"]] });
        }

        // Notification events → refresh unread count and list
        if (data.type === "notification.new") {
          if (data.data?.action === "read" || data.data?.action === "read_all") {
            queryClient.invalidateQueries({ queryKey: [["notification", "unreadCount"]] });
          } else {
            queryClient.invalidateQueries({ queryKey: [["notification", "unreadCount"]] });
            queryClient.invalidateQueries({ queryKey: [["notification", "list"]] });
          }
        }
      } catch { /* ignore parse errors (heartbeat, etc.) */ }
    });

    // ── Reconnect on error ──────────────────────────────────────────────
    es.onerror = () => {
      es.close();
      reconnectTimer.current = setTimeout(() => {
        if (esRef.current !== null) {
          const newEs = new EventSource("/api/events", { withCredentials: true });
          esRef.current = newEs;
          attachListeners(newEs);
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

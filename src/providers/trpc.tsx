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

  const attachListeners = useCallback((es: EventSource) => {
    es.addEventListener("notification.new", (e) => {
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
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 5s with listeners re-attached
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

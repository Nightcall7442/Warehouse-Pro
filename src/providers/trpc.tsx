import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { trpc, trpcClient, queryClient } from "./trpc.client";
import { useAuth } from "@/hooks/useAuth";

// eslint-disable-next-line react-refresh/only-export-components
export { trpc, queryClient };

function SSEListener() {
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!user) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    esRef.current = es;

    es.addEventListener("notification.new", (e) => {
      try {
        const data = JSON.parse(e.data);
        // Invalidate relevant queries based on event type
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
      // Reconnect after 5s
      setTimeout(() => {
        if (esRef.current === es) {
          es.close();
          esRef.current = new EventSource("/api/events", { withCredentials: true });
        }
      }, 5000);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [user]);

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

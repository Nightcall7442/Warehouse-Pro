import { useEffect, useState, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";

/**
 * Hook for real-time notifications via SSE.
 * Connects to /api/events, listens for notification.new events,
 * and auto-invalidates tRPC queries to update UI.
 */
export function useNotifications() {
  const utils = trpc.useUtils();
  const [connected, setConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const utilsRef = useRef(utils);

  useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  // Fetch initial unread count
  const { data: countData } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000, // Poll every 30s as fallback
  });

  useEffect(() => {
    if (countData?.count !== undefined) {
      setUnreadCount(countData.count);
    }
  }, [countData?.count]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "notification.new") {
          if (data.data?.action === "read") {
            // Single notification marked read — decrement counter
            setUnreadCount((prev) => Math.max(0, prev - 1));
          } else if (data.data?.action === "read_all") {
            setUnreadCount(0);
          } else {
            // New notification — increment counter and refresh list
            setUnreadCount((prev) => prev + 1);
            utilsRef.current.notification.list.invalidate();
          }
        }
      } catch {
        // Ignore parse errors (heartbeat, etc.)
      }
    });

    es.onerror = () => {
      setConnected(false);
      eventSourceRef.current = null;
      es.close();
      // Reconnect after 5 seconds
      reconnectTimerRef.current = setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  return { connected, unreadCount };
}

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
  /* Метка последнего увиденного события — с неё и продолжаем после обрыва. */
  const lastEventAtRef = useRef(0);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  // Fetch initial unread count
  const { data: countData } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000, // Poll every 30s as fallback
  });

  useEffect(() => {
    if (countData?.count !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnreadCount(countData.count);
    }
  }, [countData?.count]);

  /*
    Одна обработка события на два источника.

    Событие приходит либо живым потоком, либо догоном после обрыва. Разводить
    это в два разных разбора значило бы чинить найденное здесь дважды — а
    расходятся такие копии всегда.
  */
  const applyEvent = useCallback((data: { type?: string; timestamp?: number; data?: { action?: string } }) => {
    if (typeof data.timestamp === "number" && data.timestamp > lastEventAtRef.current) {
      lastEventAtRef.current = data.timestamp;
    }
    if (data.type !== "notification.new") return;

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
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);

      /*
        Догон пропущенного.

        Обрыв связи и пять секунд до переподключения — это дыра, в которую
        уходили уведомления целиком: счётчик не рос, список не обновлялся, и
        человек узнавал о заказе, только зайдя на страницу руками. Метро,
        лифт, переключение с Wi-Fi на мобильную сеть — обрывы обычное дело.

        Ручка sse.recentEvents была написана ровно для этого и не вызывалась
        ниоткуда: сервер помнил недавние события, а спросить их было некому.

        Первое подключение догонять нечего: обрыва не было, а история сервера
        общая на организацию — новый вход показал бы чужие события как
        свежие.
      */
      if (!wasConnectedRef.current) {
        wasConnectedRef.current = true;
        return;
      }
      utilsRef.current.sse.recentEvents
        .fetch({ since: lastEventAtRef.current })
        .then((missed) => { for (const e of missed) applyEvent(e); })
        // Догон — дело поправимое: не вышло, значит следующий обрыв
        // попробует снова. Ронять поток из-за него нельзя.
        .catch(() => {});
    };

    es.addEventListener("message", (event) => {
      try {
        applyEvent(JSON.parse(event.data));
      } catch {
        // Ignore parse errors (heartbeat, etc.)
      }
    });

    es.onerror = () => {
      setConnected(false);
      eventSourceRef.current = null;
      es.close();
      // Reconnect after 5 seconds
      reconnectTimerRef.current = setTimeout(() => {
        // eslint-disable-next-line react-hooks/immutability
        connect();
      }, 5000);
    };
  }, [applyEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  return { connected, unreadCount };
}

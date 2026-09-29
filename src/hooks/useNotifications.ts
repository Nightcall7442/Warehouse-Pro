import { useEffect, useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { onLiveEvent, type LiveEvent } from "@/lib/live-events";

/**
 * Счётчик колокольчика: опрос раз в 30 с плюс живые notification.new.
 *
 * Свой поток /api/events здесь больше не открывается — он один на вкладку
 * (lib/live-events): две связи на вкладку съедали потолок сервера вдвое, и с
 * шестой вкладки потоки начинали выбивать друг друга. Догон после обрыва
 * тоже там — пропущенные события приходят сюда той же подпиской.
 */
export function useNotifications() {
  const utils = trpc.useUtils();
  const [unreadCount, setUnreadCount] = useState(0);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnreadCount(countData.count);
    }
  }, [countData?.count]);

  useEffect(() => onLiveEvent((e: LiveEvent) => {
    if (e.type !== "notification.new") return;
    if (e.data?.action === "read") {
      // Single notification marked read — decrement counter
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } else if (e.data?.action === "read_all") {
      setUnreadCount(0);
    } else {
      // New notification — increment counter and refresh list
      setUnreadCount((prev) => prev + 1);
      utilsRef.current.notification.list.invalidate();
    }
  }), []);

  return { unreadCount };
}

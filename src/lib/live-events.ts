import type { QueryClient } from "@tanstack/react-query";
import { ORDER_AFFECTED_ROUTERS } from "@/hooks/useOrderCacheSync";

/*
  Живые события сервера — один поток на вкладку.

  ── Что было ────────────────────────────────────────────────────────────────

  Поток /api/events открывали двое: провайдер запросов (обновить списки) и
  колокольчик (счётчик уведомлений). Две связи на вкладку при потолке сервера
  в десять на человека (SSE_MAX_PER_USER): с шестой вкладки сервер закрывал
  самые старые, те переподключались и выбивали следующие — по кругу.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Связь одна — её открывает connectLiveEvents (зовёт только SSEListener в
  providers/trpc.tsx), остальные подписываются через onLiveEvent. Догон
  пропущенного после обрыва тоже один и раздаётся всем подписчикам.

  Сервер пишет только `data: {...}` без строки `event:` — поэтому слушается
  "message", а вид читается из поля type (подписка по имени не сработает).
*/

export type LiveEvent = { type?: string; timestamp?: number; data?: Record<string, unknown> };

const listeners = new Set<(e: LiveEvent) => void>();

/** Подписаться на события потока вкладки. Возвращает отписку. */
export function onLiveEvent(fn: (e: LiveEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Открыть поток. Возвращает закрытие.
 *
 * catchUp — догон пропущенного за обрыв (sse.recentEvents): первое
 * подключение не догоняет — обрыва не было, а история сервера общая на
 * организацию, и новый вход показал бы чужие события как свежие.
 */
export function connectLiveEvents(catchUp: (since: number) => Promise<LiveEvent[]>): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastAt = 0;
  let wasOpen = false;
  let closed = false;

  const deliver = (e: LiveEvent) => {
    if (typeof e.timestamp === "number" && e.timestamp > lastAt) lastAt = e.timestamp;
    for (const fn of listeners) fn(e);
  };

  const open = () => {
    const es = new EventSource("/api/events", { withCredentials: true });
    source = es;
    es.onopen = () => {
      if (!wasOpen) { wasOpen = true; return; }
      // Догон — дело поправимое: не вышло, попробует следующий обрыв.
      catchUp(lastAt).then(missed => { for (const e of missed) deliver(e); }).catch(() => {});
    };
    es.addEventListener("message", (m) => {
      let e: LiveEvent;
      try { e = JSON.parse((m as MessageEvent).data); } catch { return; }
      deliver(e);
    });
    es.onerror = () => {
      es.close();
      source = null;
      if (!closed) retry = setTimeout(open, 5000);
    };
  };

  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    source?.close();
    source = null;
  };
}

/*
  Что перечитать по событию — префиксом роутера, как useInvalidateOrderCaches:
  react-query перечитывает только то, что сейчас на экране.

  Пачка из ста заказов — сто событий подряд. Перечитывание склеивается в одно
  на окно в секунду: иначе каждое событие отменяло бы предыдущий запрос и
  начинало свой, и сервер получал бы сотню одинаковых запросов с каждой вкладки.
*/
const REFRESH: Record<string, readonly (readonly string[])[]> = {
  "order.changed": ORDER_AFFECTED_ROUTERS.map(r => [r]),
  "arrival.completed": [["warehouse"], ["warehouseMulti"], ["warehouseReports"], ["product"]],
  // Ответ поддержки адресован одному человеку — сервер шлёт его только ему.
  "support.message": [["support", "thread"], ["support", "unread"]],
};
// ponytail: окно одно на вкладку; при сотнях записей в минуту открытая Главная
// перечитывается раз в секунду — тогда поднять окно или слать событие реже.
export const REFRESH_WINDOW_MS = 1000;

const due = new Map<string, readonly string[]>();
let flush: ReturnType<typeof setTimeout> | null = null;

export function refreshFor(queryClient: QueryClient, e: LiveEvent): void {
  const keys = e.type ? REFRESH[e.type] : undefined;
  if (!keys) return;
  for (const k of keys) due.set(k.join("."), k);
  if (flush) return;
  flush = setTimeout(() => {
    flush = null;
    for (const k of due.values()) queryClient.invalidateQueries({ queryKey: [k] });
    due.clear();
  }, REFRESH_WINDOW_MS);
}

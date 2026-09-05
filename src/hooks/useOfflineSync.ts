import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { getPendingOrders, deletePendingOrder, recordPendingFailure } from "@/pages/OfflineOrders.helpers";
import type { PaymentMethod } from "@/components/orders";

/**
 * Отправка заказов, сохранённых без связи.
 *
 * ── Почему это вынесено из экрана «Офлайн» ─────────────────────────────────
 *
 * Отправка жила в самом экране, то есть работала, только пока он открыт.
 * Агент оформлял заказы в подсобке, выходил на улицу со связью, дальше шёл по
 * приложению — «День», «Магазины», новый заказ, — и очередь всё это время
 * стояла нетронутой. Уходила она лишь когда он сам догадывался открыть
 * «Офлайн». Теперь то же самое включено в оболочке приложения: связь
 * появилась — заказы ушли, на каком бы экране человек ни был.
 *
 * ── Почему заказ с отказом больше не крутится ──────────────────────────────
 *
 * Отправка ловила любую ошибку одинаково и оставляла заказ в очереди. Если
 * сервер отвергал его по существу — товар удалили, магазин закрыли,
 * количество не прошло проверку, — попытка повторялась при каждом заходе и
 * каждом переключении связи, всегда с тем же концом.
 *
 * Хуже того, это закручивалось в петлю: после неудачи список перечитывался,
 * получался новый массив, из-за него менялась сама функция отправки, а на неё
 * был подписан эффект — и отправка запускалась опять, без остановки. Сервер
 * получал этот поток, пока экран открыт.
 *
 * Теперь отказ по существу помечается в записи и выводится человеку: вот
 * причина, вот «Отправить ещё раз», вот «Удалить». Обрыв связи ничем не
 * помечается — это не отказ, а отсутствие связи, и такой заказ ждёт дальше.
 */

/** Заказ, помеченный отказом, сам в отправку не идёт. */
type Pending = Record<string, unknown> & { localId: number; lastError?: string };

function toPaymentMethod(value: unknown): PaymentMethod {
  return value === "card" || value === "transfer" || value === "debt" ? value : "cash";
}

/**
 * Ответил ли сервер вообще.
 *
 * Разница решает судьбу заказа: ответ пришёл — попытка засчитана и, если их
 * набралось достаточно, заказ показывается человеку; ответа не было — это
 * обрыв связи, он ничего не значит и заказ просто ждёт дальше.
 *
 * По коду ответа различать нельзя: сервер отдаёт 500 и на деловой отказ —
 * «Магазин не найден в вашей организации» приходит именно так, проверено на
 * живом стенде. Поэтому смотрим только на сам факт ответа.
 */
export function serverAnswered(error: unknown): boolean {
  return Boolean((error as { data?: { code?: string } })?.data?.code);
}

function reasonOf(error: unknown): string {
  const message = (error as { message?: string })?.message;
  return message && message.length < 300 ? message : "Сервер отклонил заказ";
}

export type OfflineSync = {
  online: boolean;
  pending: Pending[];
  syncing: boolean;
  /** Отправить всё, что ждёт и не помечено отказом. */
  syncAll: () => Promise<{ synced: number; failed: number }>;
  reload: () => Promise<void>;
};

export function useOfflineSync(): OfflineSync {
  const { user } = useAuth();
  const invalidateOrderCaches = useInvalidateOrderCaches();
  // onSuccess обязателен: без сброса кэша «Мои заказы» и сводка на «Дне»
  // остались бы с прежними числами, хотя заказ уже ушёл. Инвариант стережёт
  // src/__tests__/order-cache-invariant.test.ts.
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => invalidateOrderCaches(),
  });

  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<Pending[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Запрет на два одновременных прохода. Признак в состоянии для этого не
  // годится: он обновляется к следующей отрисовке, а второй вызов может
  // прийти раньше — от события связи, пока первый ещё идёт.
  const running = useRef(false);

  useEffect(() => {
    const goOnline  = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const reload = useCallback(async () => {
    if (!user) { setPending([]); return; }
    try {
      setPending(await getPendingOrders(user.id) as Pending[]);
    } catch {
      // База браузера недоступна — приватное окно, запрет на данные сайта.
      // Молча: очередь и так пустая, а ронять экран из-за неё нельзя.
      setPending([]);
    }
  }, [user]);

  const syncAll = useCallback(async () => {
    if (running.current || !navigator.onLine || !user) return { synced: 0, failed: 0 };
    running.current = true;
    setSyncing(true);

    let synced = 0, failed = 0;
    try {
      // Список берём заново, а не из состояния: между отрисовкой и вызовом
      // очередь могла пополниться новым заказом.
      const queue = (await getPendingOrders(user.id) as Pending[]).filter(o => !o.lastError);

      for (const order of queue) {
        try {
          await createOrder.mutateAsync({
            shopId:   order.shopId as number,
            agentId:  (order.agentId as number) ?? user.id,
            items:    order.items as Array<{ productId: number; quantity: string | number }>,
            notes:    order.notes as string | undefined,
            discount: order.discount as string | number | undefined,
            paymentMethod: toPaymentMethod(order.paymentMethod),
            // Ключ повторной отправки берётся сохранённый: без него повтор
            // после обрыва на полпути завёл бы второй такой же заказ.
            idempotencyKey: (order.idempotencyKey as string) || crypto.randomUUID(),
          });
          await deletePendingOrder(order.localId);
          synced++;
        } catch (e) {
          failed++;
          if (!serverAnswered(e)) break; // связь оборвалась — дальше по очереди то же самое
          // Ответ пришёл: засчитываем попытку. Набралось достаточно —
          // заказ уходит из автоматической очереди человеку на глаза.
          await recordPendingFailure(order.localId, reasonOf(e));
        }
      }
    } finally {
      running.current = false;
      setSyncing(false);
      await reload();
      if (synced > 0) invalidateOrderCaches();
    }

    return { synced, failed };
  }, [user, createOrder, reload, invalidateOrderCaches]);

  /*
    Первое чтение очереди из базы браузера.

    Правило про setState в эффекте снимается осознанно: это и есть чтение из
    внешней системы, ради которого эффекты существуют. Синхронного вызова тут
    нет — reload асинхронный, состояние меняется уже после ответа базы, — но
    правило разбирает вызов статически и цепочку не прослеживает.
  */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  /*
    Отправка при появлении связи.

    Подписка на признак связи и на длину очереди, а НЕ на саму функцию
    отправки: у той при каждом перечитывании очереди новая личность, и эффект
    закручивался бы в бесконечный повтор. Ссылку держим отдельно.
  */
  const syncRef = useRef(syncAll);
  // Обновление ссылки — в эффекте, а не во время отрисовки: во время отрисовки
  // это запрещено, компонент обязан быть чистым.
  useEffect(() => { syncRef.current = syncAll; }, [syncAll]);

  useEffect(() => {
    if (online && pending.length > 0) void syncRef.current();
  }, [online, pending.length]);

  return { online, pending, syncing, syncAll, reload };
}

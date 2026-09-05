import { useEffect, useState } from "react";
import { saveOfflineCopy, loadOfflineCopy, currentOwnerId, type OfflineKind } from "@/lib/offline-copy";

/**
 * Данные с сервера, а без связи — отложенная копия.
 *
 * Пришло с сервера — показываем его и заодно откладываем копию. Не пришло и
 * показывать нечего — достаём отложенную. Так агент в подсобке без связи видит
 * каталог и магазины и может собрать заказ, а не пустой экран.
 *
 * Возвращает ещё и признак «это копия» с датой: агент вправе знать, что цены и
 * остатки перед ним могли устареть, — молча выдавать вчерашнее за сегодняшнее
 * нельзя, по остаткам он разговаривает с магазином.
 *
 * Владелец берётся из localStorage (currentOwnerId), а НЕ из useAuth. Это
 * важно: хук зовут каталог и список товаров в мастере — обычные компоненты, у
 * которых ни роутера, ни запроса auth.me нет. С useAuth каталог утянул бы за
 * собой и то и другое, и тесты на выдвижную корзину падали с «useNavigate
 * может использоваться только внутри Router». Проверено.
 */
export function useOfflineCopy<T>(kind: OfflineKind, live: T | undefined): {
  data: T | undefined;
  fromCopy: boolean;
  savedAt: string | null;
} {
  const [copy, setCopy] = useState<{ data: T; savedAt: string } | null>(null);

  /*
    Копия читается один раз: она нужна лишь как запасной путь, а живые данные
    всё равно её перекроют.

    Правило про setState в эффекте снимается осознанно — это чтение из внешнего
    хранилища, ради чего эффекты и существуют.
  */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const owner = currentOwnerId();
    if (owner == null) { setCopy(null); return; }
    setCopy(loadOfflineCopy<T>(kind, owner));
  }, [kind]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Пришли живые — откладываем. Пустой ответ не откладываем: он затёр бы
  // рабочую копию тем, из чего заказ не соберёшь.
  useEffect(() => {
    if (live === undefined) return;
    if (Array.isArray(live) && live.length === 0) return;
    const owner = currentOwnerId();
    if (owner == null) return;
    saveOfflineCopy(kind, owner, live);
  }, [kind, live]);

  if (live !== undefined) return { data: live, fromCopy: false, savedAt: null };
  if (copy) return { data: copy.data, fromCopy: true, savedAt: copy.savedAt };
  return { data: undefined, fromCopy: false, savedAt: null };
}

import { useEffect, useMemo, useState } from "react";
import { saveOfflineCopy, loadOfflineCopy, currentOwnerId, type OfflineKind } from "@/lib/offline-copy";
import type { PriceTier } from "@contracts/price-tiers";

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
export function useOfflineCopy<T>(kind: OfflineKind, live: T | undefined, scope?: number): {
  data: T | undefined;
  fromCopy: boolean;
  savedAt: string | null;
} {
  // Копия помнит, чья она: после смены магазина прежняя не должна мелькнуть
  // ни на одну отрисовку, пока эффект не прочтёт новую.
  const tag = `${kind}.${scope ?? ""}`;
  const [copy, setCopy] = useState<{ tag: string; data: T; savedAt: string } | null>(null);

  /*
    Копия читается один раз: она нужна лишь как запасной путь, а живые данные
    всё равно её перекроют.

    Правило про setState в эффекте снимается осознанно — это чтение из внешнего
    хранилища, ради чего эффекты и существуют.
  */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const owner = currentOwnerId();
    const found = owner == null ? null : loadOfflineCopy<T>(kind, owner, scope);
    setCopy(found && { tag: `${kind}.${scope ?? ""}`, ...found });
  }, [kind, scope]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Пришли живые — откладываем. Пустой ответ не откладываем: он затёр бы
  // рабочую копию тем, из чего заказ не соберёшь.
  useEffect(() => {
    if (live === undefined) return;
    if (Array.isArray(live) && live.length === 0) return;
    const owner = currentOwnerId();
    if (owner == null) return;
    saveOfflineCopy(kind, owner, live, scope);
  }, [kind, live, scope]);

  if (live !== undefined) return { data: live, fromCopy: false, savedAt: null };
  if (copy && copy.tag === tag) return { data: copy.data, fromCopy: true, savedAt: copy.savedAt };
  return { data: undefined, fromCopy: false, savedAt: null };
}

/** Цена товара у магазина: при одной штуке и ступени «от N». */
export type ShopPrice = { id: number; unitPrice: string; tiers: PriceTier[] | null };

/**
 * Цены магазина: живые из product.listAll({ shopId }), а без связи — копия
 * ЭТОГО магазина.
 *
 * Мастер заказа брал цены только из живого ответа. После перезагрузки без
 * связи его нет, и строки, «Итог» и офлайн-итог шли по цене одной штуки мимо
 * ступеней — сервер потом насчитывал другую сумму.
 *
 * В копию — только то, чем считается цена: каталог целиком на каждый магазин
 * переполнил бы хранилище, а имена и остатки лежат в общей копии каталога.
 * Без магазина (shopId 0) не читает и не пишет ничего.
 */
export function useShopPrices(shopId: number | undefined, live: readonly ShopPrice[] | undefined) {
  const prices = useMemo(
    () => shopId && live ? live.map(p => ({ id: p.id, unitPrice: String(p.unitPrice), tiers: p.tiers ?? null })) : undefined,
    [shopId, live],
  );
  return useOfflineCopy<ShopPrice[]>("shopPrices", prices, shopId || 0);
}

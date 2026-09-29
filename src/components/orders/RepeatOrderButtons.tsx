import { Loader2, Plus, Repeat2 } from "lucide-react";
import { useTranslate } from "@/i18n";
import { openQuickOrder } from "@/lib/quick-order";
import { useRepeatOrder } from "@/hooks/useRepeatOrder";

/**
 * «Повторить» в карточке заказа: быстрый заказ тому же магазину тем же составом.
 *
 * Заливки нет: главное действие карточки — «Завершить заказ» или «Закрыть
 * расчёт» (одна заливка на экран), повтор рядом с ним второстепенен.
 */
export function RepeatOrderButton({ orderId }: { orderId: number }) {
  const t = useTranslate();
  const { repeat, pending } = useRepeatOrder();
  return (
    <button type="button" onClick={() => repeat({ orderId })} disabled={pending}
      className="neo-btn tap text-sm" data-testid="order-repeat"
      title={t("Новый заказ этому магазину с тем же составом", "Shu do'konga xuddi shu tarkib bilan yangi buyurtma")}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Repeat2 size={15} />}
      {t("Повторить", "Takrorlash")}
    </button>
  );
}

/**
 * Заказ из карточки магазина: пустой — или «как в прошлый раз».
 *
 * Из карточки магазина заказа не было вовсе: оператор уходил на «Заказы»,
 * искал магазин второй раз и набирал состав с нуля, хотя прошлый заказ
 * магазина лежал на этой же странице.
 */
export function ShopOrderButtons({ shop }: { shop: { id: number; name: string } }) {
  const t = useTranslate();
  const { repeat, pending } = useRepeatOrder();
  return (
    <div className="flex gap-2 flex-wrap">
      <button type="button" onClick={() => openQuickOrder({ shop })}
        className="neo-btn tap text-sm" data-testid="shop-new-order">
        <Plus size={15} />{t("Новый заказ", "Yangi buyurtma")}
      </button>
      <button type="button" onClick={() => repeat({ shopId: shop.id })} disabled={pending}
        className="neo-btn tap text-sm" data-testid="shop-repeat-last"
        title={t("Состав последнего заказа магазина по сегодняшним ценам", "Do'konning oxirgi buyurtmasi tarkibi bugungi narxlarda")}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Repeat2 size={15} />}
        {t("Повторить последний", "Oxirgisini takrorlash")}
      </button>
    </div>
  );
}

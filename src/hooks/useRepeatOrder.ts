import { useCallback, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { notify } from "@/lib/toast";
import { openQuickOrder } from "@/lib/quick-order";

/**
 * «Повторить» — в окно быстрого заказа с магазином и строками.
 *
 * Черновик спрашивается голым клиентом по нажатию, а не useQuery заранее:
 * кнопка стоит на каждой карточке заказа и магазина, и черновик с ценами и
 * остатком нужен ровно тогда, когда его попросили, — свежий, без кэша
 * вчерашних цен.
 *
 * У магазина ещё не было заказов (или своих — у агента) — окно всё равно
 * открывается с выбранным магазином: человек хотел заказ этому магазину,
 * а не сообщение об ошибке.
 */
export function useRepeatOrder() {
  const utils = trpc.useUtils();
  const t = useTranslate();
  const [pending, setPending] = useState(false);

  const repeat = useCallback(async (input: { orderId: number } | { shopId: number }) => {
    setPending(true);
    try {
      const d = await utils.client.order.repeatDraft.query(input);
      if (!d.source) {
        notify.info(t("У магазина ещё нет заказов — наберите новый", "Do'konda hali buyurtma yo'q — yangisini tuzing"));
        openQuickOrder({ shop: d.shop });
        return;
      }
      openQuickOrder({
        shop: d.shop,
        lines: d.lines.map(l => ({
          productId: l.productId, name: l.name, code: l.code,
          unitPrice: Number(l.unitPrice), quantity: Number(l.quantity), available: Number(l.available),
        })),
        skipped: d.skipped,
        repeatOf: d.source.orderNumber,
      });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [utils, t]);

  return { repeat, pending };
}

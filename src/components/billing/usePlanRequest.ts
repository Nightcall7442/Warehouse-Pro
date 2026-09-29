import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";

/**
 * Заявка на тариф или продление — одна на экран подписки и экран блокировки.
 *
 * Ответ человеку строится по `notified`: ушло уведомление оператору или
 * заявка только записана. Обещать «оператор свяжется», когда сообщение
 * никуда не ушло, нельзя — человек будет ждать звонка, которого не будет.
 */
export function usePlanRequest() {
  const t = useTranslate();
  const [sent, setSent] = useState<string | null>(null);
  const request = trpc.billing.requestUpgrade.useMutation({
    onSuccess: (d) => {
      const text = d.notified
        ? t("Заявка отправлена. Оператор свяжется с вами.", "So'rov yuborildi. Operator siz bilan bog'lanadi.")
        : t("Заявка записана. Если в течение дня не перезвонят — позвоните нам сами.",
            "So'rov yozib olindi. Kun davomida qo'ng'iroq qilishmasa — o'zingiz qo'ng'iroq qiling.");
      setSent(text);
      notify.success(text);
    },
    onError: (e) => notify.error(e.message),
  });
  return { request, sent };
}

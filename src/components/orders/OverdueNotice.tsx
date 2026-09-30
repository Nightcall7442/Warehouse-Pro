import { AlertTriangle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";

/**
 * Просрочка магазина — заранее, пока заказ ещё собирается.
 *
 * Заказ магазину с просроченным долгом встаёт на решение офиса
 * (services/overdue-hold.ts). Узнать это после отправки — поздно: агент уже
 * пообещал доставку. Здесь он видит сумму и возраст долга у прилавка и может
 * сначала взять деньги.
 *
 * Ничего не показывает, пока организация проверку не включила или просрочки
 * нет (order.shopOverdue отвечает null). Офис (директор, оператор) решает
 * сам — его заказ не ждёт, и строка говорит это прямо.
 */
export function OverdueNotice({ shopId }: { shopId: number }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const { data } = trpc.order.shopOverdue.useQuery({ shopId }, { enabled: shopId > 0, staleTime: 60_000 });
  if (!data) return null;

  const isOffice = user?.role === "ceo" || user?.role === "operator";
  return (
    <div role="status" data-testid="overdue-notice" className="neo-card neo-card-static"
      style={{ borderRadius: "16px", padding: "10px 14px", margin: "0 0 12px", fontSize: "13px", color: "var(--color-warning-text)", display: "flex", gap: "8px", alignItems: "flex-start" }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
      <span>
        <b>{t("У магазина просрочка", "Do'konda muddati o'tgan qarz")} {fmt(data.amount)}</b>
        {t(`, самый старый долг — ${data.oldestDays} дн. `, `, eng eskisi — ${data.oldestDays} kun. `)}
        {isOffice
          ? t("Вы оформляете от офиса — заказ не встанет на ожидание.", "Siz ofis nomidan rasmiylashtiryapsiz — buyurtma kutishga tushmaydi.")
          : t("Заказ встанет на подтверждение офиса.", "Buyurtma ofis tasdig'ini kutadi.")}
      </span>
    </div>
  );
}

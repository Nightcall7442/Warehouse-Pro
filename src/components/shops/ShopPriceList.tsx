import { Tag } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS } from "@/components/users/types";

/*
  Прайс-лист магазина — на его карточке, а не только в настройках.

  Раньше список назначался из «Настройки → Прайс-листы → магазины», и на
  карточке магазина нельзя было ни увидеть, ни сменить, по каким ценам он
  покупает. Здесь — один выбор: «по карточке товара» или список; он же
  подставляется в новый заказ по умолчанию.
*/
export function ShopPriceList({ shopId }: { shopId: number }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const can = useCan();
  const utils = trpc.useUtils();
  const q = trpc.priceList.forShop.useQuery({ shopId });
  const set = trpc.priceList.setForShop.useMutation({
    onSuccess: () => { utils.priceList.forShop.invalidate({ shopId }); utils.product.invalidate(); notify.success(t("Прайс-лист магазина изменён", "Do'kon narxlar ro'yxati o'zgartirildi")); },
    onError: e => notify.error(e.message),
  });
  const canManage = (user?.role === "ceo" || user?.role === "operator") && can("prices.manage");
  if (!q.data) return null;
  if (q.data.lists.length === 0 && !q.data.current) return null;
  const label = (l: { name: string; markupPct: string | null }) => l.markupPct != null ? `${l.name} (${Number(l.markupPct) > 0 ? "+" : ""}${Number(l.markupPct)}%)` : l.name;
  return (
    <div className="neo-card neo-card-static flex items-center gap-3 flex-wrap" style={{ borderRadius: "20px", padding: "14px 16px" }} data-testid="shop-price-list">
      <Tag size={16} style={{ color: COLORS.primaryText, flexShrink: 0 }} />
      <div className="min-w-0">
        <div style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Прайс-лист", "Narxlar ro'yxati")}</div>
        <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("По этим ценам считаются заказы магазина", "Do'kon buyurtmalari shu narxlar bo'yicha hisoblanadi")}</div>
      </div>
      <div className="ml-auto" style={{ minWidth: 220 }}>
        {canManage ? (
          <PremiumSelect
            value={q.data.current ? String(q.data.current.id) : ""}
            onChange={v => set.mutate({ shopId, priceListId: v ? Number(v) : null })}
            options={[{ value: "", label: t("По карточке товара", "Tovar kartasi bo'yicha") }, ...q.data.lists.map(l => ({ value: String(l.id), label: label(l) }))]}
            width="100%"
          />
        ) : (
          <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{q.data.current ? q.data.current.name : t("По карточке товара", "Tovar kartasi bo'yicha")}</span>
        )}
      </div>
    </div>
  );
}

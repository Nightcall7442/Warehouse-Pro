import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Warehouse } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { sellableWarehouses } from "@/lib/sales-warehouse";

/**
 * С какого склада продать заказ — выбор офиса (ADR 0012).
 *
 * Только директору и оператору (решает NewOrder по mayChooseWarehouse) и
 * только когда продают больше чем с одного склада: в организации без точек
 * продаж выбирать не из чего, и поле было бы лишним.
 *
 * «Склад агента заказа» — не выбирать: сервер возьмёт склад агента, на
 * которого оформлен заказ, а если он не закреплён — основной. Выбор стоит на
 * шаге «Товары», над каталогом: остаток и цены ниже — этого склада.
 */
export function SalesWarehousePicker({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { data } = trpc.warehouseMulti.list.useQuery();
  const sellable = sellableWarehouses(data);
  if (sellable.length < 2) return null;

  return (
    <div className="neo-card p-3 mb-3" data-testid="sales-warehouse-picker">
      <p className="font-label text-[10px] text-secondary tracking-wider flex items-center gap-1.5 mb-2">
        <Warehouse size={12} />
        {t("СКЛАД ПРОДАЖИ", "SAVDO OMBORI")}
      </p>
      <PremiumSelect
        value={String(value)}
        onChange={v => onChange(Number(v))}
        width="100%"
        aria-label={t("С какого склада продать заказ", "Buyurtmani qaysi ombordan sotish")}
        options={[
          { value: "0", label: t("Склад агента заказа", "Buyurtma agentining ombori") },
          ...sellable.map(w => ({ value: String(w.id), label: w.isDefault ? `${w.name} (${t("основной", "asosiy")})` : w.name })),
        ]}
      />
      <p className="text-xs text-tertiary mt-1.5" style={{ lineHeight: 1.45 }}>
        {t("Остаток и цены ниже — этого склада. С него же зарезервируется заказ.",
           "Quyidagi qoldiq va narxlar — shu omborniki. Buyurtma ham shu ombordan zahiralanadi.")}
      </p>
    </div>
  );
}

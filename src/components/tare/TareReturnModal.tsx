import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { PremiumSelect } from "@/components/PremiumSelect";
import { COLORS, thStyle, tdStyle } from "@/components/users/types";
import { Check, X } from "lucide-react";

/*
  Приём пустой тары от магазина — на склад или на машину.
  Больше, чем у магазина числится, принять нельзя: система и покажет, сколько.
*/
export function TareReturnModal({ shopId, shopName, onClose, onDone }: { shopId: number; shopName: string; onClose: () => void; onDone: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const held = trpc.tare.shop.useQuery({ shopId });
  const warehouses = trpc.warehouseMulti.list.useQuery();
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const ret = trpc.tare.returnFromShop.useMutation({ onSuccess: r => { notify.success(t(`Принято ${formatQty(r.units)} ед. тары`, `${formatQty(r.units)} dona idish qabul qilindi`)); onDone(); }, onError: e => notify.error(e.message) });
  const whOptions = [{ value: "", label: t("— куда —", "— qayerga —") }, ...(warehouses.data ?? []).map(w => ({ value: String(w.id), label: `${w.name}${w.isDefault ? " ★" : ""}` }))];
  const effectiveWh = warehouseId || String((warehouses.data ?? []).find(w => w.isDefault)?.id ?? "");
  const items = (held.data ?? []).filter(h => Number(qty[h.tareTypeId] ?? 0) > 0).map(h => ({ tareTypeId: h.tareTypeId, quantity: Number(qty[h.tareTypeId]) }));
  return (
    <AppModal open onClose={onClose} title={t(`Принять тару от «${shopName}»`, `«${shopName}» dan idish qabul qilish`)} maxWidth={620} dirty={items.length > 0}>
      <div className="space-y-4">
        <div>
          <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("Куда", "Qayerga")}</span>
          <PremiumSelect value={effectiveWh} onChange={setWarehouseId} options={whOptions} width="100%" />
        </div>
        {(held.data ?? []).length === 0 ? <p className="text-sm" style={{ color: COLORS.textTertiary }}>{t("У магазина тары не числится", "Do'konda idish hisoblanmagan")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={thStyle}>{t("Тара", "Idish")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("У магазина", "Do'konda")}</th><th style={{ ...thStyle, textAlign: "right", width: 120 }}>{t("Вернул", "Qaytardi")}</th></tr></thead>
            <tbody>{(held.data ?? []).map(h => (
              <tr key={h.tareTypeId} className="row-hover">
                <td style={tdStyle}>{h.name}{h.depositPrice > 0 && <span className="font-data" style={{ color: COLORS.textTertiary, fontSize: 11 }}> · {t("залог", "garov")} {fmt(h.depositPrice)}</span>}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{formatQty(h.qty)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}><input className="neo-input font-data" inputMode="decimal" style={{ width: 100, textAlign: "right" }} value={qty[h.tareTypeId] ?? ""} onChange={e => setQty({ ...qty, [h.tareTypeId]: e.target.value.replace(/[^\d.]/g, "") })} aria-label={h.name} data-testid={`tare-return-${h.tareTypeId}`} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <input className="neo-input w-full" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t("Примечание (необязательно)", "Izoh (ixtiyoriy)")} />
        <div className="flex gap-2 flex-wrap">
          <button className="neo-btn-primary flex items-center gap-2" disabled={!items.length || !effectiveWh || ret.isPending} data-testid="tare-return-submit" onClick={() => ret.mutate({ shopId, warehouseId: Number(effectiveWh), items, note: note || undefined })}><Check size={16} /> {t("Принять", "Qabul qilish")}</button>
          <button className="neo-btn flex items-center gap-2" onClick={onClose}><X size={16} /> {t("Отмена", "Bekor")}</button>
        </div>
      </div>
    </AppModal>
  );
}

import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { PremiumSelect } from "@/components/PremiumSelect";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Boxes, Pencil, Check, X } from "lucide-react";

/*
  Тара товара — в его карточке: вид и сколько штук на единицу.
  Показывается только при включённом учёте тары; правит тот, кто правит товары.
*/
export function ProductTare({ productId, tareTypeId, perUnit, canEdit }: { productId: number; tareTypeId: number | null; perUnit: number; canEdit: boolean }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const status = trpc.tare.status.useQuery();
  const types = trpc.tare.types.useQuery(undefined, { enabled: status.data?.enabled === true });
  const [edit, setEdit] = useState<{ typeId: string; per: string } | null>(null);
  const save = trpc.tare.setProductTare.useMutation({ onSuccess: () => { utils.product.getById.invalidate({ id: productId }); setEdit(null); notify.success(t("Тара товара сохранена", "Tovar idishi saqlandi")); }, onError: e => notify.error(e.message) });
  if (!status.data?.enabled) return null;
  const type = (types.data ?? []).find(x => x.id === tareTypeId);
  return (
    <span className="flex items-center gap-1.5" data-testid="product-tare">
      <Boxes size={13} />
      {edit ? (
        <span className="flex items-center gap-1.5">
          <PremiumSelect value={edit.typeId} onChange={v => setEdit({ ...edit, typeId: v })} options={[{ value: "", label: t("— без тары —", "— idishsiz —") }, ...(types.data ?? []).filter(x => x.isActive).map(x => ({ value: String(x.id), label: x.name }))]} width="180px" />
          {edit.typeId && <>×<DecimalInput className="neo-input font-data" style={{ width: 72 }} value={edit.per} onValueChange={v => setEdit({ ...edit, per: v })} aria-label={t("Тары на единицу", "Birlikka idish")} /></>}
          <button type="button" className="neo-btn neo-btn-xs" disabled={save.isPending} onClick={() => save.mutate({ productId, tareTypeId: edit.typeId ? Number(edit.typeId) : null, perUnit: Number(edit.per) || 1 })} aria-label={t("Сохранить", "Saqlash")}><Check size={12} /></button>
          <button type="button" className="neo-btn neo-btn-xs" onClick={() => setEdit(null)} aria-label={t("Отмена", "Bekor")}><X size={12} /></button>
        </span>
      ) : (
        <>
          {type ? <>{t("тара", "idish")}: {type.name} × {formatQty(perUnit)}</> : <span className="text-tertiary">{t("без тары", "idishsiz")}</span>}
          {canEdit && <button type="button" className="neo-btn neo-btn-xs" onClick={() => setEdit({ typeId: tareTypeId ? String(tareTypeId) : "", per: String(perUnit || 1) })} aria-label={t("Задать тару", "Idishni belgilash")}><Pencil size={11} /></button>}
        </>
      )}
    </span>
  );
}

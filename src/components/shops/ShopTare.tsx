import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { formatQty } from "@/lib/format";
import { Boxes, ArrowDownToLine } from "lucide-react";
import { TareReturnModal } from "@/components/tare/TareReturnModal";

/* Тара у магазина — в его карточке: штуки и залог, «Принять тару». */
export function ShopTare({ shopId, shopName }: { shopId: number; shopName: string }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const status = trpc.tare.status.useQuery();
  const held = trpc.tare.shop.useQuery({ shopId }, { enabled: status.data?.enabled === true });
  const [open, setOpen] = useState(false);
  if (!status.data?.enabled) return null;
  const rows = held.data ?? [];
  const deposit = rows.reduce((s, r) => s + r.deposit, 0);
  const canReturn = user?.role === "ceo" || user?.role === "operator";
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }} data-testid="shop-tare">
      {open && <TareReturnModal shopId={shopId} shopName={shopName} onClose={() => setOpen(false)} onDone={() => { setOpen(false); utils.tare.shop.invalidate({ shopId }); utils.tare.overview.invalidate(); }} />}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2"><Boxes size={16} style={{ color: "var(--color-primary-text)" }} /><b style={{ fontFamily: "inherit" }}>{t("Тара у магазина", "Do'kondagi idish")}</b></div>
        {canReturn && rows.length > 0 && <button className="neo-btn neo-btn-sm" onClick={() => setOpen(true)} data-testid="shop-tare-return"><ArrowDownToLine size={13} /> {t("Принять тару", "Idish qabul qilish")}</button>}
      </div>
      {rows.length === 0 ? <p className="text-sm text-tertiary mt-2">{t("Тары за магазином не числится", "Do'konda idish hisoblanmagan")}</p> : (
        <div className="mt-2 space-y-1 text-sm">
          {rows.map(r => <div key={r.tareTypeId} className="flex justify-between gap-3"><span>{r.name}</span><span className="font-data">{formatQty(r.qty)}{r.deposit > 0 ? <span className="text-tertiary"> · {fmt(r.deposit)}</span> : null}</span></div>)}
          {deposit > 0 && <div className="flex justify-between gap-3 pt-1" style={{ borderTop: "1px solid var(--color-border-subtle)" }}><span className="text-secondary">{t("Залог, если не вернут", "Qaytarmasa — garov")}</span><b className="font-data">{fmt(deposit)}</b></div>}
        </div>
      )}
    </div>
  );
}

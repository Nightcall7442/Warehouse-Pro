import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { SectionNotice } from "@/components/SectionNotice";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format, subDays, addDays } from "date-fns";
import { Boxes, Truck, Store, FileSpreadsheet, ArrowDownToLine, Ban, ClipboardCheck, Check, X } from "lucide-react";
import { AppModal } from "@/components/ui/AppModal";
import { TareReturnModal } from "./TareReturnModal";

/*
  Тара на складе: где сколько (склады, машины), у кого сколько (магазины —
  штуки и залог), приём пустой тары, списание невозвращённой в долг, журнал.
*/
type T = (ru: string, uz: string) => string;
const REASON: Record<string, [string, string]> = { follow: ["с товаром", "tovar bilan"], return: ["возврат тары", "idish qaytarish"], charge: ["списано в долг", "qarzga yozildi"], count: ["пересчёт", "sanash"], adjust: ["правка", "tuzatish"] };

export function TareTab() {
  const { lang } = useLang();
  const t: T = (ru, uz) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const isCeo = user?.role === "ceo";
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const o = trpc.tare.overview.useQuery();
  const [ret, setRet] = useState<{ id: number; name: string } | null>(null);
  const [countFor, setCountFor] = useState<{ id: number; name: string; lines: Array<{ tareTypeId: number; name: string; qty: number }> } | null>(null);
  const refresh = () => { utils.tare.overview.invalidate(); utils.tare.shop.invalidate(); utils.tare.movements.invalidate(); utils.shop.getById.invalidate(); };
  const charge = trpc.tare.charge.useMutation({ onSuccess: r => { refresh(); notify.success(r.amount > 0 ? t(`Списано в долг магазина: ${fmt(r.amount)}`, `Do'kon qarziga yozildi: ${fmt(r.amount)}`) : t("Тара снята с магазина", "Idish do'kondan olib tashlandi")); }, onError: e => notify.error(e.message) });
  const d = o.data;
  const label = { fontFamily: F.display, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLORS.textTertiary };

  const doCharge = async (shop: { id: number; name: string }, line: { tareTypeId: number; name: string; qty: number; deposit: number }) => {
    const reason = window.prompt(t(`Списать ${formatQty(line.qty)} × ${line.name} у «${shop.name}» в долг${line.deposit > 0 ? ` (${fmt(line.deposit)})` : ""}. Причина:`, `«${shop.name}» dan ${formatQty(line.qty)} × ${line.name} qarzga yozish${line.deposit > 0 ? ` (${fmt(line.deposit)})` : ""}. Sabab:`));
    if (!reason || reason.trim().length < 3) return;
    if (await confirm({ title: t("Списать тару в долг?", "Idishni qarzga yozish?"), message: line.deposit > 0 ? t(`Долг магазина вырастет на ${fmt(line.deposit)} — по залогу. Штуки снимутся.`, `Do'kon qarzi ${fmt(line.deposit)} ga oshadi — garov bo'yicha. Dona olib tashlanadi.`) : t("Залога нет — штуки снимутся с причиной, денег не будет.", "Garov yo'q — dona sabab bilan olib tashlanadi, pul bo'lmaydi."), confirmText: t("Списать", "Yozish"), danger: true }))
      charge.mutate({ shopId: shop.id, tareTypeId: line.tareTypeId, quantity: line.qty, reason: reason.trim() });
  };

  return (
    <div className="space-y-4">
      {dialog}
      {ret && <TareReturnModal shopId={ret.id} shopName={ret.name} onClose={() => setRet(null)} onDone={() => { setRet(null); refresh(); }} />}
      {countFor && <TareCountModal t={t} target={countFor} onClose={() => setCountFor(null)} onDone={() => { setCountFor(null); refresh(); }} />}
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {[
          { label: t("У магазинов", "Do'konlarda"), n: d?.totals.atShops ?? 0, sub: t("штук тары на руках у магазинов", "do'konlar qo'lidagi idish"), icon: Store, fmtN: (n: number) => formatQty(n) },
          { label: t("Залог у магазинов", "Do'konlardagi garov"), n: d?.totals.depositAtShops ?? 0, sub: t("если не вернут — в долг", "qaytarmasa — qarzga"), icon: Boxes, fmtN: (n: number) => fmt(n) },
        ].map(tile => (
          <div key={tile.label} className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }}>
            <div className="flex items-center justify-between"><div style={label}>{tile.label}</div><tile.icon size={16} style={{ color: COLORS.textTertiary }} /></div>
            <div className="font-data" style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: tile.n === 0 ? COLORS.textTertiary : COLORS.textPrimary, marginTop: "6px", lineHeight: 1 }}>{tile.fmtN(tile.n)}</div>
            <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {(d?.types.length ?? 0) === 0 ? <SectionNotice kind="empty" message={t("Виды тары не заведены — Настройки → Возвратная тара", "Idish turlari kiritilmagan — Sozlamalar → Qaytariladigan idish")} /> : (
        <>
          <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
            <div style={{ padding: "6px 10px", fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("На складах и машинах", "Omborlar va mashinalarda")}</div>
            {(d?.warehouses.length ?? 0) === 0 ? <SectionNotice kind="empty" message={t("Тары на складах нет — она придёт с приходом товара", "Omborlarda idish yo'q — tovar kirimi bilan keladi")} /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
                  <thead><tr><th style={thStyle}>{t("Где", "Qayerda")}</th>{d!.types.map(x => <th key={x.id} style={{ ...thStyle, textAlign: "right" }}>{x.name}</th>)}<th style={thStyle}></th></tr></thead>
                  <tbody>{d!.warehouses.map(w => (
                    <tr key={w.id} className="row-hover">
                      <td style={tdStyle}>{w.van ? <Truck size={13} style={{ display: "inline", marginRight: 6, color: COLORS.textTertiary }} /> : null}{w.name}</td>
                      {d!.types.map(x => { const l = w.lines.find(y => y.tareTypeId === x.id); return <td key={x.id} className="font-data" style={{ ...tdStyle, textAlign: "right", color: l ? COLORS.textPrimary : COLORS.textTertiary }}>{l ? formatQty(l.qty) : "—"}</td>; })}
                      {/* Машину считают во вкладке «Машины» вместе с товаром — там недостача ложится долгом водителя. */}
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>{!w.van && <button className="neo-btn neo-btn-xs tap" onClick={() => setCountFor({ id: w.id, name: w.name, lines: w.lines })} data-testid={`tare-count-${w.id}`}><ClipboardCheck size={12} /> {t("Пересчёт", "Sanash")}</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
            <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "6px 10px" }}>
              <div style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("У магазинов", "Do'konlarda")} · {d?.shops.length ?? 0}</div>
              <button className="neo-btn neo-btn-sm" onClick={() => exportToExcel([{
                name: "Тара у магазинов",
                data: (d?.shops ?? []).flatMap(s => s.lines.map(l => ({ shop: s.name, tare: l.name, qty: l.qty, deposit: l.deposit }))),
                columns: [{ key: "shop", header: "Магазин", width: 28 }, { key: "tare", header: "Тара", width: 18 }, { key: "qty", header: "Штук", width: 10 }, { key: "deposit", header: "Залог", width: 14 }],
              }], "tare-shops")}><FileSpreadsheet size={14} /> Excel</button>
            </div>
            {(d?.shops.length ?? 0) === 0 ? <SectionNotice kind="empty" message={t("Магазины тару не держат", "Do'konlarda idish yo'q")} /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
                  <thead><tr><th style={thStyle}>{t("Магазин", "Do'kon")}</th><th style={thStyle}>{t("Тара", "Idish")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Штук", "Dona")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Залог", "Garov")}</th><th style={thStyle}></th></tr></thead>
                  <tbody>{(d?.shops ?? []).map(s => (
                    <tr key={s.id} className="row-hover" data-testid={`tare-shop-${s.id}`}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                      <td style={tdStyle}>{s.lines.map(l => <div key={l.tareTypeId} className="flex items-center gap-2">{l.name}{isCeo && l.qty > 0 && <button className="neo-btn neo-btn-xs tap" title={t("Списать в долг", "Qarzga yozish")} onClick={() => doCharge(s, l)} data-testid={`tare-charge-${s.id}-${l.tareTypeId}`}><Ban size={11} /></button>}</div>)}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{s.lines.map(l => <div key={l.tareTypeId}>{formatQty(l.qty)}</div>)}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: s.deposit > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{s.deposit > 0 ? fmt(s.deposit) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}><button className="neo-btn neo-btn-xs tap" onClick={() => setRet({ id: s.id, name: s.name })} data-testid={`tare-return-${s.id}`}><ArrowDownToLine size={12} /> {t("Принять тару", "Idish qabul qilish")}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <TareMovements t={t} />
        </>
      )}
    </div>
  );
}

/** Пересчёт тары на складе: бой и потери — списываются с причиной; на машине это делает пересчёт машины. */
function TareCountModal({ t, target, onClose, onDone }: { t: T; target: { id: number; name: string; lines: Array<{ tareTypeId: number; name: string; qty: number }> }; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const count = trpc.tare.count.useMutation({ onSuccess: r => { notify.success(r.lines.some(l => l.diff !== 0) ? t("Пересчёт проведён: остаток тары поправлен", "Sanash o'tkazildi: idish qoldig'i tuzatildi") : t("Пересчёт: всё сошлось", "Sanash: hammasi to'g'ri")); onDone(); }, onError: e => notify.error(e.message) });
  const counted = target.lines.map(l => ({ tareTypeId: l.tareTypeId, quantity: Number(qty[l.tareTypeId] ?? l.qty) }));
  return (
    <AppModal open onClose={onClose} title={t(`Пересчёт тары: ${target.name}`, `Idish sanash: ${target.name}`)} maxWidth={560}>
      <div className="space-y-4">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={thStyle}>{t("Тара", "Idish")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("По системе", "Tizim bo'yicha")}</th><th style={{ ...thStyle, textAlign: "right", width: 120 }}>{t("По факту", "Amalda")}</th></tr></thead>
          <tbody>{target.lines.map(l => (
            <tr key={l.tareTypeId} className="row-hover">
              <td style={tdStyle}>{l.name}</td>
              <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary }}>{formatQty(l.qty)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}><input className="neo-input font-data" inputMode="decimal" style={{ width: 100, textAlign: "right" }} value={qty[l.tareTypeId] ?? String(l.qty)} onChange={e => setQty({ ...qty, [l.tareTypeId]: e.target.value.replace(/[^\d.]/g, "") })} aria-label={l.name} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex gap-2 flex-wrap">
          <button className="neo-btn-primary flex items-center gap-2" disabled={count.isPending || !counted.length} onClick={() => count.mutate({ warehouseId: target.id, counted })} data-testid="tare-count-submit"><Check size={16} /> {t("Провести", "O'tkazish")}</button>
          <button className="neo-btn flex items-center gap-2" onClick={onClose}><X size={16} /> {t("Отмена", "Bekor")}</button>
        </div>
      </div>
    </AppModal>
  );
}

function TareMovements({ t }: { t: T }) {
  const [now] = useState(() => new Date());
  const range = useMemo(() => ({ from: subDays(now, 30).toISOString(), to: addDays(now, 1).toISOString() }), [now]);
  const q = trpc.tare.movements.useQuery(range);
  const rows = q.data ?? [];
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      <div style={{ padding: "6px 10px", fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Движения за 30 дней", "30 kunlik harakatlar")} · {rows.length}</div>
      {rows.length === 0 ? <SectionNotice kind="empty" message={t("Движений тары не было", "Idish harakati bo'lmagan")} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
            <thead><tr><th style={thStyle}>{t("Когда", "Qachon")}</th><th style={thStyle}>{t("Тара", "Idish")}</th><th style={thStyle}>{t("Держатель", "Egasi")}</th><th style={{ ...thStyle, textAlign: "right" }}>±</th><th style={thStyle}>{t("Почему", "Nima uchun")}</th></tr></thead>
            <tbody>{rows.slice(0, 200).map(r => (
              <tr key={r.id} className="row-hover">
                <td style={tdStyle}>{format(new Date(r.createdAt), "dd.MM HH:mm")}</td>
                <td style={tdStyle}>{r.tareName}</td>
                <td style={tdStyle}>{r.holderKind === "shop" ? t("магазин", "do'kon") : t("склад", "ombor")} #{String(r.holderId)}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: r.delta < 0 ? "var(--color-danger-text)" : "var(--color-success-text)" }}>{r.delta > 0 ? "+" : ""}{formatQty(r.delta)}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{REASON[r.reason] ? t(REASON[r.reason][0], REASON[r.reason][1]) : r.reason}{r.note && r.reason !== "follow" ? ` · ${r.note}` : ""}{r.by ? ` · ${r.by}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

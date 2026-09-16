import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useConfirm } from "@/components/ConfirmDialog";
import { SectionNotice } from "@/components/SectionNotice";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format, subDays, addDays, differenceInDays } from "date-fns";
import { FileSpreadsheet, CreditCard, Landmark, Check, Undo2, Clock, AlertTriangle } from "lucide-react";

/*
  Безнал — карта и перевод под выпиской.

  Платёж «переводом» — обещание денег. Здесь кассир сверяет его с выпиской
  банка и ставит «пришло»; что не пришло — сторно, долг магазина вернётся.
  Свой платёж подтвердить нельзя (директор — может): записал один, сверил
  другой. Просроченные висят на том, кто записал, и вечером уходят директору.
*/

type T = (ru: string, uz: string) => string;
type Fmt = (v: number | string | null | undefined, opts?: { decimals?: number }) => string;
type State = "transit" | "overdue" | "confirmed" | "reversed";
type Method = "card" | "transfer";

const METHOD: Record<Method, { ru: string; uz: string; icon: typeof CreditCard }> = {
  card: { ru: "Карта", uz: "Karta", icon: CreditCard },
  transfer: { ru: "Перевод", uz: "O'tkazma", icon: Landmark },
};

export function NonCashTab({ t, fmt, userId, isCeo, refresh }: { t: T; fmt: Fmt; userId: number; isCeo: boolean; refresh: () => void }) {
  const L = t("ru", "uz") as "ru" | "uz";
  const [days, setDays] = useState(30);
  const [now] = useState(() => new Date());
  const [state, setState] = useState<State | "">("");
  const [method, setMethod] = useState<Method | "">("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bankRef, setBankRef] = useState("");
  const range = useMemo(() => ({ from: subDays(now, days).toISOString(), to: addDays(now, 1).toISOString() }), [days, now]);
  const q = trpc.cash.nonCash.useQuery({ ...range, method: method || undefined, status: state || undefined });
  const s = trpc.cash.nonCashSummary.useQuery();
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const done = () => { q.refetch(); s.refetch(); utils.cash.mine.invalidate(); refresh(); };
  const confirmM = trpc.cash.bankConfirm.useMutation({
    onSuccess: r => { setSelected(new Set()); setBankRef(""); done(); notify.success(t(`Подтверждено: ${r.confirmed} на ${fmt(r.total)}`, `Tasdiqlandi: ${r.confirmed} ta, ${fmt(r.total)}`)); },
    onError: e => notify.error(e.message),
  });
  const reverse = trpc.shop.reversePayment.useMutation({
    onSuccess: () => { done(); notify.success(t("Платёж сторнирован — долг магазина вернулся", "To'lov storno qilindi — do'kon qarzi qaytdi")); },
    onError: e => notify.error(e.message),
  });

  const rows = q.data?.rows ?? [];
  const sum = s.data;
  const canConfirm = (r: { state: State; createdBy: number | null }) => (r.state === "transit" || r.state === "overdue") && (isCeo || r.createdBy !== userId);
  const selectable = rows.filter(canConfirm);
  const allSelected = selectable.length > 0 && selectable.every(r => selected.has(r.id));
  const selectedTotal = rows.filter(r => selected.has(r.id)).reduce((a, r) => a + r.amount, 0);

  const STATE_LABEL: Record<State, string> = {
    transit: t("в пути", "yo'lda"), overdue: t("просрочен", "muddati o'tgan"), confirmed: t("подтверждён", "tasdiqlangan"), reversed: t("сторно", "storno"),
  };

  const submit = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!(await confirm({
      title: t(`Пришло на счёт: ${ids.length} на ${fmt(selectedTotal)}?`, `Hisobga keldi: ${ids.length} ta, ${fmt(selectedTotal)}?`),
      message: t("Вы сверили эти платежи с выпиской банка. Отменить подтверждение нельзя — только сторно платежа.", "Bu to'lovlarni bank ko'chirmasi bilan solishtirdingiz. Tasdiqni bekor qilib bo'lmaydi — faqat to'lov stornosi."),
      confirmText: t("Пришло", "Keldi"),
    }))) return;
    confirmM.mutate({ ids, bankRef: bankRef.trim() || undefined });
  };

  return (
    <div className="space-y-4">
      {dialog}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: t("В ПУТИ", "YO'LDA"), value: fmt(sum?.transit.total ?? 0), icon: Clock, sub: t(`${sum?.transit.count ?? 0} платежей ждут выписки`, `${sum?.transit.count ?? 0} to'lov ko'chirma kutmoqda`) },
          { label: t("ПРОСРОЧЕНО", "MUDDATI O'TGAN"), value: fmt(sum?.overdue.total ?? 0), icon: AlertTriangle, sub: t(`${sum?.overdue.count ?? 0} дольше ${sum?.days ?? 3} дн.`, `${sum?.overdue.count ?? 0} ta ${sum?.days ?? 3} kundan uzoq`), danger: (sum?.overdue.count ?? 0) > 0 },
          { label: t("ПОДТВЕРЖДЕНО СЕГОДНЯ", "BUGUN TASDIQLANDI"), value: fmt(sum?.confirmedToday.total ?? 0), icon: Check, sub: t(`${sum?.confirmedToday.count ?? 0} по выписке`, `${sum?.confirmedToday.count ?? 0} ko'chirma bo'yicha`) },
          { label: t("КАРТА", "KARTA"), value: fmt(q.data?.totals.card ?? 0), icon: CreditCard, sub: t(`за ${days} дн.`, `${days} kun`) },
          { label: t("ПЕРЕВОД", "O'TKAZMA"), value: fmt(q.data?.totals.transfer ?? 0), icon: Landmark, sub: t(`за ${days} дн.`, `${days} kun`) },
        ].map(tile => (
          <div key={tile.label} className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }} data-testid={`noncash-tile-${tile.label}`}>
            <div className="flex items-center justify-between">
              <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }}>{tile.label}</div>
              <tile.icon size={16} style={{ color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }} />
            </div>
            <div className="font-data" style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: tile.danger ? "var(--color-danger-text)" : COLORS.textPrimary, marginTop: "6px", lineHeight: 1 }}>{tile.value}</div>
            <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {sum && sum.byEmployee.some(e => e.overdueCount > 0) && (
        <div className="neo-card neo-card-static" style={{ borderRadius: "16px", padding: "12px 16px", borderLeft: "3px solid var(--color-danger-text)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-danger-text)", marginBottom: 4 }}>{t("Просроченные переводы по людям", "Muddati o'tgan o'tkazmalar — odamlar bo'yicha")}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: "13px" }}>
            {sum.byEmployee.filter(e => e.overdueCount > 0).map(e => (
              <span key={e.id}>{e.name}: <b className="font-data">{fmt(e.overdueTotal)}</b> <span style={{ color: COLORS.textTertiary }}>({e.overdueCount})</span></span>
            ))}
          </div>
        </div>
      )}

      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
        <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "6px 10px" }}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="range-pills">{[7, 30, 90].map(d => <button key={d} className={"range-pill tap" + (days === d ? " active" : "")} onClick={() => setDays(d)}>{d} {t("дн.", "kun")}</button>)}</div>
            <div className="range-pills">
              {([["", t("все", "hammasi")], ["transit", STATE_LABEL.transit], ["overdue", STATE_LABEL.overdue], ["confirmed", STATE_LABEL.confirmed]] as [State | "", string][]).map(([k, label]) => (
                <button key={k || "all"} className={"range-pill tap" + (state === k ? " active" : "")} onClick={() => { setState(k); setSelected(new Set()); }} data-testid={`noncash-state-${k || "all"}`}>{label}</button>
              ))}
            </div>
            <div className="range-pills">
              {([["", t("карта + перевод", "karta + o'tkazma")], ["card", METHOD.card[L]], ["transfer", METHOD.transfer[L]]] as [Method | "", string][]).map(([k, label]) => (
                <button key={k || "any"} className={"range-pill tap" + (method === k ? " active" : "")} onClick={() => { setMethod(k); setSelected(new Set()); }}>{label}</button>
              ))}
            </div>
          </div>
          <button className="neo-btn neo-btn-sm" onClick={() => exportToExcel([{
            name: "Безнал",
            data: rows.map(r => ({
              date: format(new Date(r.createdAt), "dd.MM.yyyy HH:mm"), method: METHOD[r.method].ru, shop: r.shopName, order: r.orderNumber ?? "", amount: r.amount,
              by: r.createdByName ?? "", state: { transit: "в пути", overdue: "просрочен", confirmed: "подтверждён", reversed: "сторно" }[r.state],
              confirmedAt: r.bankConfirmedAt ? format(new Date(r.bankConfirmedAt), "dd.MM.yyyy HH:mm") : "", confirmedBy: r.bankConfirmedByName ?? "", bankRef: r.bankRef ?? "", notes: r.notes ?? "",
            })),
            columns: [
              { key: "date", header: "Дата", width: 16 }, { key: "method", header: "Способ", width: 10 }, { key: "shop", header: "Магазин", width: 24 }, { key: "order", header: "Заказ", width: 16 },
              { key: "amount", header: "Сумма", width: 14 }, { key: "by", header: "Записал", width: 20 }, { key: "state", header: "Состояние", width: 14 },
              { key: "confirmedAt", header: "Подтверждено", width: 16 }, { key: "confirmedBy", header: "Кем", width: 20 }, { key: "bankRef", header: "Операция банка", width: 18 }, { key: "notes", header: "Примечание", width: 30 },
            ],
          }], `noncash-${days}d`)}><FileSpreadsheet size={14} /> Excel</button>
        </div>

        {selectable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" style={{ padding: "6px 10px 10px" }}>
            <input className="neo-input font-data" style={{ maxWidth: 260 }} value={bankRef} onChange={e => setBankRef(e.target.value)} maxLength={64}
              placeholder={t("№ операции или выписки (не обязательно)", "Operatsiya yoki ko'chirma № (ixtiyoriy)")} data-testid="noncash-bankref" />
            <button className="neo-btn-primary" disabled={selected.size === 0 || confirmM.isPending} onClick={submit} data-testid="noncash-confirm">
              <Check size={15} /> {t(`Пришло на счёт`, `Hisobga keldi`)}{selected.size > 0 ? ` · ${selected.size} · ${fmt(selectedTotal)}` : ""}
            </button>
            <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>{t("Отметьте платежи, которые нашли в выписке банка", "Bank ko'chirmasida topilgan to'lovlarni belgilang")}</span>
          </div>
        )}

        {q.isLoading ? <div className="p-6 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div>
          : rows.length === 0 ? <SectionNotice kind="empty" message={t("Платежей картой и переводом за этот срок нет", "Bu davrda karta va o'tkazma to'lovlari yo'q")} />
          : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "960px" }}>
                <thead><tr>
                  <th style={{ ...thStyle, width: 32 }}>{selectable.length > 0 && <input type="checkbox" checked={allSelected} aria-label={t("Выбрать все", "Hammasini tanlash")} onChange={e => setSelected(e.target.checked ? new Set(selectable.map(r => r.id)) : new Set())} />}</th>
                  <th style={thStyle}>{t("Дата", "Sana")}</th><th style={thStyle}>{t("Способ", "Usul")}</th><th style={thStyle}>{t("Магазин", "Do'kon")}</th><th style={thStyle}>{t("Заказ", "Buyurtma")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th><th style={thStyle}>{t("Записал", "Yozgan")}</th><th style={thStyle}>{t("Состояние", "Holat")}</th><th style={thStyle}></th>
                </tr></thead>
                <tbody>{rows.map(r => {
                  const Icon = METHOD[r.method].icon;
                  const age = differenceInDays(now, new Date(r.createdAt));
                  const own = r.createdBy === userId && !isCeo;
                  return (
                    <tr key={r.id} className="row-hover" style={{ opacity: r.state === "reversed" ? 0.6 : 1 }} data-testid={`noncash-row-${r.id}`}>
                      <td style={tdStyle}>{canConfirm(r) && <input type="checkbox" checked={selected.has(r.id)} aria-label={t("Выбрать", "Tanlash")} onChange={e => { const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSelected(n); }} />}</td>
                      <td style={tdStyle}>{format(new Date(r.createdAt), "dd.MM HH:mm")}</td>
                      <td style={tdStyle}><Icon size={13} style={{ display: "inline", marginRight: 4 }} />{METHOD[r.method][L]}</td>
                      <td style={tdStyle}>{r.shopName}</td>
                      <td className="font-data" style={tdStyle}>{r.orderNumber ?? "—"}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600, textDecoration: r.state === "reversed" ? "line-through" : "none" }}>{fmt(r.amount)}</td>
                      <td style={tdStyle}>{r.createdByName ?? "—"}{own && r.state !== "confirmed" && r.state !== "reversed" && <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("свой — подтвердит другой", "o'ziniki — boshqasi tasdiqlaydi")}</div>}</td>
                      <td style={tdStyle}>
                        {r.state === "confirmed" && <span style={{ color: "var(--color-success-text)" }}><Check size={12} style={{ display: "inline" }} /> {format(new Date(r.bankConfirmedAt!), "dd.MM")} · {r.bankConfirmedByName ?? "—"}{r.bankRef ? <span className="font-data" style={{ color: COLORS.textTertiary }}> · {r.bankRef}</span> : ""}</span>}
                        {r.state === "transit" && <span style={{ color: "var(--color-warning-text)" }}><Clock size={12} style={{ display: "inline" }} /> {STATE_LABEL.transit} · {age} {t("дн.", "kun")}</span>}
                        {r.state === "overdue" && <span style={{ color: "var(--color-danger-text)", fontWeight: 600 }}><AlertTriangle size={12} style={{ display: "inline" }} /> {STATE_LABEL.overdue} · {age} {t("дн.", "kun")}</span>}
                        {r.state === "reversed" && <span style={{ color: COLORS.textTertiary }}><Undo2 size={12} style={{ display: "inline" }} /> {STATE_LABEL.reversed}</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        {(r.state === "transit" || r.state === "overdue") && (
                          <button className="neo-btn neo-btn-xs tap" title={t("Не пришло — сторно платежа", "Kelmadi — to'lov stornosi")} data-testid={`noncash-reverse-${r.id}`} onClick={async () => {
                            const reason = window.prompt(t("Деньги не пришли. Причина сторно (обязательно):", "Pul kelmadi. Storno sababi (majburiy):"));
                            if (!reason || reason.trim().length < 3) return;
                            if (await confirm({ title: t(`Сторно ${fmt(r.amount)} · ${r.shopName}?`, `Storno ${fmt(r.amount)} · ${r.shopName}?`), message: t("Долг магазина вернётся, платёж останется в журнале парой строк.", "Do'kon qarzi qaytadi, to'lov jurnalda juft qator bo'lib qoladi."), confirmText: t("Сторно", "Storno"), danger: true })) reverse.mutate({ paymentId: r.id, reason: reason.trim() });
                          }}><Undo2 size={13} /> {t("Не пришло", "Kelmadi")}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { printCashOrder, printCashBook } from "@/lib/documents";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { NonCashTab } from "@/components/cash/NonCashTab";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format, subDays, addDays } from "date-fns";
import {
  Vault, HandCoins, ArrowDownToLine, ArrowUpFromLine, Lock, Unlock, FileSpreadsheet, Printer, Loader2,
  AlertTriangle, ShieldCheck, Undo2, BookOpen, Settings2,
} from "lucide-react";

/*
  Касса — «где деньги физически».

  Платёж наличными записывает курьер у магазина, и с этой секунды деньги
  «на руках» у него. Здесь кассир их принимает: система называет, сколько
  ожидает, кассир вводит, сколько принёс, сотрудник подтверждает PIN-кодом —
  расхождение становится его долгом, не «ой». Расход — по статье из сейфа.
  Вечером день закрывается пересчётом сейфа.

  Ничего не редактируется: ошибка — сторно с причиной, оба документа видны.
*/

type Tab = "holders" | "noncash" | "journal" | "book" | "days" | "settings";

const DENOMS = [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export default function Cash() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const isCeo = user?.role === "ceo";
  const { fmt } = useCurrency();
  const { company } = useSellerCompany();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("holders");

  const overview = trpc.cash.overview.useQuery(undefined, { refetchInterval: 60_000 });
  const nonCash = trpc.cash.nonCashSummary.useQuery(undefined, { refetchInterval: 120_000 });
  const refresh = () => { utils.cash.overview.invalidate(); utils.cash.journal.invalidate(); utils.cash.days.invalidate(); utils.cash.cashBook.invalidate(); utils.cash.nonCashSummary.invalidate(); utils.cash.nonCash.invalidate(); };

  /* ── Окна ─────────────────────────────────────────────────────────────── */
  const [handoverFor, setHandoverFor] = useState<{ id: number; name: string; onHand: number; hasPin: boolean } | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState<"deposit" | "withdrawal" | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [writeOffFor, setWriteOffFor] = useState<{ id: number; name: string; debt: number } | null>(null);

  const invalidate = (msg: string) => { refresh(); notify.success(msg); };
  const handover = trpc.cash.handover.useMutation({
    onSuccess: r => {
      setHandoverFor(null);
      if (r.discrepancy < 0) notify.error(t(`${r.number}: недостача ${fmt(-r.discrepancy)} записана долгом сотрудника`, `${r.number}: ${fmt(-r.discrepancy)} kamomad xodim qarziga yozildi`));
      else if (r.discrepancy > 0) notify.success(t(`${r.number}: излишек ${fmt(r.discrepancy)} — до выяснения`, `${r.number}: ${fmt(r.discrepancy)} ortiqcha — aniqlanguncha`));
      else notify.success(t(`${r.number}: принято ${fmt(r.expected)}`, `${r.number}: ${fmt(r.expected)} qabul qilindi`));
      refresh();
    },
    onError: e => notify.error(e.message),
  });
  const expense = trpc.cash.expense.useMutation({ onSuccess: r => { setExpenseOpen(false); invalidate(t(`${r.number} проведён`, `${r.number} o'tkazildi`)); }, onError: e => notify.error(e.message) });
  const ownerMove = trpc.cash.ownerMove.useMutation({ onSuccess: r => { setOwnerOpen(null); invalidate(t(`${r.number} проведён`, `${r.number} o'tkazildi`)); }, onError: e => notify.error(e.message) });
  const writeOff = trpc.cash.writeOff.useMutation({ onSuccess: r => { setWriteOffFor(null); invalidate(t(`${r.number}: долг списан`, `${r.number}: qarz hisobdan chiqarildi`)); }, onError: e => notify.error(e.message) });
  const closeDay = trpc.cash.closeDay.useMutation({
    onSuccess: r => {
      setCloseOpen(false); refresh();
      if (r.discrepancy === 0) notify.success(t("День закрыт: сейф сошёлся", "Kun yopildi: seyf to'g'ri chiqdi"));
      else notify.error(t(`День закрыт с расхождением ${fmt(r.discrepancy)} — записано документом`, `Kun ${fmt(r.discrepancy)} farq bilan yopildi — hujjat yozildi`));
    },
    onError: e => notify.error(e.message),
  });

  const o = overview.data;

  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>{t("Касса", "Kassa")}</h1>
          <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>
            {t("Где наличные сейчас: на руках, в сейфе, в расходах", "Naqd pul hozir qayerda: qo'lda, seyfda, xarajatda")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="neo-btn" onClick={() => setExpenseOpen(true)} data-testid="cash-expense"><ArrowUpFromLine size={15} /><span className="hidden sm:inline">{t("Расход", "Xarajat")}</span></button>
          {isCeo && <button className="neo-btn" onClick={() => setOwnerOpen("deposit")} data-testid="cash-deposit"><ArrowDownToLine size={15} /><span className="hidden sm:inline">{t("Внесение", "Kiritish")}</span></button>}
          {isCeo && <button className="neo-btn" onClick={() => setOwnerOpen("withdrawal")} data-testid="cash-withdrawal"><Vault size={15} /><span className="hidden sm:inline">{t("Выемка", "Olish")}</span></button>}
          {o?.dayClosed
            ? <span className="neo-btn" style={{ color: "var(--color-success-text)", cursor: "default" }}><Lock size={15} />{t("День закрыт", "Kun yopiq")}</span>
            : <button className="neo-btn-primary" onClick={() => setCloseOpen(true)} data-testid="cash-close-day"><Lock size={15} />{t("Закрыть день", "Kunni yopish")}</button>}
        </div>
      </div>

      {overview.isError ? <QueryErrorFallback message={overview.error.message} onRetry={() => overview.refetch()} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: t("СЕЙФ", "SEYF"), value: fmt(o?.office ?? 0), icon: Vault, sub: o?.dayClosed ? t("день закрыт", "kun yopiq") : t("на сейчас", "hozir") },
            { label: t("НА РУКАХ", "QO'LDA"), value: fmt(o?.onHandTotal ?? 0), icon: HandCoins, sub: t("у сотрудников", "xodimlarda"), danger: (o?.holders ?? []).some(h => h.overLimit) },
            { label: t("ПРИНЯТО СЕГОДНЯ", "BUGUN QABUL"), value: fmt(o?.todayIn ?? 0), icon: ArrowDownToLine, sub: t("наличные у магазинов", "do'konlardan naqd") },
            { label: t("СДАНО СЕГОДНЯ", "BUGUN TOPSHIRILDI"), value: fmt(o?.todayOut ?? 0), icon: ArrowUpFromLine, sub: t("в сейф", "seyfga") },
            { label: t("ДОЛГИ СОТРУДНИКОВ", "XODIMLAR QARZI"), value: fmt(o?.employeeDebtTotal ?? 0), icon: AlertTriangle, sub: t("недостачи", "kamomadlar"), danger: (o?.employeeDebtTotal ?? 0) > 0 },
          ].map(tile => (
            <div key={tile.label} className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }}>
              <div className="flex items-center justify-between">
                <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }}>{tile.label}</div>
                <tile.icon size={16} style={{ color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }} />
              </div>
              <div className="font-data" style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary, marginTop: "6px", lineHeight: 1 }}>{tile.value}</div>
              <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" }}>{tile.sub}</div>
            </div>
          ))}
        </div>
      )}

      {o && o.ledgerSum !== 0 && (
        <SectionNotice kind="error" message={t(`Баланс счетов не сходится на ${fmt(o.ledgerSum)} — сообщите в поддержку`, `Hisoblar balansi ${fmt(o.ledgerSum)} ga to'g'ri kelmayapti — qo'llab-quvvatlashga yozing`)} />
      )}
      {/* Безнал без выписки дольше срока — это не «ждём», это чей-то перевод, которого нет. */}
      {tab !== "noncash" && (nonCash.data?.overdue.count ?? 0) > 0 && (
        <button type="button" className="w-full text-left tap" onClick={() => setTab("noncash")} data-testid="noncash-overdue-notice">
          <SectionNotice kind="error" message={t(`Безнал: ${nonCash.data!.overdue.count} платежей на ${fmt(nonCash.data!.overdue.total)} не подтверждены выпиской дольше ${nonCash.data!.days} дн. — откройте «Безнал»`, `Naqdsiz: ${nonCash.data!.overdue.count} ta to'lov ${fmt(nonCash.data!.overdue.total)} ${nonCash.data!.days} kundan beri ko'chirma bilan tasdiqlanmagan — «Naqdsiz»ni oching`)} />
        </button>
      )}

      <div role="tablist" className="range-pills">
        {([["holders", t("На руках", "Qo'lda")], ["noncash", t("Безнал", "Naqdsiz")], ["journal", t("Журнал", "Jurnal")], ["book", t("Кассовая книга", "Kassa kitobi")], ["days", t("Дни", "Kunlar")], ...(isCeo ? [["settings", t("Настройки", "Sozlamalar")]] : [])] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={"range-pill tap" + (tab === k ? " active" : "")} data-testid={`cash-tab-${k}`}>{label}{k === "noncash" && (nonCash.data?.overdue.count ?? 0) > 0 ? ` · ${nonCash.data!.overdue.count}` : ""}</button>
        ))}
      </div>

      {tab === "holders" && <Holders o={o} loading={overview.isLoading} t={t} fmt={fmt} isCeo={isCeo}
        onHandover={h => setHandoverFor({ id: h.id, name: h.name, onHand: h.onHand, hasPin: h.hasPin })}
        onWriteOff={h => setWriteOffFor({ id: h.id, name: h.name, debt: h.debt })} />}
      {tab === "noncash" && <NonCashTab t={t} fmt={fmt} userId={user?.id ?? 0} isCeo={isCeo} refresh={refresh} />}
      {tab === "journal" && <Journal t={t} fmt={fmt} isCeo={isCeo} company={company} refresh={refresh} />}
      {tab === "book" && <CashBookTab t={t} fmt={fmt} company={company} />}
      {tab === "days" && <DaysTab t={t} fmt={fmt} isCeo={isCeo} refresh={refresh} />}
      {tab === "settings" && isCeo && <SettingsTab t={t} fmt={fmt} refresh={refresh} />}

      {/* ── Принять сдачу ─────────────────────────────────────────────── */}
      {handoverFor && (
        <HandoverModal person={handoverFor} onClose={() => setHandoverFor(null)} t={t} fmt={fmt} pending={handover.isPending}
          onSubmit={v => handover.mutate({ fromUserId: handoverFor.id, ...v })} />
      )}

      {/* ── Расход ────────────────────────────────────────────────────── */}
      {expenseOpen && <ExpenseModal onClose={() => setExpenseOpen(false)} t={t} fmt={fmt} pending={expense.isPending} office={o?.office ?? 0} onSubmit={v => expense.mutate(v)} />}

      {/* ── Внесение / выемка ─────────────────────────────────────────── */}
      {ownerOpen && (
        <AmountModal title={ownerOpen === "deposit" ? t("Внесение в кассу", "Kassaga kiritish") : t("Выемка из кассы", "Kassadan olish")}
          hint={ownerOpen === "deposit" ? t("Деньги директора — в сейф: стартовый остаток или возврат", "Direktor puli — seyfga: boshlang'ich qoldiq yoki qaytarish") : t(`В сейфе ${fmt(o?.office ?? 0)}`, `Seyfda ${fmt(o?.office ?? 0)}`)}
          onClose={() => setOwnerOpen(null)} t={t} pending={ownerMove.isPending}
          onSubmit={(amount, note) => ownerMove.mutate({ direction: ownerOpen, amount, note })} />
      )}

      {/* ── Списание долга ────────────────────────────────────────────── */}
      {writeOffFor && (
        <AmountModal title={t(`Списать долг: ${writeOffFor.name}`, `Qarzni chiqarish: ${writeOffFor.name}`)}
          hint={t(`Долг ${fmt(writeOffFor.debt)}. Списание — расход «недостача»; причина обязательна, событие уйдёт в журнал.`, `Qarz ${fmt(writeOffFor.debt)}. Chiqarish — «kamomad» xarajati; sabab majburiy.`)}
          initial={writeOffFor.debt} requireNote onClose={() => setWriteOffFor(null)} t={t} pending={writeOff.isPending}
          onSubmit={(amount, note) => writeOff.mutate({ userId: writeOffFor.id, amount, reason: note ?? "" })} />
      )}

      {/* ── Закрыть день ──────────────────────────────────────────────── */}
      {closeOpen && (
        <AmountModal title={t("Закрыть день: пересчёт сейфа", "Kunni yopish: seyfni sanash")}
          hint={t(`По системе в сейфе ${fmt(o?.office ?? 0)}. Введите, сколько насчитали: расхождение станет документом.`, `Tizim bo'yicha seyfda ${fmt(o?.office ?? 0)}. Sanaganingizni kiriting: farq hujjat bo'ladi.`)}
          initial={o?.office ?? 0} onClose={() => setCloseOpen(false)} t={t} pending={closeDay.isPending}
          onSubmit={async (amount) => {
            const diff = amount - (o?.office ?? 0);
            if (diff !== 0 && !(await confirm({ title: t("Расхождение сейфа", "Seyf farqi"), message: t(`Разница ${fmt(diff)} будет проведена ${diff < 0 ? "долгом кассира" : "как излишек до выяснения"}. Закрыть день?`, `${fmt(diff)} farq ${diff < 0 ? "kassir qarzi" : "ortiqcha"} sifatida o'tkaziladi. Kun yopilsinmi?`), confirmText: t("Закрыть", "Yopish"), danger: diff < 0 }))) return;
            closeDay.mutate({ countedBalance: amount });
          }} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
type T = (ru: string, uz: string) => string;
type Fmt = (v: number | string | null | undefined, opts?: { decimals?: number }) => string;
type Holder = { id: number; name: string; role: string; hasPin: boolean; onHand: number; debt: number; todayIn: number; todayOut: number; lastHandoverAt: Date | string | null; overLimit: boolean };

const ROLE: Record<string, [string, string]> = { agent: ["агент", "agent"], courier: ["курьер", "kuryer"], merchandiser: ["мерчандайзер", "merchandayzer"], supervisor: ["супервайзер", "supervayzer"] };

function Holders({ o, loading, t, fmt, isCeo, onHandover, onWriteOff }: {
  o: { holders: Holder[]; limit: number; deadline: string } | undefined; loading: boolean; t: T; fmt: Fmt; isCeo: boolean;
  onHandover: (h: Holder) => void; onWriteOff: (h: Holder) => void;
}) {
  const lang = t("ru", "uz") as "ru" | "uz";
  const rows = o?.holders ?? [];
  const [now] = useState(() => Date.now());
  const daysSince = (d: Date | string | null) => d ? Math.floor((now - new Date(d).getTime()) / 86_400_000) : null;
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      <div style={{ padding: "10px 14px 4px", fontSize: "12px", color: COLORS.textSecondary }}>
        {t(`Лимит на руках ${fmt(o?.limit ?? 0)} · сдать до ${o?.deadline ?? "19:00"}`, `Qo'ldagi limit ${fmt(o?.limit ?? 0)} · ${o?.deadline ?? "19:00"} gacha topshirish`)}
      </div>
      {loading ? <div className="p-6 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div>
        : rows.length === 0 ? <SectionNotice kind="empty" message={t("Наличных на руках ни у кого нет", "Hech kimning qo'lida naqd pul yo'q")} />
        : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
              <thead><tr>
                <th style={thStyle}>{t("Сотрудник", "Xodim")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Принял сегодня", "Bugun qabul")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Сдал сегодня", "Bugun topshirdi")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("На руках", "Qo'lda")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Долг", "Qarz")}</th>
                <th style={thStyle}>{t("Последняя сдача", "Oxirgi topshirish")}</th>
                <th style={thStyle}></th>
              </tr></thead>
              <tbody>
                {rows.map(h => {
                  const since = daysSince(h.lastHandoverAt);
                  return (
                    <tr key={h.id} className="row-hover" data-testid={`cash-holder-${h.id}`}>
                      <td style={tdStyle}><div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{h.name}</div><div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{ROLE[h.role]?.[lang === "uz" ? 1 : 0] ?? h.role}{h.hasPin ? "" : ` · ${t("без PIN", "PIN yo'q")}`}</div></td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(h.todayIn)}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(h.todayOut)}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: h.overLimit ? "var(--color-danger-text)" : COLORS.textPrimary }}>{fmt(h.onHand)}{h.overLimit && <span title={t("выше лимита", "limitdan yuqori")}> ⚠</span>}</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: h.debt > 0 ? "var(--color-danger-text)" : COLORS.textSecondary }}>{h.debt > 0 ? fmt(h.debt) : "—"}</td>
                      <td style={{ ...tdStyle, color: since != null && since > 1 ? "var(--color-danger-text)" : COLORS.textSecondary }}>{h.lastHandoverAt ? format(new Date(h.lastHandoverAt), "dd.MM HH:mm") : t("ещё не сдавал", "hali topshirmagan")}{since != null && since > 1 ? ` · ${since} ${t("дн.", "kun")}` : ""}</td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="neo-btn-primary neo-btn-xs tap" disabled={h.onHand <= 0} onClick={() => onHandover(h)} data-testid={`cash-handover-${h.id}`}><HandCoins size={13} /> {t("Принять сдачу", "Topshiriqni qabul")}</button>
                        {isCeo && h.debt > 0 && <button className="neo-btn neo-btn-xs tap" style={{ marginLeft: 6 }} onClick={() => onWriteOff(h)} data-testid={`cash-writeoff-${h.id}`}>{t("Списать", "Chiqarish")}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function HandoverModal({ person, onClose, onSubmit, t, fmt, pending }: {
  person: { id: number; name: string; onHand: number; hasPin: boolean }; onClose: () => void; t: T; fmt: Fmt; pending: boolean;
  onSubmit: (v: { amount: number; pin?: string; paperSigned?: boolean; denominations?: Record<string, number>; note?: string }) => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [manual, setManual] = useState("");
  const [pin, setPin] = useState("");
  const [paper, setPaper] = useState(false);
  const [note, setNote] = useState("");
  const byDenoms = useMemo(() => DENOMS.reduce((s, d) => s + d * (Number(counts[d] ?? 0) || 0), 0), [counts]);
  const amount = manual !== "" ? Number(manual) : byDenoms;
  const diff = amount - person.onHand;
  return (
    <AppModal open onClose={onClose} title={t(`Принять сдачу: ${person.name}`, `Topshiriqni qabul qilish: ${person.name}`)} subtitle={t(`Ожидается ${fmt(person.onHand)}`, `Kutilmoqda ${fmt(person.onHand)}`)} maxWidth={640} dirty
      footer={<>
        <button className="neo-btn-primary flex-1 h-12 text-sm" disabled={pending || amount < 0 || (person.hasPin ? pin.length < 4 : !paper)} data-testid="cash-handover-submit"
          onClick={() => onSubmit({ amount, pin: person.hasPin ? pin : undefined, paperSigned: !person.hasPin ? paper : undefined, denominations: manual === "" ? Object.fromEntries(Object.entries(counts).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) : undefined, note: note || undefined })}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <HandCoins size={16} />}{t("Провести ПКО", "PKO o'tkazish")}
        </button>
        <button className="neo-btn flex-1 h-12 text-sm" onClick={onClose}>{t("Отмена", "Bekor")}</button>
      </>}>
      <div>
        <p className={modalSectionLabel}>{t("Купюры", "Kupyuralar")}</p>
        <div className="grid grid-cols-4 gap-2">
          {DENOMS.map(d => (
            <label key={d} className="text-xs" style={{ color: COLORS.textSecondary }}>
              <span className="font-data">{d.toLocaleString("ru-RU")}</span>
              <input className="neo-input w-full mt-1 font-data" inputMode="numeric" placeholder="0" value={counts[d] ?? ""} onChange={e => { setManual(""); setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, "") }); }} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <label className="text-xs flex-1" style={{ color: COLORS.textSecondary }}>{t("Или сумма вручную", "Yoki summa qo'lda")}
            <DecimalInput className="neo-input w-full mt-1 font-data" value={manual} onValueChange={setManual} placeholder={String(byDenoms || "")} data-testid="cash-handover-amount" />
          </label>
          <div className="text-right">
            <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("Принято", "Qabul")}</div>
            <div className="font-data" style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700 }}>{fmt(amount)}</div>
            {diff !== 0 && <div className="font-data" style={{ fontSize: "12px", color: diff < 0 ? "var(--color-danger-text)" : "var(--color-warning-text)" }}>{diff < 0 ? t("недостача", "kamomad") : t("излишек", "ortiqcha")} {fmt(Math.abs(diff))}</div>}
          </div>
        </div>
      </div>
      <div>
        <p className={modalSectionLabel}>{t("Подтверждение сотрудника", "Xodim tasdig'i")}</p>
        {person.hasPin ? (
          <input className="neo-input w-40 font-data" inputMode="numeric" type="password" placeholder="PIN" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="cash-handover-pin" />
        ) : (
          <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.textPrimary }}>
            <input type="checkbox" checked={paper} onChange={e => setPaper(e.target.checked)} data-testid="cash-handover-paper" />
            {t("Подписал ПКО на бумаге (PIN в телефоне не заведён)", "Qog'oz PKOga imzo qo'ydi (telefonda PIN yo'q)")}
          </label>
        )}
        <p style={{ fontSize: "12px", color: COLORS.textTertiary, marginTop: 6 }}>{t("PIN сотрудник вводит сам, в своём телефоне — кассир его не знает.", "PINni xodim o'zi, o'z telefonida kiritadi — kassir uni bilmaydi.")}</p>
      </div>
      <div>
        <p className={modalSectionLabel}>{t("Комментарий", "Izoh")}</p>
        <input className="neo-input w-full" value={note} onChange={e => setNote(e.target.value)} placeholder={t("Необязательно", "Ixtiyoriy")} />
      </div>
    </AppModal>
  );
}

function ExpenseModal({ onClose, onSubmit, t, fmt, pending, office }: { onClose: () => void; onSubmit: (v: { category: string; amount: number; note?: string }) => void; t: T; fmt: Fmt; pending: boolean; office: number }) {
  const cats = trpc.cash.categories.useQuery();
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const list = (cats.data ?? []).filter(c => c.isActive);
  const value = Number(amount || 0);
  return (
    <AppModal open onClose={onClose} title={t("Расход из кассы (РКО)", "Kassadan xarajat (RKO)")} subtitle={t(`В сейфе ${fmt(office)}`, `Seyfda ${fmt(office)}`)} maxWidth={560} dirty
      footer={<>
        <button className="neo-btn-primary flex-1 h-12 text-sm" disabled={pending || !category || !(value > 0) || value > office} data-testid="cash-expense-submit" onClick={() => onSubmit({ category, amount: value, note: note || undefined })}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUpFromLine size={16} />}{t("Провести РКО", "RKO o'tkazish")}
        </button>
        <button className="neo-btn flex-1 h-12 text-sm" onClick={onClose}>{t("Отмена", "Bekor")}</button>
      </>}>
      <div>
        <p className={modalSectionLabel}>{t("Статья", "Modda")}</p>
        <PremiumSelect value={category} onChange={setCategory} options={[{ value: "", label: t("— выберите —", "— tanlang —") }, ...list.map(c => ({ value: c.code, label: c.name + (c.monthlyLimit != null ? ` · ${t("лимит", "limit")} ${fmt(c.monthlyLimit)}` : "") }))]} />
      </div>
      <div>
        <p className={modalSectionLabel}>{t("Сумма", "Summa")}</p>
        <DecimalInput className="neo-input w-full font-data" value={amount} onValueChange={setAmount} placeholder="0" data-testid="cash-expense-amount" />
        {value > office && <p style={{ fontSize: "12px", color: "var(--color-danger-text)", marginTop: 4 }}>{t("Больше, чем в сейфе", "Seyfdagidan ko'p")}</p>}
      </div>
      <div>
        <p className={modalSectionLabel}>{t("На что", "Nimaga")}</p>
        <input className="neo-input w-full" value={note} onChange={e => setNote(e.target.value)} placeholder={t("Например: бензин, Газель 01 A 123 AA", "Masalan: benzin, Gazel 01 A 123 AA")} />
      </div>
    </AppModal>
  );
}

function AmountModal({ title, hint, initial, requireNote, onClose, onSubmit, t, pending }: {
  title: string; hint: string; initial?: number; requireNote?: boolean; onClose: () => void; onSubmit: (amount: number, note?: string) => void; t: T; pending: boolean;
}) {
  const [amount, setAmount] = useState(initial != null ? String(initial) : "");
  const [note, setNote] = useState("");
  const value = Number(amount || 0);
  return (
    <AppModal open onClose={onClose} title={title} subtitle={hint} maxWidth={520} dirty
      footer={<>
        <button className="neo-btn-primary flex-1 h-12 text-sm" disabled={pending || !(value >= 0) || amount === "" || (requireNote && note.trim().length < 3)} data-testid="cash-amount-submit" onClick={() => onSubmit(value, note || undefined)}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : null}{t("Провести", "O'tkazish")}
        </button>
        <button className="neo-btn flex-1 h-12 text-sm" onClick={onClose}>{t("Отмена", "Bekor")}</button>
      </>}>
      <div>
        <p className={modalSectionLabel}>{t("Сумма", "Summa")}</p>
        <DecimalInput className="neo-input w-full font-data" value={amount} onValueChange={setAmount} placeholder="0" data-testid="cash-amount" />
      </div>
      <div>
        <p className={modalSectionLabel}>{requireNote ? t("Причина (обязательно)", "Sabab (majburiy)") : t("Комментарий", "Izoh")}</p>
        <input className="neo-input w-full" value={note} onChange={e => setNote(e.target.value)} data-testid="cash-amount-note" />
      </div>
    </AppModal>
  );
}

function Journal({ t, fmt, isCeo, company, refresh }: { t: T; fmt: Fmt; isCeo: boolean; company: { name: string; director?: string }; refresh: () => void }) {
  const [days, setDays] = useState(7);
  const [now] = useState(() => new Date());
  const range = useMemo(() => ({ from: subDays(now, days).toISOString(), to: addDays(now, 1).toISOString() }), [days, now]);
  const q = trpc.cash.journal.useQuery(range);
  const { confirm, dialog } = useConfirm();
  const storno = trpc.cash.storno.useMutation({ onSuccess: r => { refresh(); q.refetch(); notify.success(t(`Сторно ${r.number} проведено`, `Storno ${r.number} o'tkazildi`)); }, onError: e => notify.error(e.message) });
  const ACC = (a: string) => a.startsWith("cash.employee.") ? t("на руках", "qo'lda") : a === "cash.office" ? t("сейф", "seyf") : a.startsWith("receivable.employee.") ? t("долг сотрудника", "xodim qarzi") : a.startsWith("expense.") ? t("расход", "xarajat") + " " + a.slice(8) : a === "owner" ? t("директор", "direktor") : a === "income.unexplained" ? t("до выяснения", "aniqlanguncha") : a;
  const rows = q.data ?? [];
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "6px 10px" }}>
        <div className="range-pills">{[7, 30, 90].map(d => <button key={d} className={"range-pill tap" + (days === d ? " active" : "")} onClick={() => setDays(d)}>{d} {t("дн.", "kun")}</button>)}</div>
        <button className="neo-btn neo-btn-sm" onClick={() => exportToExcel([{
          name: "Касса",
          data: rows.map(r => ({ number: r.number, date: format(new Date(r.createdAt), "dd.MM.yyyy HH:mm"), debit: r.debit, credit: r.credit, amount: r.amount, expected: r.expectedAmount ?? "", discrepancy: r.discrepancy ?? "", from: r.fromName ?? "", to: r.toName ?? "", category: r.category ?? "", note: r.note ?? "", by: r.createdByName ?? "" })),
          columns: [
            { key: "number", header: "Номер", width: 12 }, { key: "date", header: "Дата", width: 16 }, { key: "debit", header: "Дебет", width: 22 }, { key: "credit", header: "Кредит", width: 22 },
            { key: "amount", header: "Сумма", width: 14 }, { key: "expected", header: "Ожидалось", width: 14 }, { key: "discrepancy", header: "Расхождение", width: 14 },
            { key: "from", header: "От кого", width: 20 }, { key: "to", header: "Кому", width: 20 }, { key: "category", header: "Статья", width: 14 }, { key: "note", header: "Примечание", width: 30 }, { key: "by", header: "Провёл", width: 20 },
          ],
        }], `cash-journal-${days}d`)}><FileSpreadsheet size={14} /> Excel</button>
      </div>
      {q.isLoading ? <div className="p-6 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div>
        : rows.length === 0 ? <SectionNotice kind="empty" message={t("Документов за этот срок нет", "Bu davrda hujjat yo'q")} />
        : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "880px" }}>
              <thead><tr>
                <th style={thStyle}>№</th><th style={thStyle}>{t("Дата", "Sana")}</th><th style={thStyle}>{t("Что", "Nima")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th><th style={thStyle}>{t("Кто", "Kim")}</th><th style={thStyle}>{t("Примечание", "Izoh")}</th><th style={thStyle}></th>
              </tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id} className="row-hover" style={{ opacity: r.stornoOfId ? 0.7 : 1 }} data-testid={`cash-doc-${r.id}`}>
                  <td className="font-data" style={{ ...tdStyle, fontWeight: 600 }}>{r.number}{r.stornoOfId ? <span title={t("сторно", "storno")}> <Undo2 size={12} style={{ display: "inline" }} /></span> : ""}</td>
                  <td style={tdStyle}>{format(new Date(r.createdAt), "dd.MM HH:mm")}</td>
                  <td style={tdStyle}>{ACC(r.debit)} ← {ACC(r.credit)}{r.discrepancy != null && r.discrepancy !== 0 && <span style={{ color: r.discrepancy < 0 ? "var(--color-danger-text)" : "var(--color-warning-text)", marginLeft: 6 }}>{r.discrepancy < 0 ? t("недостача", "kamomad") : t("излишек", "ortiqcha")} {fmt(Math.abs(r.discrepancy))}</span>}</td>
                  <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(r.amount)}</td>
                  <td style={tdStyle}>{r.fromName ?? ""}{r.fromName && r.toName ? " → " : ""}{r.toName ?? ""}<div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("провёл", "o'tkazdi")}: {r.createdByName ?? "—"}{r.pinConfirmedAt ? " · PIN" : r.paperSigned ? ` · ${t("подпись", "imzo")}` : ""}</div></td>
                  <td style={{ ...tdStyle, maxWidth: 260, color: COLORS.textSecondary }}>{r.note ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="neo-btn neo-btn-xs tap" title={t("Печать", "Chop etish")} onClick={() => printCashOrder({ kind: r.kind, number: r.number, date: format(new Date(r.createdAt), "dd.MM.yyyy"), amount: r.amount, company: company.name, director: company.director, from: r.fromName ?? r.createdByName ?? "", to: r.toName ?? "", basis: `${ACC(r.debit)} ← ${ACC(r.credit)}${r.category ? ` · ${r.category}` : ""}`, note: r.note ?? "", currency: fmt(0).replace(/[\d\s.,]/g, "").trim() })}><Printer size={13} /></button>
                    {!r.stornoOfId && (isCeo || true) && <button className="neo-btn neo-btn-xs tap" style={{ marginLeft: 4 }} title={t("Сторно", "Storno")} data-testid={`cash-storno-${r.id}`} onClick={async () => {
                      const reason = window.prompt(t("Причина сторно (обязательно):", "Storno sababi (majburiy):"));
                      if (!reason || reason.trim().length < 3) return;
                      if (await confirm({ title: t(`Сторно ${r.number}?`, `${r.number} storno?`), message: t("Появится встречный документ; исходный останется в журнале.", "Qarshi hujjat paydo bo'ladi; asli jurnalda qoladi."), confirmText: t("Сторно", "Storno"), danger: true })) storno.mutate({ docId: r.id, reason });
                    }}><Undo2 size={13} /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function CashBookTab({ t, fmt, company }: { t: T; fmt: Fmt; company: { name: string } }) {
  const [days, setDays] = useState(30);
  const [now] = useState(() => new Date());
  const range = useMemo(() => ({ from: subDays(now, days).toISOString(), to: addDays(now, 1).toISOString() }), [days, now]);
  const q = trpc.cash.cashBook.useQuery(range);
  const b = q.data;
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "6px 10px" }}>
        <div className="range-pills">{[7, 30, 90].map(d => <button key={d} className={"range-pill tap" + (days === d ? " active" : "")} onClick={() => setDays(d)}>{d} {t("дн.", "kun")}</button>)}</div>
        <div className="flex gap-2">
          <button className="neo-btn neo-btn-sm" onClick={() => exportToExcel([{
            name: "Кассовая книга",
            data: (b?.days ?? []).map(d => ({ day: d.day, opening: d.opening, inflow: d.inflow, outflow: d.outflow, closing: d.closing })),
            columns: [{ key: "day", header: "Дата", width: 12 }, { key: "opening", header: "Остаток на начало", width: 18 }, { key: "inflow", header: "Приход", width: 14 }, { key: "outflow", header: "Расход", width: 14 }, { key: "closing", header: "Остаток на конец", width: 18 }],
          }], `cash-book-${days}d`)}><FileSpreadsheet size={14} /> Excel</button>
          <button className="neo-btn neo-btn-sm" disabled={!b} onClick={() => b && printCashBook({ company: company.name, from: format(new Date(range.from), "dd.MM.yyyy"), to: format(now, "dd.MM.yyyy"), opening: b.opening, closing: b.closing, days: b.days, currency: fmt(0).replace(/[\d\s.,]/g, "").trim() })}><Printer size={14} /> {t("Печать", "Chop etish")}</button>
        </div>
      </div>
      {!b ? <div className="p-6 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div> : b.days.length === 0 ? <SectionNotice kind="empty" message={t("Движений по сейфу за этот срок нет", "Bu davrda seyf harakati yo'q")} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
            <thead><tr><th style={thStyle}>{t("День", "Kun")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("На начало", "Boshida")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Приход", "Kirim")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Расход", "Chiqim")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("На конец", "Oxirida")}</th></tr></thead>
            <tbody>{b.days.map(d => (
              <tr key={d.day} className="row-hover"><td style={tdStyle}>{d.day}</td><td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(d.opening)}</td><td className="font-data" style={{ ...tdStyle, textAlign: "right", color: "var(--color-success-text)" }}>{fmt(d.inflow)}</td><td className="font-data" style={{ ...tdStyle, textAlign: "right", color: "var(--color-danger-text)" }}>{fmt(d.outflow)}</td><td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(d.closing)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DaysTab({ t, fmt, isCeo, refresh }: { t: T; fmt: Fmt; isCeo: boolean; refresh: () => void }) {
  const q = trpc.cash.days.useQuery({ limit: 30 });
  const reopen = trpc.cash.reopenDay.useMutation({ onSuccess: () => { refresh(); q.refetch(); notify.success(t("День открыт снова", "Kun qayta ochildi")); }, onError: e => notify.error(e.message) });
  const rows = q.data ?? [];
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      {rows.length === 0 ? <SectionNotice kind="empty" message={t("Дни ещё не закрывали", "Kunlar hali yopilmagan")} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
            <thead><tr><th style={thStyle}>{t("День", "Kun")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("По системе", "Tizim bo'yicha")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Пересчёт", "Sanash")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Расхождение", "Farq")}</th><th style={thStyle}>{t("Состояние", "Holat")}</th><th style={thStyle}></th></tr></thead>
            <tbody>{rows.map(d => (
              <tr key={d.id} className="row-hover">
                <td style={tdStyle}>{String(d.day)}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(d.systemBalance)}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(d.countedBalance)}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: d.discrepancy === 0 ? "var(--color-success-text)" : "var(--color-danger-text)" }}>{d.discrepancy === 0 ? "✓" : fmt(d.discrepancy)}</td>
                <td style={tdStyle}>{d.reopenedAt ? <span style={{ color: "var(--color-warning-text)" }}><Unlock size={12} style={{ display: "inline" }} /> {t("открыт снова", "qayta ochilgan")}</span> : <span><Lock size={12} style={{ display: "inline" }} /> {t("закрыт", "yopiq")} · {format(new Date(d.closedAt), "HH:mm")}</span>}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{isCeo && !d.reopenedAt && <button className="neo-btn neo-btn-xs tap" onClick={() => reopen.mutate({ day: String(d.day) })}>{t("Открыть снова", "Qayta ochish")}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ t, fmt, refresh }: { t: T; fmt: Fmt; refresh: () => void }) {
  const s = trpc.cash.settings.useQuery();
  const cats = trpc.cash.categories.useQuery();
  const verify = trpc.cash.verify.useQuery(undefined, { enabled: false });
  const save = trpc.cash.saveSettings.useMutation({ onSuccess: () => { s.refetch(); refresh(); notify.success(t("Сохранено", "Saqlandi")); }, onError: e => notify.error(e.message) });
  const saveCat = trpc.cash.saveCategory.useMutation({ onSuccess: () => { cats.refetch(); notify.success(t("Статья сохранена", "Modda saqlandi")); }, onError: e => notify.error(e.message) });
  const [limit, setLimit] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [bankDays, setBankDays] = useState<string | null>(null);
  const [newCat, setNewCat] = useState({ code: "", name: "", limit: "" });
  const curLimit = limit ?? String(s.data?.limit ?? "");
  const curDeadline = deadline ?? (s.data?.deadline ?? "19:00");
  const curBankDays = bankDays ?? String(s.data?.bankConfirmDays ?? 3);
  return (
    <div className="space-y-4">
      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
        <div className="flex items-center gap-2 mb-3"><Settings2 size={16} /><b style={{ fontFamily: F.display }}>{t("Правила", "Qoidalar")}</b></div>
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Лимит наличных на руках", "Qo'ldagi naqd limiti")}<DecimalInput className="neo-input w-full mt-1 font-data" value={curLimit} onValueChange={setLimit} data-testid="cash-limit" /></label>
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Сдать до (часы:минуты)", "Topshirish muddati")}<input className="neo-input w-full mt-1 font-data" value={curDeadline} onChange={e => setDeadline(e.target.value)} placeholder="19:00" /></label>
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Безнал: срок подтверждения, дн.", "Naqdsiz: tasdiqlash muddati, kun")}<input className="neo-input w-full mt-1 font-data" type="number" min={1} max={60} value={curBankDays} onChange={e => setBankDays(e.target.value)} data-testid="cash-bank-days" /></label>
          <button className="neo-btn-primary h-11" disabled={save.isPending} onClick={() => save.mutate({ limit: Number(curLimit || 0), deadline: curDeadline, bankConfirmDays: Math.min(60, Math.max(1, Number(curBankDays) || 3)) })}>{t("Сохранить", "Saqlash")}</button>
        </div>
        <p style={{ fontSize: "12px", color: COLORS.textTertiary, marginTop: 8 }}>{t("Выше лимита — предупреждение в кассе и директору в Telegram; после срока сдачи — напоминание сотруднику. Перевод или карта без подтверждения выпиской дольше срока — просрочен, вечером директору по людям.", "Limitdan yuqori — kassada va direktorga Telegramda ogohlantirish; muddatdan keyin — xodimga eslatma. Ko'chirma bilan tasdiqlanmagan o'tkazma yoki karta muddatdan keyin — muddati o'tgan, kechqurun direktorga odamlar bo'yicha.")}</p>
      </div>

      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
        <div className="flex items-center gap-2 mb-3"><BookOpen size={16} /><b style={{ fontFamily: F.display }}>{t("Статьи расхода", "Xarajat moddalari")}</b></div>
        <div className="space-y-2">
          {(cats.data ?? []).map(c => (
            <div key={c.code} className="flex flex-wrap items-center gap-2 text-sm">
              <code className="font-data" style={{ width: 110, color: COLORS.textTertiary }}>{c.code}</code>
              <span style={{ flex: 1, minWidth: 160, textDecoration: c.isActive ? "none" : "line-through" }}>{c.name}</span>
              <span className="font-data" style={{ color: COLORS.textSecondary }}>{c.monthlyLimit != null ? `${t("лимит", "limit")} ${fmt(c.monthlyLimit)}` : t("без лимита", "limitsiz")}</span>
              {c.code !== "shortage" && <button className="neo-btn neo-btn-xs" onClick={() => saveCat.mutate({ code: c.code, name: c.name, monthlyLimit: c.monthlyLimit, isActive: !c.isActive })}>{c.isActive ? t("выключить", "o'chirish") : t("включить", "yoqish")}</button>}
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-4 gap-2 mt-4 items-end">
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Код (латиницей)", "Kod (lotin)")}<input className="neo-input w-full mt-1 font-data" value={newCat.code} onChange={e => setNewCat({ ...newCat, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} placeholder="repair" /></label>
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Название", "Nomi")}<input className="neo-input w-full mt-1" value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder={t("Ремонт машин", "Mashina ta'miri")} /></label>
          <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Лимит в месяц", "Oylik limit")}<DecimalInput className="neo-input w-full mt-1 font-data" value={newCat.limit} onValueChange={v => setNewCat({ ...newCat, limit: v })} placeholder={t("пусто — без лимита", "bo'sh — limitsiz")} /></label>
          <button className="neo-btn h-11" disabled={!newCat.code || !newCat.name || saveCat.isPending} onClick={() => { saveCat.mutate({ code: newCat.code, name: newCat.name, monthlyLimit: newCat.limit ? Number(newCat.limit) : null, isActive: true }); setNewCat({ code: "", name: "", limit: "" }); }}>{t("Добавить", "Qo'shish")}</button>
        </div>
      </div>

      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
        <div className="flex items-center gap-2 mb-2"><ShieldCheck size={16} /><b style={{ fontFamily: F.display }}>{t("Целостность", "Yaxlitlik")}</b></div>
        <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>{t("Каждый документ подписан хэшем от предыдущего. Если кто-то поправил строку прямо в базе — проверка укажет, где.", "Har bir hujjat oldingisidan hesh bilan imzolangan. Kimdir bazada qatorni to'g'rilasa — tekshiruv qayerdaligini ko'rsatadi.")}</p>
        <button className="neo-btn mt-3" onClick={() => verify.refetch()} disabled={verify.isFetching} data-testid="cash-verify">{verify.isFetching ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {t("Проверить цепочку", "Zanjirni tekshirish")}</button>
        {verify.data && (verify.data.ok
          ? <p style={{ color: "var(--color-success-text)", fontSize: "13px", marginTop: 8 }}>✓ {t("Цепочка цела", "Zanjir but")}</p>
          : <p style={{ color: "var(--color-danger-text)", fontSize: "13px", marginTop: 8 }}>{t(`Разрыв на документе #${verify.data.brokenAt} — данные правили мимо программы`, `#${verify.data.brokenAt} hujjatda uzilish — ma'lumot dasturdan tashqarida o'zgartirilgan`)}</p>)}
      </div>
    </div>
  );
}

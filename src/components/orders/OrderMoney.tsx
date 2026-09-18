import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Wallet, CheckCircle2, AlertTriangle, Landmark, Banknote, CreditCard, Undo2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { SectionNotice } from "@/components/SectionNotice";
import { F, COLORS, PAYMENT } from "@/components/orders/theme-tokens";

/*
  ДЕНЬГИ ПО ЗАКАЗУ — расчёт вместо кассы (services/order-close.ts).

  Доставленный заказ ждёт расчёта, пока офис не примет по нему деньги.
  Блок отвечает на три вопроса оператора: сколько заявил курьер и держит на
  руках, сколько уже в офисе или на счёте, сколько магазин ещё должен. И
  даёт одно действие — «Закрыть расчёт»: оператор вводит, сколько наличных
  получил (по умолчанию — сколько заявлено), при нужде дописывает карту или
  перевод, а остаток либо ноль, либо явно остаётся долгом магазина.

  Меньше заявленного — недостача курьера, показывается до нажатия, чтобы
  человек видел, что именно он сейчас запишет.
*/

type Method = "cash" | "card" | "transfer";
const METHOD_ICON: Record<string, typeof Banknote> = { cash: Banknote, card: CreditCard, transfer: Landmark };
const clean = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" style={{ fontSize: strong ? "15px" : "13px" }}>
      <span style={{ color: strong ? COLORS.textPrimary : COLORS.textSecondary, fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span className="font-data" style={{ color: tone ?? COLORS.textPrimary, fontWeight: strong ? 700 : 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export function MoneyBlock({ orderId, status, courierName }: { orderId: number; status: string; courierName?: string | null }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { symbol } = useCurrency();
  const { user } = useAuth();
  const can = useCan();
  const utils = trpc.useUtils();
  const isOffice = user?.role === "ceo" || user?.role === "operator";
  const canClose = isOffice && can("payments.accept");

  const q = trpc.order.money.useQuery({ orderId }, { enabled: orderId > 0 });
  const m = q.data;

  // Пусто — поле не трогали: показывается заявленное. Обычная сдача совпадает
  // с ним, и оператору остаётся нажать одну кнопку.
  const [cashInput, setCashInput] = useState<string | null>(null);
  const [extraMethod, setExtraMethod] = useState<Method>("card");
  const [extra, setExtra] = useState("");
  const [acceptDebt, setAcceptDebt] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const cash = cashInput ?? (m && m.claimed > 0 ? String(m.claimed) : "");

  const refresh = () => { utils.order.money.invalidate({ orderId }); utils.order.getById.invalidate(); utils.order.list.invalidate(); utils.order.stats.invalidate(); };
  const close = trpc.order.close.useMutation({
    onSuccess: r => {
      refresh();
      notify.success(r.shortage > 0
        ? t(`Расчёт закрыт. Недостача ${clean(r.shortage)} ${symbol} — на курьере`, `Hisob-kitob yopildi. Kamomad ${clean(r.shortage)} ${symbol} — kuryerda`)
        : r.remainder > 0 ? t(`Расчёт закрыт. Долг магазина ${clean(r.remainder)} ${symbol}`, `Hisob-kitob yopildi. Do'kon qarzi ${clean(r.remainder)} ${symbol}`)
        : t("Расчёт закрыт — оплачено полностью", "Hisob-kitob yopildi — to'liq to'langan"));
    },
    onError: e => notify.error(e.message),
  });
  const confirmBank = trpc.order.confirmBank.useMutation({
    onSuccess: () => { refresh(); notify.success(t("Отмечено: пришло на счёт", "Belgilandi: hisobga keldi")); },
    onError: e => notify.error(e.message),
  });

  // Предпросмотр того, что запишет «Закрыть расчёт» — та же арифметика, что на сервере (closeMath).
  const preview = useMemo(() => {
    if (!m) return null;
    const got = Number(cash || 0), add = Number(extra || 0);
    const shortage = Math.max(0, m.claimed - got);
    const added = Math.max(0, got - m.claimed) + add;
    const over = m.paid + added > m.total + 0.005;
    const remainder = Math.max(0, m.total - m.paid - added);
    return { shortage, added, over, remainder, valid: Number.isFinite(got) && got >= 0 && Number.isFinite(add) && add >= 0 && !over && (remainder <= 0.005 || acceptDebt) };
  }, [m, cash, extra, acceptDebt]);

  if (q.isError) return <div className="neo-card p-5"><SectionNotice kind="error" message={t("Не удалось загрузить деньги по заказу", "Buyurtma pullarini yuklab bo'lmadi")} onRetry={() => q.refetch()} /></div>;
  if (!m) return <div className="neo-card p-5"><div className="h-24 bg-surface-light animate-pulse rounded" /></div>;

  const money = (n: number) => `${clean(n)} ${symbol}`;
  const stateTone = m.closedAt ? COLORS.successText : m.awaiting ? COLORS.warningText : COLORS.textTertiary;
  const stateText = m.closedAt
    ? `${t("Рассчитан", "Hisoblangan")} ${format(new Date(m.closedAt), "dd.MM HH:mm")}${m.closedByName ? ` · ${m.closedByName}` : ""}`
    : m.awaiting ? t("Ждёт расчёта", "Hisob-kitob kutmoqda") : status === "delivered" ? "" : t("После доставки", "Yetkazilgandan keyin");

  return (
    <div className="neo-card p-5 space-y-4" data-testid="order-money">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2" style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
          <Wallet size={16} /> {t("Деньги", "Pul")}
        </h3>
        {stateText && (
          <span className="flex items-center gap-1" style={{ fontSize: "12px", fontWeight: 600, color: stateTone }} data-testid="order-money-state">
            {m.closedAt ? <CheckCircle2 size={13} /> : m.awaiting ? <AlertTriangle size={13} /> : null}{stateText}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <Row label={t("Итого по заказу", "Buyurtma jami")} value={money(m.total)} strong />
        <Row label={t("Получено", "Olindi")} value={money(m.received)} tone={COLORS.successText} />
        {m.claimed > 0 && <Row label={`${t("На руках", "Qo'lda")}${m.holders.length ? ` · ${m.holders.map(h => h.name).join(", ")}` : ""}`} value={money(m.claimed)} tone={COLORS.warningText} />}
        {m.inTransit > 0 && <Row label={t("Безнал в пути", "Naqdsiz yo'lda")} value={money(m.inTransit)} tone={COLORS.textSecondary} />}
        <Row label={m.closedAt ? t("Долг магазина", "Do'kon qarzi") : t("Остаток", "Qoldiq")} value={money(m.remainder)} tone={m.remainder > 0 ? COLORS.dangerText : COLORS.textTertiary} />
        {m.shortage && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ fontSize: "12px", background: "var(--color-danger-subtle)", color: COLORS.dangerText }} data-testid="order-shortage">
            <AlertTriangle size={13} /> {t("Недостача", "Kamomad")} {money(m.shortage.amount)}{m.shortage.userName ? ` · ${m.shortage.userName}` : ""}{m.shortage.note ? ` · ${m.shortage.note}` : ""}
          </div>
        )}
      </div>

      {m.payments.length > 0 && (
        <div className="space-y-1.5" style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: "12px" }}>
          {m.payments.map(p => {
            const Icon = METHOD_ICON[p.method ?? "cash"] ?? Banknote;
            const reversal = p.reversalOf != null || p.status === "reversed";
            const pm = PAYMENT[p.method ?? "cash"];
            const state = reversal ? t("сторно", "storno") : p.settled ? t("получено", "olindi") : p.method === "cash" ? t("на руках", "qo'lda") : t("в пути", "yo'lda");
            const canConfirm = canClose && !reversal && !p.settled && p.method !== "cash" && p.type === "payment";
            return (
              <div key={p.id} className="flex items-center justify-between gap-3" style={{ fontSize: "12px", opacity: reversal ? 0.6 : 1 }} data-testid={`order-payment-${p.id}`}>
                <span className="flex items-center gap-2 min-w-0" style={{ color: COLORS.textSecondary }}>
                  {reversal ? <Undo2 size={13} /> : <Icon size={13} style={{ color: pm?.color }} />}
                  <span className="truncate">{format(new Date(p.createdAt), "dd.MM HH:mm")} · {pm ? (lang === "uz" ? pm.uz : pm.ru) : p.method}{p.createdByName ? ` · ${p.createdByName}` : ""}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-data" style={{ fontWeight: 600, color: reversal ? COLORS.textTertiary : COLORS.textPrimary }}>{clean(p.amount)}</span>
                  <span style={{ color: p.settled ? COLORS.successText : reversal ? COLORS.textTertiary : COLORS.warningText }}>{state}</span>
                  {canConfirm && (
                    <button type="button" className="neo-btn neo-btn-xs" disabled={confirmBank.isPending} onClick={() => confirmBank.mutate({ ids: [p.id] })} data-testid={`bank-confirm-${p.id}`}>
                      {t("Пришло", "Keldi")}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {m.awaiting && canClose && preview && (
        <div className="space-y-3" style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: "14px" }} data-testid="order-close-form">
          <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
            {t("Принять деньги", "Pulni qabul qilish")}{courierName ? ` · ${courierName}` : ""}
          </p>
          <label className="block">
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Получено наличными", "Naqd olindi")}{m.claimed > 0 ? ` (${t("заявлено", "e'lon qilingan")} ${clean(m.claimed)})` : ""}</span>
            <input className="neo-input font-data mt-1" inputMode="decimal" value={cash} onChange={e => setCashInput(normalizeDecimalInput(e.target.value))} data-testid="close-cash" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Ещё принято", "Yana qabul qilindi")}</span>
              <select className="neo-input mt-1" value={extraMethod} onChange={e => setExtraMethod(e.target.value as Method)} data-testid="close-extra-method">
                {(["card", "transfer", "cash"] as Method[]).map(k => <option key={k} value={k}>{lang === "uz" ? PAYMENT[k].uz : PAYMENT[k].ru}</option>)}
              </select>
            </label>
            <label className="block">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Сумма", "Summa")}</span>
              <input className="neo-input font-data mt-1" inputMode="decimal" value={extra} onChange={e => setExtra(normalizeDecimalInput(e.target.value))} placeholder="0" data-testid="close-extra" />
            </label>
          </div>

          {preview.shortage > 0 && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ fontSize: "12px", background: "var(--color-danger-subtle)", color: COLORS.dangerText }} data-testid="close-shortage">
              <AlertTriangle size={13} /> {t("Недостача", "Kamomad")} {money(preview.shortage)} — {t("останется на курьере и уйдёт в удержание", "kuryerda qoladi va ushlab qolinadi")}
            </div>
          )}
          {preview.over && <p style={{ fontSize: "12px", color: COLORS.dangerText }}>{t("Принято больше суммы заказа", "Buyurtma summasidan ko'p qabul qilindi")}</p>}
          {preview.remainder > 0.005 && !preview.over && (
            <div className="space-y-2 rounded-lg px-3 py-2" style={{ background: "var(--color-warning-subtle)" }}>
              <label className="flex items-center gap-2" style={{ fontSize: "13px", color: COLORS.textPrimary }}>
                <input type="checkbox" checked={acceptDebt} onChange={e => setAcceptDebt(e.target.checked)} data-testid="close-accept-debt" />
                {t("Остаток", "Qoldiq")} <b className="font-data">{money(preview.remainder)}</b> — {t("в долг магазину", "do'kon qarziga")}
              </label>
              {acceptDebt && (
                <label className="flex items-center gap-2" style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                  {t("Срок", "Muddat")} <input type="date" className="neo-input" style={{ width: "auto" }} value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="close-due" />
                </label>
              )}
            </div>
          )}
          {preview.shortage > 0 && (
            <input className="neo-input" value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder={t("Заметка к недостаче", "Kamomad izohi")} data-testid="close-note" />
          )}
          <button type="button" className="neo-btn-primary tap w-full" disabled={!preview.valid || close.isPending} data-testid="close-order"
            onClick={() => close.mutate({
              orderId, cashReceived: Number(cash || 0),
              extra: Number(extra || 0) > 0 ? [{ method: extraMethod, amount: Number(extra) }] : undefined,
              acceptDebt: acceptDebt || undefined, debtDueDate: acceptDebt && dueDate ? dueDate : undefined, note: note.trim() || undefined,
            })}>
            <CheckCircle2 size={16} /> {t("Закрыть расчёт", "Hisob-kitobni yopish")}
          </button>
        </div>
      )}
      {m.awaiting && !canClose && (
        <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{t("Расчёт закрывает офис, когда примет деньги.", "Hisob-kitobni ofis pulni qabul qilganda yopadi.")}</p>
      )}
    </div>
  );
}

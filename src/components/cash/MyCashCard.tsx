import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { HandCoins } from "lucide-react";
import { format } from "date-fns";

/**
 * Свой кошелёк — курьеру и агенту.
 *
 * Не «сколько платежей записал», а «сколько должен сдать»: это разные числа,
 * и второе видно тут. Лимит и час сдачи — из настроек кассы; долг по кассе —
 * недостачи при сдаче, которые уйдут в удержание из зарплаты.
 */
export function MyCashCard() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const q = trpc.cash.mine.useQuery(undefined, { refetchInterval: 120_000 });
  const m = q.data;
  if (!m) return null;
  const over = m.onHand > m.limit;
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }} data-testid="my-cash">
      <div className="flex items-center justify-between">
        <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", color: over ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
          {t("НАЛИЧНЫЕ НА РУКАХ", "QO'LDAGI NAQD PUL")}
        </div>
        <HandCoins size={16} style={{ color: over ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }} />
      </div>
      <div className="font-data" style={{ fontSize: "24px", fontWeight: 700, marginTop: "6px", lineHeight: 1, color: over ? "var(--color-danger-text)" : "var(--color-text-primary)" }}>{fmt(m.onHand)}</div>
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px" }}>
        {t("Принято сегодня", "Bugun qabul")}: {fmt(m.todayIn)} · {t("сдать до", "topshirish")} {m.deadline}
        {over && <span style={{ color: "var(--color-danger-text)" }}> · {t("выше лимита", "limitdan yuqori")} {fmt(m.limit)}</span>}
      </div>
      {m.nonCashTransit.count > 0 && (
        <div style={{ fontSize: "12px", color: "var(--color-warning-text)", marginTop: "4px" }}>
          {t("Переводы ждут выписки", "O'tkazmalar ko'chirma kutmoqda")}: <b>{fmt(m.nonCashTransit.total)}</b> ({m.nonCashTransit.count})
        </div>
      )}
      {m.debt > 0 && (
        <div style={{ fontSize: "12px", color: "var(--color-danger-text)", marginTop: "4px" }}>
          {t("Долг по кассе (недостачи)", "Kassa bo'yicha qarz (kamomad)")}: <b>{fmt(m.debt)}</b> — {t("удерживается из зарплаты", "oylikdan ushlab qolinadi")}
        </div>
      )}
      {m.documents.length > 0 && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {m.documents.slice(0, 3).map(d => (
            <div key={d.id}>{d.kind === "pko" ? "ПКО" : "РКО"}-{String(d.number).padStart(4, "0")} · {format(new Date(d.createdAt), "dd.MM HH:mm")} — {fmt(Number(d.amount))}
              {d.discrepancy != null && Number(d.discrepancy) !== 0 && <span style={{ color: Number(d.discrepancy) < 0 ? "var(--color-danger-text)" : "var(--color-warning-text)" }}> ({Number(d.discrepancy) < 0 ? "−" : "+"}{fmt(Math.abs(Number(d.discrepancy)))})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

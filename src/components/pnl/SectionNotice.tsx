import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { F, COLORS } from "./styles";

/**
 * Что стоит в разделе вместо данных.
 *
 * Раньше отличить одно от другого было нельзя. Разделы получали данные так:
 *
 *     {!cogsByProduct || cogsByProduct.length === 0 ? «Нет данных за период»
 *
 * а `cogsByProduct` — это `query.data`, и он равен undefined И когда за период
 * нечего показать, И когда запрос упал. Директор видел «Нет данных за период»
 * и верил: продаж не было. На странице, по которой решают, заработали или нет,
 * отказ сети превращался в нулевую прибыль — это не оформление, это неверная
 * цифра.
 *
 * Отказ теперь выглядит отказом и предлагает повторить; пустой период —
 * пустым периодом и ничего не предлагает, потому что чинить нечего.
 */
interface SectionNoticeProps {
  kind: "empty" | "error";
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function SectionNotice({ kind, message, onRetry, retryLabel }: SectionNoticeProps) {
  const isError = kind === "error";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        padding: "32px 16px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isError ? "var(--color-danger-subtle)" : COLORS.surfaceLight,
          color: isError ? "var(--color-danger-text)" : COLORS.textTertiary,
        }}
      >
        {isError ? <AlertTriangle size={18} /> : <Inbox size={18} />}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          fontFamily: F.body,
          color: isError ? "var(--color-danger-text)" : COLORS.textSecondary,
          maxWidth: "320px",
        }}
      >
        {message}
      </p>
      {isError && onRetry && (
        <button className="neo-btn neo-btn-sm tap" onClick={onRetry}>
          <RefreshCw size={13} /> {retryLabel ?? "Повторить"}
        </button>
      )}
    </div>
  );
}

import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";

/**
 * Что стоит в разделе вместо данных.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Отличить «за период нечего показать» от «запрос упал» было нельзя. Разделы
 * получали данные так:
 *
 *     {!data || data.length === 0 ? «Нет данных за период»
 *
 * а `data` — это `query.data`, и он равен undefined И когда показывать нечего,
 * И когда сервер не ответил. Человек видел «Нет данных» и верил: продаж не
 * было, склад пуст. На странице, по которой принимают решения, отказ сети
 * превращался в нулевую цифру — это не оформление, это неверный ответ.
 *
 * Отказ теперь выглядит отказом и предлагает повторить; пустой период —
 * пустым периодом и ничего не предлагает, потому что чинить нечего.
 *
 * ── Почему здесь, а не в папке раздела ──────────────────────────────────────
 *
 * Заведено это было для P&L, но та же беда нашлась на отчётах по складу — там
 * пять запросов и НИ ОДНОГО разбора отказа: итоги считались от undefined и
 * страница показывала «0 сум», то есть уверенно врала про пустой склад.
 * Второй раз писать то же самое незачем, поэтому компонент переехал в общие.
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
      // Отказ объявляется вслух: человек, читающий экран программой чтения,
      // иначе узнаёт о нём только случайно, добравшись до этого места.
      role={isError ? "alert" : undefined}
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
          background: isError ? "var(--color-danger-subtle)" : "var(--color-surface-light, #f6f4f0)",
          color: isError ? "var(--color-danger-text)" : "var(--color-text-tertiary, #6b6760)",
        }}
      >
        {isError ? <AlertTriangle size={18} /> : <Inbox size={18} />}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          fontFamily: "'DM Sans', -apple-system, sans-serif",
          color: isError ? "var(--color-danger-text)" : "var(--color-text-secondary, #5e5b54)",
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

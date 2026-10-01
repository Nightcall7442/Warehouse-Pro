import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/*
  Кирпичи блоков профиля (ProfileSettings, TotpBlock): карточка блока, его
  сообщение об успехе или ошибке и кнопка действия. Одни на все блоки —
  иначе каждый снова нарисовал бы их по-своему.
*/

export type T = (ru: string, uz: string) => string;
export type Msg = { kind: "ok" | "error"; text: string } | null;

/** Карточка блока: значок, заголовок, справа — состояние (если есть). */
export function Block({ id, icon: Icon, title, aside, children }: {
  id: string; icon: LucideIcon; title: string; aside?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={`profile-${id}`} data-testid={`profile-block-${id}`} aria-labelledby={`profile-${id}-title`}
      className="rounded-[20px] p-4 sm:p-6"
      style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-subtle)", scrollMarginTop: 96 }}>
      <header className="flex items-center gap-3 mb-4">
        <span className="flex items-center justify-center flex-shrink-0 rounded-full"
          style={{ width: 36, height: 36, background: "var(--color-surface-light)" }}>
          <Icon size={18} color="var(--color-text-secondary)" />
        </span>
        <h3 id={`profile-${id}-title`} className="flex-1 min-w-0 font-display font-semibold text-primary" style={{ fontSize: 16 }}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Сообщение блока об успехе или ошибке — под его кнопкой, а не всплывашкой. */
export function Note({ msg, testId }: { msg: Msg; testId?: string }) {
  if (!msg) return null;
  const ok = msg.kind === "ok";
  return (
    <p role={ok ? "status" : "alert"} data-testid={testId}
      className="rounded-xl px-3 py-2.5 mt-3"
      style={{ fontSize: 13, lineHeight: 1.45, background: ok ? "var(--color-success-subtle)" : "var(--color-danger-subtle)", color: ok ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
      {msg.text}
    </p>
  );
}

/** Кнопка действия блока: не ниже 44 точек — в неё попадают пальцем. */
export function ActionButton({ children, onClick, disabled, pending, primary = true, testId, full }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; pending?: boolean; primary?: boolean; testId?: string; full?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || pending} data-testid={testId}
      className={`${primary ? "neo-btn-primary" : "neo-btn"} disabled:opacity-40 disabled:cursor-not-allowed ${full ? "w-full sm:w-auto" : ""}`}
      style={{ minHeight: 44, fontSize: 14, whiteSpace: "normal", textAlign: "center" }}>
      {pending && <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      {children}
    </button>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TENANT_PLAN_LABEL } from "@contracts/entity-labels";

/* ═══════════════════════════════════════════════════════════════════════════
   Детали консоли платформы — на общей дизайн-системе продукта.

   Суперадминка жила на своих инлайновых стилях (superadmin/ui.tsx: F,
   COLORS, обводки 1px вокруг кнопок и полей). Владелец называл это «дёшево»:
   рамка в одну точку читается как чужой продукт рядом с остальным
   приложением, где поверхность вдавлена, а объекты приподняты тенью
   (index.css: .neo-card, .kpi-hero, .neo-btn, --shadow-*).

   Здесь — только то, чего в общих классах нет: панель с заголовком, плитка
   показателя, чип фильтра, метка, строки списка. Цвета — токены темы,
   поэтому светлая и тёмная собираются сами. Цели касания — 44 точки в px:
   базовый шрифт 14, и rem мельче, чем кажется.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--color-surface-light)", fg: "var(--color-text-secondary)" },
  primary: { bg: "var(--color-primary-subtle)", fg: "var(--color-primary-text)" },
  success: { bg: "var(--color-success-subtle)", fg: "var(--color-success-text)" },
  warning: { bg: "var(--color-warning-subtle)", fg: "var(--color-warning-text)" },
  danger:  { bg: "var(--color-danger-subtle)",  fg: "var(--color-danger-text)" },
  info:    { bg: "var(--color-info-subtle)",    fg: "var(--color-info-text)" },
};

/** Заголовок страницы. На телефоне имя раздела уже в шапке — здесь только подпись и действия. */
export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap" style={{ marginBottom: 20 }}>
      <div className="min-w-0">
        <h1 className="hidden md:block" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--color-text-primary)", margin: 0, lineHeight: 1.15 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "4px 0 0", lineHeight: 1.45 }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Приподнятая панель с заголовком. Граница — тень, не обводка. */
export function Panel({ title, count, action, children, testId, flush, style }: {
  title?: ReactNode; count?: number | string; action?: ReactNode; children: ReactNode;
  testId?: string; flush?: boolean; style?: CSSProperties;
}) {
  return (
    <section className="neo-card neo-card-static" data-testid={testId} style={{ padding: 0, borderRadius: 20, ...style }}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3" style={{ padding: "16px 20px 0", minHeight: 44 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.01em" }}>
            {title}
            {count !== undefined && <span style={{ color: "var(--color-text-tertiary)", fontWeight: 600 }}> · {count}</span>}
          </h2>
          {action}
        </header>
      )}
      <div style={{ padding: flush ? "8px 0 8px" : "14px 20px 20px" }}>{children}</div>
    </section>
  );
}

/**
 * Плитка показателя — тот же .kpi-hero, что у «Пользователей» директора.
 * С адресом — вся плитка ссылка: за числом стоит список, и до него один шаг.
 */
export function Tile({ label, value, suffix, hint, icon: Icon, tone = "primary", to, testId, loading }: {
  label: string; value: ReactNode; suffix?: string; hint?: ReactNode; icon: LucideIcon; tone?: Tone;
  to?: string; testId?: string; loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", lineHeight: 1.35 }}>{label}</span>
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: TONE[tone].bg }}>
          <Icon size={18} color={TONE[tone].fg} />
        </span>
      </div>
      {loading
        ? <div style={{ height: 30, width: "60%", borderRadius: 8, background: "var(--color-surface-light)" }} />
        : (
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
            {suffix && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-tertiary)" }}>{suffix}</span>}
          </div>
        )}
      {hint && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 8, lineHeight: 1.4 }}>{hint}</div>}
    </>
  );
  const style: CSSProperties = { padding: 18, borderRadius: 20, display: "block", textDecoration: "none", minHeight: 44 };
  return to
    ? <Link to={to} className="kpi-hero" style={style} data-testid={testId}>{body}</Link>
    : <div className="kpi-hero" style={style} data-testid={testId}>{body}</div>;
}

/** Метка: тариф, статус, «сверх тарифа». Мягкая заливка тоном, без рамки. */
export function Pill({ tone = "neutral", children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, lineHeight: 1.35, whiteSpace: "nowrap",
      background: TONE[tone].bg, color: TONE[tone].fg,
    }}>{children}</span>
  );
}

const PLAN_TONE: Record<string, Tone> = { trial: "info", standard: "success", basic: "neutral", pro: "success", exclusive: "primary" };
export function PlanPill({ plan }: { plan: string }) {
  const label = TENANT_PLAN_LABEL[plan as keyof typeof TENANT_PLAN_LABEL]?.ru ?? plan;
  return <Pill tone={PLAN_TONE[plan] ?? "neutral"}>{label}</Pill>;
}

/** Чип фильтра: выбранный — вдавлен и подсвечен, остальные приподняты. */
export function Chip({ active, count, onClick, children, testId }: {
  active: boolean; count?: number; onClick: () => void; children: ReactNode; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} data-testid={testId}
      className="flex-shrink-0 inline-flex items-center gap-2"
      style={{
        minHeight: 44, padding: "0 16px", borderRadius: 14, fontSize: 13.5, fontWeight: active ? 700 : 600,
        background: active ? "var(--color-primary-subtle)" : "var(--color-surface)",
        color: active ? "var(--color-primary-text)" : "var(--color-text-secondary)",
        boxShadow: active ? "var(--shadow-pressed)" : "var(--shadow-xs)", whiteSpace: "nowrap",
      }}>
      {children}
      {count !== undefined && (
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: active ? "var(--color-primary-text)" : "var(--color-text-tertiary)" }}>{count}</span>
      )}
    </button>
  );
}

/**
 * Вкладки страницы — ссылками: у каждой свой адрес, «назад» в браузере работает.
 * На телефоне — сеткой до трёх в ряд, подписи переносятся: лента с прокруткой
 * обрезала последние вкладки у края экрана, и «Опасную зону» было не видно.
 */
export function TabBar({ tabs, active, testId }: {
  tabs: Array<{ key: string; label: string; to: string; tone?: Tone }>; active: string; testId?: string;
}) {
  return (
    <nav aria-label="Разделы" data-testid={testId} className="grid md:flex gap-1 md:overflow-x-auto premium-scrollbar"
      style={{ padding: 4, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-pressed)", scrollbarWidth: "none",
        gridTemplateColumns: `repeat(${Math.min(tabs.length, 3)}, minmax(0, 1fr))` }}>
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <Link key={t.key} to={t.to} replace aria-current={on ? "page" : undefined} data-testid={`tab-${t.key}`}
            className="flex-shrink-0 inline-flex items-center justify-center text-center whitespace-normal md:whitespace-nowrap px-2 md:px-4"
            style={{
              minHeight: 44, borderRadius: 12, fontSize: 13.5, textDecoration: "none", lineHeight: 1.2,
              fontWeight: on ? 700 : 600,
              background: on ? "var(--color-surface-raised, var(--color-surface))" : "transparent",
              boxShadow: on ? "var(--shadow-sm)" : "none",
              color: on ? (t.tone ? TONE[t.tone].fg : "var(--color-text-primary)") : (t.tone ? TONE[t.tone].fg : "var(--color-text-secondary)"),
            }}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ── Списки строками (как профиль мобилки v8) ─────────────────────────────── */

export function Group({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div data-testid={testId} style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-sm)", borderRadius: 20, overflow: "hidden" }}>{children}</div>;
}
export function GroupLabel({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 8px 4px" }}>{children}</p>;
}
export function Line({ inset = 64 }: { inset?: number }) {
  return <div style={{ height: 1, background: "var(--color-border-subtle)", marginLeft: inset }} />;
}

/** Строка-переход: значок, заголовок, подпись, справа значение или шеврон. */
export function Row({ icon: Icon, tone = "neutral", title, subtitle, right, to, onClick, href, testId, danger }: {
  icon: LucideIcon; tone?: Tone; title: ReactNode; subtitle?: ReactNode; right?: ReactNode;
  to?: string; onClick?: () => void; href?: string; testId?: string; danger?: boolean;
}) {
  const t = danger ? TONE.danger : TONE[tone];
  const inner = (
    <>
      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: t.bg }}>
        <Icon size={18} color={t.fg} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block" style={{ fontSize: 14.5, fontWeight: 600, color: danger ? t.fg : "var(--color-text-primary)", overflowWrap: "anywhere" }}>{title}</span>
        {subtitle && <span className="block" style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 2, overflowWrap: "anywhere", lineHeight: 1.4 }}>{subtitle}</span>}
      </span>
      {right}
      {(to || onClick || href) && <ChevronRight size={18} color="var(--color-text-tertiary)" className="flex-shrink-0" />}
    </>
  );
  const style: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "10px 16px", width: "100%", textAlign: "left", textDecoration: "none", color: "inherit" };
  if (to) return <Link to={to} style={style} className="console-row" data-testid={testId}>{inner}</Link>;
  if (href) return <a href={href} style={style} className="console-row" data-testid={testId}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} style={style} className="console-row" data-testid={testId}>{inner}</button>;
  return <div style={style} data-testid={testId}>{inner}</div>;
}

/** Число справа в строке — счётчик со своим тоном. */
export function Count({ n, tone = "neutral", testId }: { n: ReactNode; tone?: Tone; testId?: string }) {
  return (
    <span data-testid={testId} className="flex-shrink-0" style={{
      minWidth: 30, padding: "4px 10px", borderRadius: 999, textAlign: "center",
      fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
      background: TONE[tone].bg, color: TONE[tone].fg,
    }}>{n}</span>
  );
}

export function Empty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ padding: "36px 16px", gap: 8 }}>
      <span className="flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: 16, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)" }}>
        <Icon size={22} color="var(--color-text-tertiary)" />
      </span>
      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: "4px 0 0" }}>{title}</p>
      {hint && <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: 0, maxWidth: 360, lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2" style={{ padding: 16, fontSize: 13, color: "var(--color-text-tertiary)" }}>
      <Loader2 size={15} className="animate-spin" /> {label}
    </div>
  );
}

/** Подпись поля формы — как у форм приложения (AppModal: modalFieldLabel). */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>{children}</label>;
}

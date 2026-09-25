import { useId, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { getGreeting } from "@/lib/utils";
import { dateLocale } from "@/lib/date-locale";
import { CARD } from "./tones";

/*
  Детали телефонных экранов — те же, из которых собрана мобилка v8
  (Warehouse-Pro-Mobile: src/components/ui.tsx, Charts.tsx, Layout.tsx).

  Владелец, 24–25.09.2026: «PWA точно как мобайл», «все сделай абсолютно».
  Экран на телефоне собирается из этих кусков, а не рисует карточки заново:
  иначе через месяц у каждого экрана будет своя тень и свой радиус, и PWA
  опять разъедется с приложением.

  Цвета — только токены (--color-*): светлая «Финтех», тёмная «Полевой» и
  цвет арендатора приходят из index.css сами.
*/


/** Карточка-список: строки внутри делятся линией, углы 20. */
export function ListCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...CARD, borderRadius: 20, overflow: "hidden", ...style }}>{children}</div>;
}

/** Строка в карточке-списке. Первая — без линии сверху. */
export function ListRow({ first, onClick, children, dim, testId }: {
  first?: boolean; onClick?: () => void; children: ReactNode; dim?: boolean; testId?: string;
}) {
  const style: CSSProperties = {
    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", width: "100%", textAlign: "left",
    borderTop: first ? "none" : "1px solid var(--color-border-subtle)", opacity: dim ? 0.6 : 1,
  };
  return onClick
    ? <button type="button" onClick={onClick} style={style} className="active:opacity-70" data-testid={testId}>{children}</button>
    : <div style={style} data-testid={testId}>{children}</div>;
}

/** Заголовок раздела: значок, слово, счётчик-подушка и «→». */
export function SectionHead({ icon: Icon, title, badge, onMore, moreLabel, aside }: {
  icon: LucideIcon; title: string; badge?: string; onMore?: () => void; moreLabel?: string; aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} color="var(--color-primary-text)" className="flex-shrink-0" />
        <h2 className="truncate" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{title}</h2>
        {badge && (
          <span className="rounded-full px-2 py-0.5 flex-shrink-0" style={{ fontSize: 11, fontWeight: 700, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}>
            {badge}
          </span>
        )}
      </div>
      {aside}
      {onMore && (
        <button type="button" onClick={onMore} className="btn-ghost w-11 h-11 flex-shrink-0" aria-label={moreLabel ?? title}>
          <ArrowRight size={16} color="var(--color-text-tertiary)" />
        </button>
      )}
    </div>
  );
}

/** Плитка быстрого перехода: белая карточка, значок на мягкой подложке своего цвета. */
export function Tile({ icon: Icon, label, tint, onClick, big }: {
  icon: LucideIcon; label: string; tint: string; onClick: () => void; big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 min-w-0 flex flex-col items-center justify-center active:scale-[0.98] transition-transform"
      style={{ ...CARD, borderRadius: big ? 20 : 16, padding: big ? "20px 8px" : "16px 8px", gap: big ? 10 : 8 }}
    >
      <span
        className="flex items-center justify-center"
        style={{ width: big ? 40 : 36, height: big ? 40 : 36, borderRadius: big ? 12 : 10, background: `color-mix(in srgb, ${tint} 12%, transparent)` }}
      >
        <Icon size={big ? 20 : 16} color={tint} />
      </span>
      <span className="max-w-full truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</span>
    </button>
  );
}

/** Главное действие экрана — жёлтая плитка (--color-cta), как «Новый заказ» мобилки. */
export function CtaTile({ icon: Icon, label, onClick, testId }: { icon: LucideIcon; label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex-1 min-w-0 flex flex-col items-center justify-center active:scale-[0.98] transition-transform"
      style={{ background: "var(--color-cta)", color: "var(--color-on-cta)", borderRadius: 20, padding: "20px 8px", gap: 10 }}
    >
      <span className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--color-on-cta) 8%, transparent)" }}>
        <Icon size={22} color="var(--color-on-cta)" />
      </span>
      <span className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

/** Пусто: значок в круге, фраза и, если есть, подсказка. */
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--color-canvas)" }}>
        <Icon size={20} color="var(--color-text-tertiary)" />
      </span>
      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", margin: 0 }}>{title}</p>
      {hint && <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>{hint}</p>}
    </div>
  );
}

/** Полоски-заглушки, пока грузится список. */
export function RowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />
      ))}
    </div>
  );
}

/**
 * Шапка главной: приветствие, заголовок (на телефоне его уже пишет шапка
 * приложения — второй раз не повторяем), дата и кружок профиля.
 */
export function HomeGreeting({ title }: { title: string }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const firstName = user?.name?.split(" ")[0] ?? "";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-primary-text)", margin: 0 }}>
          {getGreeting(t)}{firstName ? `, ${firstName}` : ""}
        </p>
        <h1 className="hidden md:block font-display" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "4px 0 0" }}>
          {title}
        </h1>
        <p className="capitalize" style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "4px 0 0" }}>
          {format(new Date(), "EEEE, d MMMM", { locale: dateLocale(lang) })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/settings")}
        aria-label={t("Профиль", "Profil")}
        className="flex-shrink-0 flex items-center justify-center rounded-full"
        style={{ width: 44, height: 44, background: "var(--color-primary-subtle)", border: "2px solid var(--color-primary)", color: "var(--color-primary-text)", fontSize: 18, fontWeight: 700 }}
      >
        {(firstName || "?").charAt(0).toUpperCase()}
      </button>
    </div>
  );
}

/** Переключатель-«таблетки» (7д / 30д / Месяц), как в мобилке. */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ key: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full p-0.5 flex-shrink-0" style={{ background: "var(--color-surface-light)" }} role="tablist">
      {options.map(o => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className="rounded-full"
            style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, background: on ? "var(--color-primary)" : "transparent", color: on ? "var(--color-on-primary)" : "var(--color-text-tertiary)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Линия с заливкой под ней — Sparkline мобилки. Растягивается на ширину родителя. */
export function Sparkline({ data, color = "var(--color-primary-text)", height = 56 }: { data: number[]; color?: string; height?: number }) {
  const gid = useId().replace(/:/g, "");
  const W = 320, pad = 4;
  const series = data.length ? data : [0];
  const max = Math.max(...series, 1), min = Math.min(...series, 0);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1 || 1)) * (W - pad * 2);
    const y = pad + (height - pad * 2) - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${W - pad},${height - pad} L${pad},${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Кольцо долей с числом в середине — DonutChart мобилки. */
export function Donut({ segments, size = 120, stroke = 18, center, sub }: {
  segments: Array<{ value: number; color: string }>; size?: number; stroke?: number; center?: string; sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-light)" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const before = segments.slice(0, i).reduce((a, x) => a + x.value, 0);
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke - 2}
              strokeDasharray={c} strokeDashoffset={c * (1 - s.value / total)}
              transform={`rotate(${(before / total) * 360 - 90} ${size / 2} ${size / 2})`} />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {center && <span className="font-data" style={{ fontSize: size * 0.18, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.1 }}>{center}</span>}
        {sub && <span style={{ fontSize: Math.max(10, size * 0.08), fontWeight: 500, color: "var(--color-text-tertiary)" }}>{sub}</span>}
      </div>
    </div>
  );
}

/** Столбики на карточке-показателе — MiniBarChart мобилки: чем правее, тем плотнее. */
export function MiniBars({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height, maxWidth: 100 }} aria-hidden>
      {data.map((v, i) => (
        <span key={i} className="flex-1 rounded-[3px]" style={{ height: Math.max(4, (v / max) * height), background: color, opacity: 0.3 + (i / data.length) * 0.7 }} />
      ))}
    </div>
  );
}

/** Полоса прогресса на жёлобе — NeumorphicProgressBar мобилки, без объёма. */
export function ProgressBar({ value, color = "var(--color-primary)", height = 10 }: { value: number; color?: string; height?: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div className="rounded-full overflow-hidden" style={{ height, background: "var(--color-surface-light)" }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: "width .4s ease" }} />
    </div>
  );
}

/** Точка состояния с подписью — как под названием заказа в мобилке. */
export function StatusDot({ dot, text, label }: { dot: string; text: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="flex-shrink-0 rounded-full" style={{ width: 6, height: 6, background: dot }} />
      <span className="truncate" style={{ fontSize: 12, color: text }}>{label}</span>
    </span>
  );
}

/** Бирка состояния на подложке — Badge мобилки. */
export function StatusPill({ dot, text, label }: { dot: string; text: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 flex-shrink-0" style={{ background: `color-mix(in srgb, ${dot} 12%, transparent)` }}>
      <span className="rounded-full" style={{ width: 6, height: 6, background: dot }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: text }}>{label}</span>
    </span>
  );
}

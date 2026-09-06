import { memo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { colorMix } from "@/lib/color-mix";
import { F, COLORS, SHADOW } from "./report-constants";

/**
 * Отказ одного блока — полосой внутри блока, а не пустотой.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На странице девять запросов, а разбор отказа стоял ровно у одного —
 * сводки. У всех остальных упавший запрос отдаёт undefined, и блок печатал
 * своё «Нет данных за период». То есть «сервер ответил отказом» и «за месяц
 * не продали ничего» выглядели на экране одинаково. Директор в такой день
 * делает выводы о работе, а не о сети.
 *
 * QueryErrorFallback занимает 30vh и рассчитан на экран целиком — им закрыт
 * случай, когда падает главный запрос вкладки. Внутри плитки в сетке из трёх
 * нужен размер самой плитки, поэтому здесь свой вид, а не тот же.
 */
export const SectionError = memo(function SectionError({ onRetry, t }: {
  onRetry: () => void;
  t: (ru: string, uz: string) => string;
}) {
  return (
    <div role="alert" style={{
      display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      padding: "14px 16px", borderRadius: "12px",
      background: colorMix(COLORS.dangerText, 8),
      border: `1px solid ${colorMix(COLORS.dangerText, 22)}`,
    }}>
      <AlertTriangle size={16} style={{ color: COLORS.dangerText, flexShrink: 0 }} aria-hidden />
      <span style={{ flex: 1, minWidth: "140px", fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary }}>
        {t("Данные не загрузились", "Ma'lumot yuklanmadi")}
      </span>
      <button type="button" onClick={onRetry} className="neo-btn neo-btn-sm tap" style={{ padding: "0 14px" }}>
        <RefreshCw size={13} aria-hidden /> {t("Повторить", "Qayta urinish")}
      </button>
    </div>
  );
});

export interface TopListItem {
  key: string | number;
  name: string;
  /** Числом — для длины полосы; полоса считается от наибольшего в списке. */
  value: number;
  /** Готовая подпись: деньги форматируются вызывающим, он знает валюту. */
  valueLabel: string;
  /** Вторая строка под названием: код товара, число заказов и подобное. */
  hint?: string;
}

/**
 * Короткий список «первая пятёрка» с полосой доли.
 *
 * ── Зачем понадобился ───────────────────────────────────────────────────────
 *
 * На вкладке «Обзор» стояли график и план дня, и всё. Сетка при этом была на
 * три колонки, а занято было две: треть экрана пустовала всегда, а ниже шла
 * пустота во всю ширину. Смотреть на цифры приходилось, переключаясь по
 * вкладкам, хотя данные для короткой сводки страница и так уже загружает.
 *
 * ── Почему полоса, а не круговая диаграмма ──────────────────────────────────
 *
 * Здесь важно «кто первый и насколько оторвался», а такое сравнение по длине
 * читается точнее, чем по углу сектора. К тому же круговая теряет смысл на
 * пяти позициях из сотни: сумма долей ничего не значит, если показано не всё.
 *
 * Полоса декоративная: точное значение написано цифрами рядом. Поэтому она
 * помечена aria-hidden и не мешает читалке.
 */
export const TopList = memo(function TopList({ items, t, emptyRu, emptyUz }: {
  items: TopListItem[];
  t: (ru: string, uz: string) => string;
  emptyRu: string;
  emptyUz: string;
}) {
  if (!items.length) return (
    <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "24px 0" }}>
      {t(emptyRu, emptyUz)}
    </p>
  );

  // От наибольшего, а не от суммы: показана верхушка, а не всё целое.
  // Единица в знаменателе — на случай, когда все значения нулевые.
  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {items.map((item, i) => (
        <div key={item.key}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px" }}>
            <span style={{
              fontFamily: F.body, fontSize: "11px", fontWeight: 700,
              color: COLORS.textTertiary, minWidth: "14px",
            }}>
              {i + 1}
            </span>
            <span style={{
              flex: 1, minWidth: 0, fontSize: "13px", fontWeight: 500,
              color: COLORS.textPrimary,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={item.name}>
              {item.name}
            </span>
            <span style={{
              fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary,
              // Цифры в колонку: без этого разряды пляшут от строки к строке.
              fontVariantNumeric: "tabular-nums",
            }}>
              {item.valueLabel}
            </span>
          </div>
          <div aria-hidden style={{
            height: "4px", borderRadius: "2px", background: COLORS.surfaceLight,
            marginLeft: "22px", overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.max(2, (item.value / max) * 100)}%`,
              height: "100%", borderRadius: "2px",
              background: "var(--color-primary)",
            }} />
          </div>
          {item.hint && (
            <p style={{
              fontSize: "11px", color: COLORS.textTertiary,
              margin: "4px 0 0 22px",
            }}>
              {item.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  );
});

export const ChartPanel = memo(function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, position: "relative", overflow: "hidden",
    }}>
      <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 20px" }}>
        {title}
      </h2>
      {children}
    </div>
  );
});

export const GlassPanel = memo(function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, ...style,
    }}>
      {children}
    </div>
  );
});

export const PeriodPicker = memo(function PeriodPicker({ days, onChange, t }: {
  days: number;
  onChange: (d: number) => void;
  t: (ru: string, uz: string) => string;
}) {
  // Подписи были только по-русски — единственное место на странице, которое
  // не переключалось на узбекский.
  const items = [7, 30, 90];
  return (
    <div role="group" aria-label={t("Период", "Davr")}
      style={{ display: "inline-flex", background: COLORS.surfaceLight, borderRadius: "12px", padding: "3px", gap: "2px" }}>
      {items.map(d => (
        <button key={d} type="button" onClick={() => onChange(d)} aria-pressed={days === d}
          // 12px в кнопке с отступом 8px давало 31 точку по высоте. Период
          // переключают чаще всего на странице — цель касания здесь нужна.
          className="tap" style={{
            padding: "0 16px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
            borderRadius: "10px", border: "none", cursor: "pointer", transition: "all 0.2s",
            background: days === d ? COLORS.surface : "transparent",
            color: days === d ? COLORS.textPrimary : COLORS.textSecondary,
            boxShadow: days === d ? SHADOW : "none",
          }}>
          {d} {t("дней", "kun")}
        </button>
      ))}
    </div>
  );
});

export const PlanCompletion = memo(function PlanCompletion({ data, t }: { data: unknown[]; t: (ru: string, uz: string) => string }) {
  if (!data?.length) return (
    <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "24px 0" }}>
      {t("Нет данных за сегодня", "Bugun uchun ma'lumot yo'q")}
    </p>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {data.map((a) => {
        const agent = a as Record<string, unknown>;
        const pct = Math.min(100, Math.round(Number(agent.pct ?? 0)));
        const color = pct >= 80 ? "var(--color-success-text)" : pct >= 50 ? "var(--color-warning-text)" : "var(--color-danger-text)";
        return (
          <div key={String(agent.agentId)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", color: COLORS.textPrimary, fontFamily: F.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>
                {String(agent.agentName ?? `Агент #${agent.agentId}`)}
              </span>
              <span style={{ fontSize: "12px", fontWeight: 600, color, fontFamily: F.body }}>
                {String(agent.visited)}/{String(agent.total)} · {pct}%
              </span>
            </div>
            <div style={{ height: "6px", background: COLORS.surfaceLight, borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: "3px", width: `${pct}%`, background: color, transition: "width 0.5s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
});

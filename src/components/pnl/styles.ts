import React from "react";

export const F = {
  display: "'DM Sans', -apple-system, sans-serif",
  body: "'DM Sans', -apple-system, sans-serif",
};

export const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)",
  surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)",
  textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)",
  border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/**
 * Столбец с деньгами.
 *
 * У пропорциональных цифр «1» уже остальных, поэтому в столбце из пяти сумм
 * разряды стояли лесенкой и глазу было не за что зацепиться при сравнении
 * строк. tabular-nums выдаёт всем цифрам одинаковую ширину — сравнение идёт
 * по длине числа, как в бумажном отчёте. Крупным отдельным числам (герой,
 * значение карточки) это, наоборот, вредит: «121» там выглядит рыхлым, —
 * поэтому стиль только для колонок.
 */
export const numeric: React.CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

export const thStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: COLORS.textTertiary,
  padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`,
  textAlign: "left",
};

export const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px",
  fontFamily: F.body,
  color: COLORS.textPrimary,
};

/**
 * Оформление значка маржи.
 *
 * Подложка была вписана литералами — rgba(74,222,128,.1), rgba(251,191,36,.1),
 * rgba(232,80,80,.1). Это цвета СВЕТЛОЙ темы: в тёмной подложка оставалась той
 * же салатовой, а надпись бралась из переменной и становилась неоново-зелёной.
 * У приложения ровно для таких подложек есть --color-*-subtle, они объявлены в
 * обеих темах.
 *
 * Надпись тоже сменилась: стояла заливочная --color-success, у которой контраст
 * как у текста ниже нормы (об этом сказано в index.css рядом с объявлением), —
 * взят её тёмный собрат --color-success-text.
 */
export function marginTone(pct: number): { background: string; color: string } {
  if (pct >= 20) return { background: "var(--color-success-subtle)", color: "var(--color-success-text)" };
  if (pct >= 10) return { background: "var(--color-warning-subtle)", color: "var(--color-warning-text)" };
  return { background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" };
}

/**
 * Цвет прибыли или убытка. Смысловой, а не фирменный.
 *
 * Прибыль и убыток — это состояние, и красить их фирменным цветом арендатора
 * нельзя: цвет задаёт клиент, он бывает жёлтым или салатовым, и тогда убыток
 * выглядит как удача. Ноль — не достижение и не провал, поэтому обычные
 * чернила.
 */
export function profitInk(value: number): string {
  if (value > 0) return "var(--color-success-text)";
  if (value < 0) return "var(--color-danger-text)";
  return COLORS.textPrimary;
}

/**
 * Порядок способов оплаты в столбике — и он же порядок цветов.
 *
 * Порядок закреплён, потому что цвет принадлежит способу оплаты, а не его
 * месту в списке. Сортируй сегменты по величине — и «Долг», вчера янтарный,
 * завтра станет сиреневым: человек, запомнивший цвет, будет читать чужую
 * строку.
 */
export const PAYMENT_ORDER = ["cash", "transfer", "debt", "card"] as const;

/**
 * Цвет способа оплаты — опознавательный знак, а не оценка.
 *
 * Стояло: наличные — --color-success, долг — --color-warning, перечисление —
 * фирменный цвет арендатора, карта — литерал #9b59b6. Три беды сразу.
 * Зелёный и жёлтый в этом приложении означают состояние (прибыль, убыток,
 * риск) — отданные способу оплаты, они врут: столбик «Наличные» читался как
 * «всё хорошо». Фирменный цвет меняется от настроек клиента, то есть
 * «Перечисление» у каждого арендатора своего цвета. А литерал не меняется
 * вовсе и в тёмной теме остаётся глухо-фиолетовым.
 *
 * Взяты четыре опознавательных оттенка палитры. Порядок именно такой: в
 * столбике сегменты стоят вплотную друг к другу, и соседние пары проверены
 * на различимость, в том числе при дальтонизме. Оранжевый и янтарный рядом
 * сливаются — между ними стоит сиреневый.
 */
export const PAYMENT_COLORS: Record<string, string> = {
  cash: "var(--kpi-orange)",
  transfer: "var(--kpi-purple)",
  debt: "var(--kpi-amber)",
  card: "var(--kpi-pink)",
};

export const PAYMENT_LABELS: Record<string, { ru: string; uz: string }> = {
  cash: { ru: "Наличные", uz: "Naqd" },
  transfer: { ru: "Перечисление", uz: "O'tkazma" },
  debt: { ru: "Долг", uz: "Qarz" },
  card: { ru: "Карта", uz: "Plastik karta" },
};

/**
 * Подпись способа оплаты для экрана и для выгрузки.
 *
 * Запасным значением стоял сам код: `PAYMENT_LABELS[m]?.ru ?? m`. Сервер
 * отдаёт «unknown» там, где способ не проставлен, и в файл владельцу уходила
 * строка «unknown» — внутреннее слово базы в отчёте для директора. Разбор
 * теперь один на экран, Excel и PDF: разойтись им негде.
 */
export function paymentLabel(method: string, lang: string = "ru"): string {
  const known = PAYMENT_LABELS[method];
  if (known) return lang === "uz" ? known.uz : known.ru;
  return lang === "uz" ? "Boshqa" : "Другое";
}

/**
 * Подпись месяца из «2026-08».
 *
 * На оси стояло «2026-08» — машинный вид, который человек читает по слогам, и
 * при двенадцати месяцах подписи налезали друг на друга. Год повторять в
 * каждой подписи незачем: он один и тот же на всём графике, кроме перехода
 * через декабрь, — поэтому две цифры.
 */
export function monthLabel(month: string, lang: string = "ru"): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const name = new Date(y, m - 1, 1)
    .toLocaleDateString(lang === "uz" ? "uz" : "ru", { month: "short" })
    // Русская краткая форма приходит с точкой («апр.»), а вместе с годом Intl
    // добавляет ещё и «г.»: подпись «апр. 26 г.» вдвое длиннее нужного и на
    // ноутбуке при двенадцати месяцах перестаёт помещаться. Собираем сами.
    .replace(/\.$/, "");
  return `${name} ${String(y).slice(-2)}`;
}

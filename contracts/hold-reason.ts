/**
 * Почему заказ ждёт офиса — словами, на двух языках.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Причина удержания (orders.hold_reason) была одна — скидка выше порога — и
 * писалась по-русски прямо в роутере. Узбекский экран показывал её как есть,
 * а телефон после отправки говорил «скидка выше порога» про любое удержание.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * В базе причина остаётся русской строкой: её же читают Telegram, журнал и
 * телефон, который уже выпущен и перевести её не умеет. Строки собираются
 * здесь, по одному шаблону на причину, и здесь же разбираются обратно для
 * узбекского экрана. Шаблон и разбор стоят рядом нарочно: поменять одно и
 * забыть другое — значит показать узбекскому оператору русскую фразу.
 *
 * Причин может быть две сразу (скидка и просрочка) — они идут через «; ».
 */

type Lang = string;

/** Столбец orders.hold_reason — varchar(255). */
export const HOLD_REASON_MAX = 255;

/** «1 200 000» — тысячи через обычный пробел, без копеек: деньги целыми. */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export interface CurrencyLook {
  symbol: string;
  position: "before" | "after";
}

/** Сумма со знаком валюты организации — как в напоминаниях о долге. */
export function moneyWithSymbol(amount: number, c: CurrencyLook): string {
  const v = groupDigits(amount);
  return c.position === "before" ? `${c.symbol} ${v}` : `${v} ${c.symbol}`;
}

/** Причина удержания за просроченный долг: «Просроченный долг: 1 200 000 сум, самый старый — 45 дн.» */
export function overdueHoldReason(o: { amount: number; oldestDays: number }, c: CurrencyLook): string {
  return `Просроченный долг: ${moneyWithSymbol(o.amount, c)}, самый старый — ${Math.max(0, Math.round(o.oldestDays))} дн.`;
}

/** Причины через «; »; пустые выкидываются; ни одной — null. Длина — по столбцу. */
export function joinHoldReasons(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((p): p is string => Boolean(p && p.trim())).join("; ");
  return text ? text.slice(0, HOLD_REASON_MAX) : null;
}

const OVERDUE = /^Просроченный долг: (.+), самый старый — (\d+) дн\.$/;
const DISCOUNT = /^Скидка (\S+)% выше порога (\S+)% для полевых сотрудников$/;

function onePart(part: string, lang: Lang): string {
  if (lang !== "uz") return part;
  const o = OVERDUE.exec(part);
  if (o) return `Muddati o'tgan qarz: ${o[1]}, eng eskisi — ${o[2]} kun`;
  const d = DISCOUNT.exec(part);
  if (d) return `Chegirma ${d[1]}% dala xodimlari uchun ${d[2]}% chegaradan yuqori`;
  // Незнакомая причина (старая строка, будущий шаблон) — как есть, но не пусто.
  return part;
}

/** Причина удержания на языке экрана. Русская — как лежит; узбекская — по шаблонам выше. */
export function holdReasonText(reason: string | null | undefined, lang: Lang): string {
  if (!reason) return "";
  return reason.split("; ").map(p => onePart(p, lang)).join("; ");
}

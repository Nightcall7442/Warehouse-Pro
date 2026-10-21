import { format } from "@/lib/business-time";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";

/** Ключ выбора партий для остатка без партии (в запросе — batchId: null). */
export const UNBATCHED = "none";

/** «ГГГГ-ММ-ДД» или дата — днём «дд.мм.гггг»: срок партии так же, как в «Сроках». */
export function dayText(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10).split("-").reverse().join(".");
  return format(new Date(v as string | Date), "dd.MM.yyyy");
}

/**
 * Подпись плитки «Стоимость остатков»: едущее между складами и недоехавшее
 * за 30 дней называются рядом с остатком — ни то, ни другое в него не входит.
 * Недостача раньше считалась сервером (valuation.transitShortageCost), но
 * на экран не попадала: деньги, потерянные в дороге, не видел никто, кроме
 * уведомления в момент приёмки.
 */
export function valuationNote(
  t: (ru: string, uz: string) => string,
  fmt: (amount: number | string, compact?: boolean) => string,
  v: { cost: number; inTransitCost: number; shortageCost: number },
): string {
  const parts = [t("по себестоимости", "tannarx bo'yicha"), fmt(v.cost.toFixed(0))];
  if (v.inTransitCost > 0) parts.push(`${t("в пути", "yo'lda")} ${fmt(v.inTransitCost, true)}`);
  if (v.shortageCost > 0) parts.push(`${t("не доехало за 30 дн.", "30 kunda yetib kelmadi")} ${fmt(v.shortageCost, true)}`);
  return parts.join(" · ");
}

type QtyLine = { productId?: number; productName: string; unit: string | null; quantity: number; receivedQuantity?: number | null };

/** Недоехавшее по строке; у непринятой строки — ноль. */
export const shortOf = (l: QtyLine): number => (l.receivedQuantity == null ? 0 : Math.max(0, l.quantity - l.receivedQuantity));

/**
 * Количество документа — по товарам, каждый в своей единице: «Вода — 7 шт,
 * Мука — 2.5 кг». Сумма по документу складывала штуки с килограммами, и
 * «Недостача 3» не значила ничего. of — что считать: отправленное (по
 * умолчанию) или недоехавшее (shortOf). Строки документа — части партий,
 * поэтому один товар собирается из нескольких строк.
 */
export function qtyByProduct(lines: QtyLine[], lang: string, of: (l: QtyLine) => number = l => l.quantity): string {
  const byKey = new Map<string, { name: string; unit: string | null; qty: number }>();
  for (const l of lines) {
    const q = of(l);
    if (!(q > 0)) continue;
    const key = `${l.productId ?? l.productName}|${l.unit ?? ""}`;
    const cur = byKey.get(key) ?? { name: l.productName, unit: l.unit, qty: 0 };
    cur.qty = Math.round((cur.qty + q) * 1000) / 1000;
    byKey.set(key, cur);
  }
  return [...byKey.values()].map(v => `${v.name} — ${formatQty(v.qty)} ${unitShort(v.unit, lang)}`).join(", ");
}

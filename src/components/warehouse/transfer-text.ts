import { format } from "@/lib/business-time";

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

import { format } from "@/lib/business-time";

/** Ключ выбора партий для остатка без партии (в запросе — batchId: null). */
export const UNBATCHED = "none";

/** «ГГГГ-ММ-ДД» или дата — днём «дд.мм.гггг»: срок партии так же, как в «Сроках». */
export function dayText(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10).split("-").reverse().join(".");
  return format(new Date(v as string | Date), "dd.MM.yyyy");
}

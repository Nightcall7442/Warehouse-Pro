/*
  Индекс риска — слова к баллам. Сервер отдаёт код фактора и числа, экран
  и выгрузка в Excel говорят словами. Экран — на двух языках; Excel и всё
  печатное — по-русски (memory: paper-stays-russian).
*/
export type RiskCode = "shortage" | "cashLate" | "nonCash" | "dispute" | "unconfirmed" | "reopened" | "returns" | "discounts" | "visits";
export type RiskLevel = "calm" | "watch" | "act";
export interface RiskFactor { code: RiskCode; points: number; count?: number; money?: number; share?: number; hours?: number }

export const RISK_LABEL: Record<RiskCode, { ru: string; uz: string }> = {
  dispute:     { ru: "Магазин оспорил доставку",       uz: "Do'kon yetkazishni rad etdi" },
  shortage:    { ru: "Недостача при расчёте заказа",  uz: "Buyurtma hisob-kitobida kamomad" },
  cashLate:    { ru: "Наличные на руках дольше суток", uz: "Naqd pul qo'lda bir sutkadan ko'p" },
  nonCash:     { ru: "Безнал без выписки",             uz: "Ko'chirmasiz naqdsiz to'lov" },
  reopened:    { ru: "Заказ переигран после доставки", uz: "Yetkazishdan keyin buyurtma o'zgartirildi" },
  unconfirmed: { ru: "Доставки без слова магазина",    uz: "Do'kon so'zisiz yetkazishlar" },
  returns:     { ru: "Много возвратов",                uz: "Qaytarishlar ko'p" },
  discounts:   { ru: "Скидка в каждом втором заказе",  uz: "Har ikkinchi buyurtmada chegirma" },
  visits:      { ru: "Подозрительные визиты",          uz: "Shubhali tashriflar" },
};

export const LEVEL_LABEL: Record<RiskLevel, { ru: string; uz: string }> = {
  calm:  { ru: "Спокойно",      uz: "Xotirjam" },
  watch: { ru: "Присмотреться", uz: "Kuzatish kerak" },
  act:   { ru: "Разобраться",   uz: "Aniqlash kerak" },
};

/** Числа фактора — одной строкой: «2 · 150 000 сум · 30 ч». */
export function riskDetail(f: RiskFactor, lang: "ru" | "uz", fmt: (n: number) => string): string {
  const parts: string[] = [];
  if (f.count != null) parts.push(String(f.count));
  if (f.money != null && f.money > 0) parts.push(fmt(f.money));
  if (f.share != null) parts.push(`${Math.round(f.share * 100)}%`);
  if (f.hours != null) parts.push(`${f.hours} ${lang === "uz" ? "soat" : "ч"}`);
  return parts.join(" · ");
}

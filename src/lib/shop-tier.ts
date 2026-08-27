/**
 * Цвета магазинов на карте.
 *
 * Значения — обычные шестнадцатеричные, а не токены темы, и это не небрежность:
 * метки Яндекс.Карт рисуются SVG внутри data-URI, а туда переменная CSS не
 * доходит — `var(--color-success-text)` внутри `data:image/svg+xml` браузер
 * подставить не может, и метка выходит чёрной. На метке агента в этом же файле
 * ошибка ровно такая и была.
 */

export type ShopTier = "green" | "yellow" | "red" | "new";

export const TIER_COLOR: Record<ShopTier, string> = {
  // Красный чуть приглушён: рядом с ним на карте стоят метки агентов, и
  // сигнальный алый перетягивал бы внимание с людей на точки.
  red:    "#c0392b",
  yellow: "#d4a017",
  green:  "#2e8b57",
  new:    "#9aa0a6",
};

export const TIER_LABEL: Record<ShopTier, { ru: string; uz: string }> = {
  red:    { ru: "Долго не платят",   uz: "Uzoq to'lamaydi" },
  yellow: { ru: "Есть долг",          uz: "Qarz bor" },
  green:  { ru: "Рассчитываются",     uz: "Hisob-kitob qiladi" },
  new:    { ru: "Заказов не было",    uz: "Buyurtma bo'lmagan" },
};

/** Порядок для легенды и сортировок: сначала то, на что смотреть в первую очередь. */
export const TIER_ORDER: ShopTier[] = ["red", "yellow", "green", "new"];

/** Сумма без копеек и с разделителями — в подсказке на карте места мало. */
export function money(v: number): string {
  return `${Math.round(v).toLocaleString("ru")} сум`;
}

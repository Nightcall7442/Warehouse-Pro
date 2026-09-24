/**
 * Прайс-лист как сетка: весь каталог, у каждого товара — цена карточки,
 * цена по правилу списка и своя цена в списке.
 *
 * «Готовые прайсы товаров»: сетка открывается уже заполненной ценами
 * карточек, правится только то, что для этих магазинов другое. Логика —
 * здесь, без браузера: какая цена действует, сколько это к карточке и к
 * себестоимости, что уходит на сервер.
 */

export type PriceRow = {
  productId: number;
  name: string;
  code: string;
  category: string;
  costPrice: number;
  cardPrice: number;
  /** Своя цена в списке (от одной штуки); "" — своей нет. */
  price: string;
  /** Ступеней «от N штук» у товара в этом списке. */
  tiers: number;
};

/**
 * Цена по правилу «к карточке, %», как её считает сервер
 * (api/services/price-resolver.ts: applyMarkup) — до копеек.
 */
export function ruled(cardPrice: number, markupPct: number | null): number | null {
  if (markupPct == null) return null;
  return Math.round(cardPrice * (1 + markupPct / 100) * 100) / 100;
}

/** Что получит магазин: своя цена → правило списка → карточка. */
export function effective(r: PriceRow, markupPct: number | null): { price: number; source: "own" | "rule" | "card" } {
  if (r.price.trim() !== "" && Number.isFinite(Number(r.price))) return { price: Number(r.price), source: "own" };
  const rule = ruled(r.cardPrice, markupPct);
  return rule != null ? { price: rule, source: "rule" } : { price: r.cardPrice, source: "card" };
}

/** Сколько процентов к карточке; null — считать не от чего. */
export function toCardPct(price: number, cardPrice: number): number | null {
  if (!(cardPrice > 0)) return null;
  return Math.round((price / cardPrice - 1) * 1000) / 10;
}

/** Маржа к себестоимости, %; null — себестоимость не заведена. */
export function marginPct(price: number, costPrice: number): number | null {
  if (!(costPrice > 0) || !(price > 0)) return null;
  return Math.round((price / costPrice - 1) * 1000) / 10;
}

/** «Найденным: карточка ±X%» — своя цена от карточки, до копеек. */
export function applyPct(rows: PriceRow[], ids: Set<number>, pct: number): PriceRow[] {
  return rows.map(r => ids.has(r.productId) && r.cardPrice > 0
    ? { ...r, price: String(Math.round(r.cardPrice * (1 + pct / 100) * 100) / 100) }
    : r);
}

/** Своя цена ниже себестоимости — продажа в минус. */
export function belowCost(r: PriceRow, markupPct: number | null): boolean {
  return r.costPrice > 0 && effective(r, markupPct).price < r.costPrice;
}

/**
 * Что сохранить: только изменённое. Пусто там, где своя цена была, —
 * null (убрать); число, которое совпадает с сохранённым, — не уходит.
 */
export function changes(base: Map<number, string>, rows: PriceRow[]): Array<{ productId: number; price: number | null }> {
  const out: Array<{ productId: number; price: number | null }> = [];
  for (const r of rows) {
    const was = base.get(r.productId) ?? "";
    const now = r.price.trim();
    if (now === "") { if (was !== "") out.push({ productId: r.productId, price: null }); continue; }
    const n = Number(now);
    if (!Number.isFinite(n) || n < 0) continue;
    if (was !== "" && Number(was).toFixed(2) === n.toFixed(2)) continue;
    out.push({ productId: r.productId, price: Math.round(n * 100) / 100 });
  }
  return out;
}

/** «1 200,50» → «1200.50»; пусто → ""; нечисло → null. */
export function normalizePrice(raw: string): string | null {
  const s = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (s === "") return "";
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/**
 * Выбор цены по количеству — одно правило для сервера и экрана.
 *
 * Сервер считает заказ по ступеням прайс-листа («от 10 — 8500»), а каталог
 * отдавал экрану одну цену — при количестве 1. Экран, «Итог» и офлайн-итог
 * показывали цену от одной штуки, а заказ создавался по ступени: агент
 * называл магазину одну сумму, накладная печаталась на другую. Теперь
 * каталог отдаёт ступени товара (tiers), и экран выбирает цену тем же
 * pickTier, что и сервер (api/services/price-resolver.ts).
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Среди строк прайс-листов области берётся строка с порогом ≤ количеству;
 * побеждает список с большим priority, внутри списка — больший порог.
 *
 * Порог ≤ 1 — это цена «от одной штуки»: она действует на любое количество,
 * в том числе дробное. Раньше строка с порогом «1.00» не подходила к 0,5 кг,
 * и за полкило брали цену карточки вместо цены прайс-листа.
 */

/** Строка прайс-листа для выбора цены: порог, цена и приоритет её списка. */
export interface PriceTier {
  minQuantity: string | number;
  price: string;
  priority: number;
}

/** Порог ≤ 1 — цена от одной штуки (см. сетку прайс-листа и upsertItem). */
export function isBaseTier(minQuantity: string | number): boolean {
  return Number(minQuantity) <= 1;
}

export function pickTier<T extends PriceTier>(rows: readonly T[], quantity: number): T | undefined {
  return rows
    .filter(r => isBaseTier(r.minQuantity) || Number(r.minQuantity) <= quantity)
    .sort((a, b) => b.priority - a.priority || Number(b.minQuantity) - Number(a.minQuantity))[0];
}

/**
 * Цена строки заказа до отправки.
 *
 * unitPrice — цена из каталога (при количестве 1: прайс-лист, правило списка
 * или карточка). tiers — строки прайс-листов товара; каталог отдаёт их только
 * тем товарам, у которых есть ступень «от N». Строки не подошло — значит,
 * у товара нет цены от одной штуки в списке, и действует та же цена, что при 1.
 */
export function priceAt(unitPrice: string, tiers: readonly PriceTier[] | null | undefined, quantity: number): string {
  if (!tiers || tiers.length === 0) return unitPrice;
  return pickTier(tiers, quantity)?.price ?? unitPrice;
}

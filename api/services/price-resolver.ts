/**
 * Цена товара для магазина: прайс-лист магазина, иначе карточка товара.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прайс-листы заводились в настройках, привязывались к магазинам, а цена
 * заказа бралась из products.unitPrice на всех путях. Единственный читатель
 * priceList.getPrice — обёртка в мобилке без вызовов. Экран настроек при этом
 * утверждал: «агент видит в заказе цену, назначенную его магазину». Прямой
 * источник спора о долге: агент называет одну сумму, накладная печатается
 * по другой.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Среди активных списков, привязанных к магазину, берётся строка товара с
 * minQuantity ≤ количеству; побеждает список с большим priority, внутри
 * списка — больший порог (ярус по объёму). Нет строки — цена карточки.
 * Одним запросом на весь заказ: заказ из десяти строк — десять обращений
 * были бы заметны на 3G у агента.
 */
import { and, eq, inArray } from "drizzle-orm";
import { priceLists, priceListItems, priceListAssignments } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ResolvedPrice { price: string; priceListId: number | null }

interface TierRow { productId: number; price: string; minQuantity: string; priority: number; priceListId: number }

/** Чистое правило выбора яруса — то же, что в SQL-сортировке, для стендов. */
export function pickTier(rows: TierRow[], quantity: number): TierRow | undefined {
  return rows
    .filter(r => Number(r.minQuantity) <= quantity)
    .sort((a, b) => b.priority - a.priority || Number(b.minQuantity) - Number(a.minQuantity))[0];
}

export async function resolvePrices(
  db: Db | Tx, tenantId: number, shopId: number,
  items: Array<{ productId: number; quantity: number | string }>,
  fallback: Map<number, string>,
): Promise<Map<number, ResolvedPrice>> {
  const out = new Map<number, ResolvedPrice>();
  for (const it of items) out.set(it.productId, { price: fallback.get(it.productId) ?? "0", priceListId: null });
  if (items.length === 0) return out;

  const rows = await db.select({
    productId: priceListItems.productId,
    price: priceListItems.price,
    minQuantity: priceListItems.minQuantity,
    priority: priceLists.priority,
    priceListId: priceListItems.priceListId,
  })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
    .innerJoin(priceListAssignments, eq(priceListAssignments.priceListId, priceLists.id))
    .where(and(
      eq(priceLists.tenantId, tenantId),
      eq(priceLists.isActive, true),
      eq(priceListAssignments.shopId, shopId),
      inArray(priceListItems.productId, items.map(i => i.productId)),
    ));

  const byProduct = new Map<number, TierRow[]>();
  for (const r of rows) {
    const list = byProduct.get(Number(r.productId)) ?? [];
    list.push({ ...r, productId: Number(r.productId), priority: Number(r.priority), priceListId: Number(r.priceListId) });
    byProduct.set(Number(r.productId), list);
  }
  for (const it of items) {
    const tier = pickTier(byProduct.get(it.productId) ?? [], Number(it.quantity));
    if (tier) out.set(it.productId, { price: tier.price, priceListId: tier.priceListId });
  }
  return out;
}

/**
 * Цена товара для заказа: прайс-лист заказа, иначе прайс-лист магазина,
 * иначе карточка товара.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прайс-листы заводились в настройках и привязывались к магазинам, а цену
 * агент и оператор видели из карточки товара: сервер молча переценивал заказ
 * при создании. Прямой источник спора о долге: агент называет одну сумму,
 * накладная печатается по другой. И при новом заказе прайс-лист нигде не
 * спрашивался (владелец, 18.09.2026).
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Область — либо один список (прайс-лист, выбранный в заказе), либо все
 * активные списки, привязанные к магазину. Среди них для товара берётся
 * строка с minQuantity ≤ количеству; побеждает список с большим priority,
 * внутри списка — больший порог (ярус по объёму). Строки нет — если у
 * списка задана наценка/скидка к карточке (markupPct), цена = карточка ×
 * (1 + pct/100), округлённая до копеек; иначе карточка.
 *
 * Так список «Опт −7 %» — одно число, а не пятьсот строк; строки остаются
 * исключениями поверх правила. Одним запросом на весь заказ.
 *
 * Та же функция кормит каталог (product.list с shopId/priceListId): агент и
 * оператор видят ровно те цены, по которым сервер посчитает заказ.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { priceLists, priceListItems, priceListAssignments } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ResolvedPrice { price: string; priceListId: number | null }
/** Область цен: магазин (его списки) или явно выбранный список заказа. */
export type PriceScope = { shopId: number; priceListId?: number | null };

interface TierRow { productId: number; price: string; minQuantity: string; priority: number; priceListId: number }
interface ListRow { id: number; priority: number; markupPct: string | null }

/** Чистое правило выбора яруса — то же, что в SQL-сортировке, для стендов. */
export function pickTier(rows: TierRow[], quantity: number): TierRow | undefined {
  return rows
    .filter(r => Number(r.minQuantity) <= quantity)
    .sort((a, b) => b.priority - a.priority || Number(b.minQuantity) - Number(a.minQuantity))[0];
}

/** Цена по правилу списка: карточка × (1 + pct/100), до копеек. */
export function applyMarkup(basePrice: string | number, markupPct: string | number): string {
  const v = Number(basePrice) * (1 + Number(markupPct) / 100);
  return (Math.round(v * 100) / 100).toFixed(2);
}

/** Активные списки области: один выбранный или привязанные к магазину. */
export async function listsInScope(db: Db | Tx, tenantId: number, scope: PriceScope): Promise<ListRow[]> {
  const base = db.select({ id: priceLists.id, priority: priceLists.priority, markupPct: priceLists.markupPct }).from(priceLists);
  const rows = scope.priceListId
    ? await base.where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isActive, true), eq(priceLists.id, scope.priceListId)))
    : await base.innerJoin(priceListAssignments, eq(priceListAssignments.priceListId, priceLists.id))
        .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isActive, true), eq(priceListAssignments.shopId, scope.shopId)));
  return rows.map(r => ({ id: Number(r.id), priority: Number(r.priority), markupPct: r.markupPct }));
}

/** Список магазина по умолчанию — самый приоритетный из привязанных; null — карточка. */
export async function shopPriceList(db: Db | Tx, tenantId: number, shopId: number): Promise<{ id: number; name: string } | null> {
  const [row] = await db.select({ id: priceLists.id, name: priceLists.name }).from(priceLists)
    .innerJoin(priceListAssignments, eq(priceListAssignments.priceListId, priceLists.id))
    .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isActive, true), eq(priceListAssignments.shopId, shopId)))
    .orderBy(desc(priceLists.priority))
    .limit(1);
  return row ? { id: Number(row.id), name: row.name } : null;
}

export async function resolvePrices(
  db: Db | Tx, tenantId: number, scope: number | PriceScope,
  items: Array<{ productId: number; quantity: number | string }>,
  fallback: Map<number, string>,
): Promise<Map<number, ResolvedPrice>> {
  const sc: PriceScope = typeof scope === "number" ? { shopId: scope } : scope;
  const out = new Map<number, ResolvedPrice>();
  for (const it of items) out.set(it.productId, { price: fallback.get(it.productId) ?? "0", priceListId: null });
  if (items.length === 0) return out;

  const lists = await listsInScope(db, tenantId, sc);
  if (lists.length === 0) return out;

  const rows = await db.select({
    productId: priceListItems.productId,
    price: priceListItems.price,
    minQuantity: priceListItems.minQuantity,
    priority: priceLists.priority,
    priceListId: priceListItems.priceListId,
  })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
    .where(and(inArray(priceListItems.priceListId, lists.map(l => l.id)), inArray(priceListItems.productId, items.map(i => i.productId))));

  const byProduct = new Map<number, TierRow[]>();
  for (const r of rows) {
    const list = byProduct.get(Number(r.productId)) ?? [];
    list.push({ ...r, productId: Number(r.productId), priority: Number(r.priority), priceListId: Number(r.priceListId) });
    byProduct.set(Number(r.productId), list);
  }
  // Правило «к карточке» — у самого приоритетного списка, где оно задано.
  const ruled = lists.filter(l => l.markupPct != null).sort((a, b) => b.priority - a.priority)[0];
  for (const it of items) {
    const tier = pickTier(byProduct.get(it.productId) ?? [], Number(it.quantity));
    if (tier) { out.set(it.productId, { price: tier.price, priceListId: tier.priceListId }); continue; }
    if (ruled && fallback.has(it.productId)) out.set(it.productId, { price: applyMarkup(fallback.get(it.productId)!, ruled.markupPct!), priceListId: ruled.id });
  }
  return out;
}

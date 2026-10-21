/**
 * Уценка партии, которая не успеет продаться до срока.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Экран «Сроки» говорит: «не успеет, останется 180 шт., уценить на 20 %».
 * Без способа сделать это одним нажатием подсказка оставалась советом:
 * директор звонил агентам, агенты договаривались с магазинами каждый по-своему,
 * а заказ всё равно уходил по прежней цене.
 *
 * ── Почему не прайс-лист ────────────────────────────────────────────────────
 *
 * У магазина ровно один прайс-лист (setForShop/setShops снимают прежний).
 * Список «Распродажа», назначенный всем, снял бы магазины с их собственных цен;
 * выбранный в заказе — отменил бы их цены на все остальные строки заказа.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Цена уценки — ПОТОЛОК: заказ по товару не дороже неё, а если по прайс-листу
 * магазина и так дешевле — остаётся дешевле (capAtMarkdown). Ступени «от N»
 * тоже не выше потолка — экран (pickTier) и сервер считают одинаково.
 *
 * Уценка действует, пока жива её партия и не наступил её срок: партия ушла
 * (FEFO отгружает её первой, опустевшая строка удаляется дверью остатка) —
 * цена сама возвращается к обычной. Отдельного «снять по окончании» нет и
 * не нужно.
 *
 * ── Склад ───────────────────────────────────────────────────────────────────
 *
 * Партия лежит на одном складе, и уценка — про неё. Пока продавали только с
 * основного (ADR 0008), это было одно и то же. С точками продаж (ADR 0012)
 * заказ филиала с уценкой партии основного склада продал бы свежий товар
 * дешевле — поэтому продажа передаёт склад заказа, и уценка действует только
 * на нём. Без склада (экран «Сроки») — все склады, как было.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { markdowns, stockBatches } from "@db/schema";
import { dayKey } from "../lib/period";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ActiveMarkdown {
  productId: number;
  price: string;
  /** Последний день, «ГГГГ-ММ-ДД». */
  endsOn: string;
  batchId: number;
}

/**
 * Действующие уценки организации — по товарам. productIds — только эти
 * товары (пустой список — пусто, без похода в базу); null — все.
 * warehouseId — только уценки партий этого склада (продажа: склад заказа);
 * null — любого склада (экран «Сроки»).
 */
export async function activeMarkdowns(
  db: Db | Tx, tenantId: number, productIds: number[] | null, today: string = dayKey(new Date()), warehouseId: number | null = null,
): Promise<Map<number, ActiveMarkdown>> {
  const out = new Map<number, ActiveMarkdown>();
  if (productIds && productIds.length === 0) return out;
  const rows = await db.select({
    productId: markdowns.productId,
    price:     markdowns.price,
    endsOn:    sql<string>`DATE_FORMAT(${markdowns.endsOn}, '%Y-%m-%d')`,
    batchId:   markdowns.batchId,
  })
    .from(markdowns)
    // Партия жива — уценка жива. Опустевшую партию дверь остатка удаляет.
    .innerJoin(stockBatches, and(
      eq(stockBatches.id, markdowns.batchId),
      eq(stockBatches.tenantId, tenantId),
      sql`${stockBatches.quantity} > 0`,
      ...(warehouseId != null ? [eq(stockBatches.warehouseId, warehouseId)] : []),
    ))
    .where(and(
      eq(markdowns.tenantId, tenantId),
      sql`${markdowns.endsOn} >= ${today}`,
      ...(productIds ? [inArray(markdowns.productId, productIds)] : []),
    ));
  for (const r of rows) {
    out.set(Number(r.productId), { productId: Number(r.productId), price: Number(r.price).toFixed(2), endsOn: String(r.endsOn), batchId: Number(r.batchId) });
  }
  return out;
}

/** Цена не выше уценки: дешевле — остаётся, дороже — становится ценой уценки. */
export function capAtMarkdown(price: string, markdown: ActiveMarkdown | undefined): { price: string; capped: boolean } {
  if (!markdown) return { price, capped: false };
  return Number(markdown.price) < Number(price)
    ? { price: markdown.price, capped: true }
    : { price, capped: false };
}

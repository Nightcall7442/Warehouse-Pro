import { and, desc, eq, gt, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { orders, orderItems, products, shops, warehouseStock } from "@db/schema";
import { REVENUE_ORDER_STATUSES } from "../lib/order-status";
import { tgEscape } from "../telegram-router";
import { T, type Lang } from "./texts";

/* ═══════════════════════════════════════════════════════════════════════════
   Ответы бота — только чтение.

   Бот ничего не меняет. Это решение, а не упущение: телефон теряют и угоняют,
   а разговор с ботом не требует ни пароля, ни второго входа. Пока бот только
   рассказывает, потерянный телефон стоит утечки сводки; умей он подтверждать
   заказы — стоил бы поддельных отгрузок.

   Все запросы ограничены организацией спрашивающего. Идентификатор берётся из
   привязки чата к пользователю, а не из сообщения.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько строк помещается в одно сообщение, не превращая его в простыню. */
const LIMIT = 8;

const money = (n: unknown) => Number(n ?? 0).toLocaleString("ru");
const qty = (n: unknown) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
};

/** Заголовок жирным, потом строки. Пустой список говорит об этом словами. */
function block(title: string, lines: string[], empty: string): string {
  if (lines.length === 0) return `<b>${title}</b>\n\n${empty}`;
  return `<b>${title}</b>\n\n${lines.join("\n")}`;
}

/** Что заканчивается: остаток ниже точки заказа. */
export async function answerStock(tenantId: number, lang: Lang): Promise<string> {
  const rows = await getDb()
    .select({
      name: products.name,
      unit: products.unit,
      available: sql<number>`sum(${warehouseStock.available})`,
      point: sql<number>`max(${warehouseStock.reorderPoint})`,
    })
    .from(warehouseStock)
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(warehouseStock.tenantId, tenantId), eq(products.status, "active")))
    .groupBy(products.id, products.name, products.unit)
    // Сравнение после группировки: остаток считается по всем складам сразу,
    // и товар, которого нет на одном, но много на другом, не тревога.
    .having(sql`sum(${warehouseStock.available}) <= max(${warehouseStock.reorderPoint})`)
    .orderBy(sql`sum(${warehouseStock.available}) asc`)
    .limit(LIMIT);

  const lines = rows.map(r => `• ${tgEscape(r.name)} — ${qty(r.available)} ${tgEscape(r.unit)}`);
  return block(T.hStock[lang], lines, T.wStockOk[lang]);
}

/** Последние заказы. */
export async function answerOrders(tenantId: number, lang: Lang): Promise<string> {
  const rows = await getDb()
    .select({
      number: orders.orderNumber,
      total: orders.total,
      status: orders.status,
      shop: shops.name,
      at: orders.createdAt,
    })
    .from(orders)
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
    .orderBy(desc(orders.id))
    .limit(LIMIT);

  const lines = rows.map(r =>
    `• №${tgEscape(r.number)} · ${tgEscape(r.shop ?? "—")} — ${money(r.total)}`);
  return block(T.hOrders[lang], lines, T.nothing[lang]);
}

/** Итоги за сегодня. */
export async function answerSummary(tenantId: number, lang: Lang): Promise<string> {
  const db = getDb();
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [[today], [debt], [low]] = await Promise.all([
    db.select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${orders.total}), 0)`,
    }).from(orders).where(and(
      eq(orders.tenantId, tenantId),
      gte(orders.createdAt, since),
      inArray(orders.status, REVENUE_ORDER_STATUSES),
      isNull(orders.deletedAt),
    )),
    db.select({ total: sql<number>`coalesce(sum(${shops.debt}), 0)` })
      .from(shops).where(eq(shops.tenantId, tenantId)),
    db.select({ count: sql<number>`count(*)` })
      .from(warehouseStock)
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        sql`${warehouseStock.available} <= ${warehouseStock.reorderPoint}`,
      )),
  ]);

  return [
    `<b>${T.hSummary[lang]}</b>`,
    "",
    `• ${T.wOrders[lang]}: ${Number(today?.count ?? 0)}`,
    `• ${T.wRevenue[lang]}: ${money(today?.total)}`,
    `• ${T.hStock[lang].toLowerCase()}: ${Number(low?.count ?? 0)}`,
    `• ${T.wDebt[lang]}: ${money(debt?.total)}`,
  ].join("\n");
}

/** Что лучше продаётся за 30 дней. */
export async function answerTop(tenantId: number, lang: Lang): Promise<string> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await getDb()
    .select({
      name: products.name,
      sold: sql<number>`sum(${orderItems.quantity})`,
      revenue: sql<number>`sum(${orderItems.subtotal})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, and(eq(products.id, orderItems.productId), eq(products.tenantId, tenantId)))
    .where(and(
      eq(orders.tenantId, tenantId),
      gte(orders.createdAt, since),
      inArray(orders.status, REVENUE_ORDER_STATUSES),
      isNull(orders.deletedAt),
    ))
    .groupBy(products.id, products.name)
    .orderBy(desc(sql`sum(${orderItems.subtotal})`))
    .limit(LIMIT);

  const lines = rows.map((r, i) => `${i + 1}. ${tgEscape(r.name)} — ${qty(r.sold)} · ${money(r.revenue)}`);
  return block(T.hTop[lang], lines, T.nothing[lang]);
}

/** Кто должен и сколько. */
export async function answerDebts(tenantId: number, lang: Lang): Promise<string> {
  const rows = await getDb()
    .select({ name: shops.name, debt: shops.debt })
    .from(shops)
    .where(and(eq(shops.tenantId, tenantId), gt(shops.debt, "0")))
    .orderBy(desc(shops.debt))
    .limit(LIMIT);

  const lines = rows.map(r => `• ${tgEscape(r.name)} — ${money(r.debt)}`);
  return block(T.hDebts[lang], lines, T.wNoDebts[lang]);
}

/**
 * Поиск товара по названию.
 *
 * Сюда попадает всё, что не опознано как команда, — то есть любая случайная
 * фраза. Поэтому ответ на «ничего не нашлось» ведёт к подсказке, а не к
 * молчанию: иначе бот выглядит сломанным.
 */
export async function answerSearch(tenantId: number, lang: Lang, query: string): Promise<string> {
  const needle = query.trim();
  // Одна-две буквы совпадут почти со всем каталогом — это не поиск, а мусор.
  if (needle.length < 3) return T.notUnderstood[lang];

  const rows = await getDb()
    .select({
      name: products.name,
      unit: products.unit,
      price: products.unitPrice,
      available: sql<number>`coalesce(sum(${warehouseStock.available}), 0)`,
    })
    .from(products)
    .leftJoin(warehouseStock, eq(warehouseStock.productId, products.id))
    .where(and(
      eq(products.tenantId, tenantId),
      eq(products.status, "active"),
      like(products.name, `%${needle}%`),
    ))
    .groupBy(products.id, products.name, products.unit, products.unitPrice)
    .limit(5);

  if (rows.length === 0) return `${T.nothing[lang]}\n\n${T.notUnderstood[lang]}`;

  const lines = rows.map(r =>
    `• ${tgEscape(r.name)} — ${T.wLeft[lang]} ${qty(r.available)} ${tgEscape(r.unit)}, ${T.wPrice[lang]} ${money(r.price)}`);
  return block(T.hProduct[lang], lines, T.nothing[lang]);
}

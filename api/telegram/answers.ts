import { and, desc, eq, gt, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { orders, orderItems, products, shops, warehouseStock, users, dailyPlans } from "@db/schema";
import { REVENUE_ORDER_STATUSES, deliveredQty } from "../lib/order-status";
import { tgEscape } from "../lib/telegram";
import { T, type Lang } from "./texts";
import { lowStockRows, lowStockCondition, onDefaultWarehouse } from "../services/reorder";

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

/**
 * Что заканчивается: остаток ниже точки заказа.
 *
 * Правило одно на всех — services/reorder.ts: основной склад, порог на товаре.
 * Здесь стояла своя формула по колонке warehouse_stock.reorder_point, которую
 * никто не писал: бот отвечал «всё в порядке», пока товар не кончался совсем.
 * И суммировал остаток по всем складам — а продают только с основного (ADR 0008).
 */
export async function answerStock(tenantId: number, lang: Lang): Promise<string> {
  const rows = await lowStockRows(getDb(), tenantId, LIMIT);

  const lines = rows.map(r => `• ${tgEscape(r.productName)} — ${qty(Number(r.available))} ${tgEscape(r.unit)}`);
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
      .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        eq(products.status, "active"),
        onDefaultWarehouse(tenantId),
        lowStockCondition(),
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
      /*
        Проданное и выручка — по ДОСТАВЛЕННОМУ количеству.

        Строки заказов, проведённых курьером через частичный возврат до правки
        того пути, хранят количество и сумму как заказанные. «Топ товаров» в
        телеграме показывал бы лучше всего продающимся то, что чаще всего
        возвращают.
      */
      sold: sql<number>`COALESCE(sum(${deliveredQty()}), 0)`,
      revenue: sql<number>`COALESCE(sum(${deliveredQty()} * ${orderItems.unitPrice}), 0)`,
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
    .orderBy(desc(sql`sum(${deliveredQty()} * ${orderItems.unitPrice})`))
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

/**
 * Кто из сотрудников подключён к боту.
 *
 * ── Зачем это директору ─────────────────────────────────────────────────────
 *
 * Подключается человек только сам, и директор не может ни сделать это за него,
 * ни узнать, сделал ли. Отсюда обычная жалоба «уведомления приходят не всем» —
 * а приходят они ровно тем, кто подключился.
 *
 * Список отвечает на это прямо: имя, должность, подключён или нет. Ни одного
 * chat_id: он нужен серверу, а человеку не говорит ничего, чего он не видит в
 * самом Telegram.
 */
export async function answerStaff(tenantId: number, lang: Lang): Promise<string> {
  const rows = await getDb()
    .select({
      name: users.name,
      role: users.role,
      connected: sql<number>`CASE WHEN ${users.telegramChatId} IS NULL THEN 0 ELSE 1 END`,
    })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active")))
    .orderBy(users.name)
    .limit(40);

  if (rows.length === 0) return block(T.hStaff[lang], [], T.wNoStaff[lang]);

  const on = rows.filter(r => Number(r.connected) === 1);
  const off = rows.filter(r => Number(r.connected) !== 1);

  const lines = [
    `Подключены: ${on.length} из ${rows.length}`,
    "",
    ...on.map(r => `✓ ${tgEscape(r.name)} — ${tgEscape(r.role)}`),
    ...(off.length ? ["", "Не подключены:"] : []),
    ...off.map(r => `• ${tgEscape(r.name)} — ${tgEscape(r.role)}`),
    ...(off.length ? ["", T.staffHint[lang]] : []),
  ];
  return block(T.hStaff[lang], lines, T.wNoStaff[lang]);
}

/**
 * Визиты на сегодня и сколько из них выполнено.
 *
 * Вопрос «объехали ли то, что планировали» задают в середине дня и из
 * телефона — за компьютером на него отвечает экран планов, а по дороге
 * отвечать было нечем.
 */
export async function answerPlans(tenantId: number, lang: Lang): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await getDb()
    .select({
      agent: users.name,
      total: sql<number>`COUNT(*)`,
      done: sql<number>`SUM(CASE WHEN ${dailyPlans.status} = 'completed' THEN 1 ELSE 0 END)`,
    })
    .from(dailyPlans)
    .innerJoin(users, eq(users.id, dailyPlans.agentId))
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      sql`DATE(${dailyPlans.planDate}) = ${today}`,
    ))
    .groupBy(users.id, users.name)
    .orderBy(users.name)
    .limit(LIMIT);

  const lines = rows.map(r => {
    const total = Number(r.total ?? 0);
    const done = Number(r.done ?? 0);
    return `• ${tgEscape(r.agent)} — ${done} из ${total}`;
  });
  return block(T.hPlans[lang], lines, T.wNoPlans[lang]);
}

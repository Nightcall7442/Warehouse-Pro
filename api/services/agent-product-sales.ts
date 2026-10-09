/* ═══════════════════════════════════════════════════════════════════════════
   «Агент × Товар»: что и на сколько продал каждый агент — в тех же деньгах,
   что его KPI, зарплата и P&L.

   ── Что было ────────────────────────────────────────────────────────────────

   Отчёт складывал строки заказов: доставленное × цена строки. Количества
   выходили верные, а деньги — нет, и разошлись они с каждым денежным отчётом
   по агенту (аудит 09.10.2026, вопрос клиента «отчёты могут ошибаться?»):

     · скидка заказа живёт только в шапке (orders.discount/total), строки
       пишутся по полной цене. Заказ на 1 300 000 со скидкой 10% давал здесь
       1 300 000, а таблица «Агенты» над этим блоком, KPI, зарплата, план и
       P&L — 1 170 000;
     · возвраты не вычитались вовсе. Проведённый возврат меняет склад и долг
       магазина, но не строку заказа, — и товар, вернувшийся на склад,
       оставался здесь «проданным», хотя KPI и комиссия его уже вычли.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Основа та же, что у «Прибыли» (services/margin-report.ts), только в разрезе
   «агент × товар»:

     · сумма строки — её доля в orders.total (скидка заказа делится между
       строками по их сумме). Сумма строк заказа после деления равна
       orders.total — числу, из которого считают KPI и P&L;
     · возвраты — по общему правилу (services/revenue-returns.ts): проведённые,
       по дате проведения, только по заказам, которые сами в выручке; агент —
       из заказа; сумма документа делится по его строкам (returnLines) так же,
       как в «Прибыли».

   Итог по всем агентам сходится с выручкой P&L за тот же период, итог агента —
   со строкой таблицы «Агенты» и с выручкой его KPI. Одна оговорка: KPI и
   зарплата не опускают выручку агента ниже нуля (это правило оплаты), а
   отчёт — опускает, иначе он перестал бы сходиться с P&L. У агента, чьи
   возвраты прошлых продаж больше продаж периода, здесь минус, в KPI — ноль;
   экран говорит об этом прямо. Всё это проверяет real-db тест
   agent-product-sales.

   ── Ловушка категории ───────────────────────────────────────────────────────

   Знаменатель доли — сумма ВСЕХ строк заказа. Если отрезать строки по
   категории до оконной суммы, весь orders.total ляжет на оставшиеся строки:
   «Напитки» из заказа «напиток + чипсы» получили бы скидку и сумму чипсов.
   Поэтому окно считается по заказу целиком, а категория накладывается
   снаружи.

   ── Количество ──────────────────────────────────────────────────────────────

   Как и было — по ДОСТАВЛЕННОМУ (deliveredQty): курьерский путь частичного
   возврата когда-то писал только deliveredQuantity. Строка, доставленная
   нулём (отказ у двери), больше не даёт «заказа» товару, которого магазин не
   получил.
   ═══════════════════════════════════════════════════════════════════════════ */
import { sql, type SQL } from "drizzle-orm";
import { orders, orderItems, products, users } from "@db/schema";
import { revenuePeriodConditions, deliveredQty } from "../lib/order-status";
import { returnsInPeriod, returnLines } from "./revenue-returns";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/** Границы, когда период не задан: «за всё время». */
export const ALL_TIME_FROM = "1970-01-01";
export const ALL_TIME_TO = "2999-12-31";

export interface AgentProductRow {
  agentId: number | null;
  agentName: string | null;
  /** null — возврат без строк товара: его сумма есть, разложить не по чему. */
  productId: number | null;
  productName: string | null;
  productCode: string | null;
  unit: string | null;
  /** Продано (доставлено) за период. */
  totalQty: number;
  /** Вернулось за период (по дате проведения возврата). */
  returnedQty: number;
  /** По цене строк — до скидки заказа. Для сверки с «Топ товаров». */
  grossRevenue: number;
  /** Продано после скидки заказа (доля orders.total). */
  salesRevenue: number;
  /** Возвраты периода — доля суммы документа. */
  returnedAmount: number;
  /** Чистыми: salesRevenue − returnedAmount. Сходится с KPI и P&L. */
  totalRevenue: number;
  /** Заказов, в которых товар доставлен. */
  orderCount: number;
}

interface Filters { agentId?: number; category?: string }

function rowsOf(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw[0] : raw;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}
const num = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: number) => Math.round(v * 100) / 100;
const qty3 = (v: number) => Math.round(v * 1000) / 1000;
const keyOf = (agentId: number | null, productId: number | null) => `${agentId ?? "-"}:${productId ?? "-"}`;

async function salesLines(db: Db, tenantId: number, from: string, to: string, f: Filters) {
  const dq = deliveredQty();
  const line = sql`${dq} * ${orderItems.unitPrice}`;
  const conds: SQL[] = revenuePeriodConditions(tenantId, from, to);
  // Агент — внутри: все строки заказа принадлежат его агенту, окно не страдает.
  if (f.agentId) conds.push(sql`${orders.agentId} = ${f.agentId}`);
  const where = sql.join(conds, sql` AND `);
  // Категория — СНАРУЖИ окна (см. «Ловушка категории» в шапке файла).
  const outer: SQL[] = [sql`x.qty > 0`];
  if (f.category) outer.push(sql`x.category = ${f.category}`);
  const raw = await db.execute(sql`
    SELECT x.agent_id AS agentId, x.product_id AS productId,
      SUM(x.qty) AS qty, SUM(x.gross) AS gross, SUM(x.net) AS net,
      COUNT(DISTINCT x.order_id) AS orders
    FROM (
      SELECT ${orders.agentId} AS agent_id, ${orderItems.productId} AS product_id,
        ${orderItems.orderId} AS order_id, ${products.category} AS category,
        ${dq} AS qty,
        ${line} AS gross,
        CASE WHEN SUM(${line}) OVER w > 0 THEN ${line} * ${orders.total} / SUM(${line}) OVER w ELSE 0 END AS net
      FROM ${orderItems}
      INNER JOIN ${orders} ON ${orders.id} = ${orderItems.orderId}
      LEFT JOIN ${products} ON ${products.id} = ${orderItems.productId} AND ${products.tenantId} = ${tenantId}
      WHERE ${where}
      WINDOW w AS (PARTITION BY ${orderItems.orderId})
    ) x
    WHERE ${sql.join(outer, sql` AND `)}
    GROUP BY x.agent_id, x.product_id
  `);
  return rowsOf(raw).map(r => ({
    agentId: r.agentId == null ? null : Number(r.agentId),
    productId: r.productId == null ? null : Number(r.productId),
    qty: num(r.qty), gross: num(r.gross), net: num(r.net), orders: num(r.orders),
  }));
}

async function namesOf(db: Db, tenantId: number, agentIds: number[], productIds: number[]) {
  const agents = new Map<number, string>();
  const prods = new Map<number, { name: string; code: string | null; unit: string | null; category: string | null }>();
  if (agentIds.length > 0) {
    const list = sql.join(agentIds.map(id => sql`${id}`), sql`, `);
    for (const r of rowsOf(await db.execute(sql`SELECT ${users.id} AS id, ${users.name} AS name FROM ${users} WHERE ${users.tenantId} = ${tenantId} AND ${users.id} IN (${list})`))) {
      agents.set(Number(r.id), String(r.name ?? ""));
    }
  }
  if (productIds.length > 0) {
    const list = sql.join(productIds.map(id => sql`${id}`), sql`, `);
    for (const r of rowsOf(await db.execute(sql`SELECT ${products.id} AS id, ${products.name} AS name, ${products.code} AS code, ${products.unit} AS unit, ${products.category} AS category FROM ${products} WHERE ${products.tenantId} = ${tenantId} AND ${products.id} IN (${list})`))) {
      prods.set(Number(r.id), {
        name: String(r.name ?? ""),
        code: r.code == null || r.code === "" ? null : String(r.code),
        unit: r.unit == null ? null : String(r.unit),
        category: r.category == null ? null : String(r.category),
      });
    }
  }
  return { agents, prods };
}

export async function agentProductSales(
  db: Db, tenantId: number,
  input: { dateFrom?: string; dateTo?: string; agentId?: number; category?: string },
): Promise<AgentProductRow[]> {
  const from = input.dateFrom || ALL_TIME_FROM;
  const to = input.dateTo || ALL_TIME_TO;
  const f: Filters = { agentId: input.agentId, category: input.category };

  const [sales, heads] = await Promise.all([
    salesLines(db, tenantId, from, to, f),
    returnsInPeriod(db, tenantId, from, to),
  ]);
  const ownHeads = f.agentId ? heads.filter(h => h.agentId === f.agentId) : heads;
  const rLines = await returnLines(db, tenantId, ownHeads);

  const agentIds = new Set<number>();
  const productIds = new Set<number>();
  for (const s of sales) { if (s.agentId != null) agentIds.add(s.agentId); if (s.productId != null) productIds.add(s.productId); }
  for (const l of rLines) { if (l.head.agentId != null) agentIds.add(l.head.agentId); if (l.productId != null) productIds.add(l.productId); }
  const { agents, prods } = await namesOf(db, tenantId, [...agentIds], [...productIds]);

  const rows = new Map<string, AgentProductRow>();
  const rowFor = (agentId: number | null, productId: number | null): AgentProductRow => {
    const k = keyOf(agentId, productId);
    let r = rows.get(k);
    if (!r) {
      const p = productId == null ? undefined : prods.get(productId);
      r = {
        agentId, agentName: agentId == null ? null : agents.get(agentId) ?? null,
        productId, productName: p?.name ?? null, productCode: p?.code ?? null, unit: p?.unit ?? null,
        totalQty: 0, returnedQty: 0, grossRevenue: 0, salesRevenue: 0, returnedAmount: 0, totalRevenue: 0, orderCount: 0,
      };
      rows.set(k, r);
    }
    return r;
  };

  for (const s of sales) {
    const r = rowFor(s.agentId, s.productId);
    r.totalQty += s.qty; r.grossRevenue += s.gross; r.salesRevenue += s.net; r.orderCount += s.orders;
  }
  for (const l of rLines) {
    if (f.category) {
      // Возврат без строк товара не разложить по категории — в отчёте по
      // категории ему не место; так же он не попадает в «Прибыль» по товару.
      if (l.productId == null) continue;
      if (prods.get(l.productId)?.category !== f.category) continue;
    }
    const r = rowFor(l.head.agentId, l.productId);
    r.returnedQty += l.qty; r.returnedAmount += l.amount;
  }

  const out = [...rows.values()].map(r => ({
    ...r,
    totalQty: qty3(r.totalQty),
    returnedQty: qty3(r.returnedQty),
    grossRevenue: money(r.grossRevenue),
    salesRevenue: money(r.salesRevenue),
    returnedAmount: money(r.returnedAmount),
    totalRevenue: money(r.salesRevenue - r.returnedAmount),
  }));
  // Как и было: по имени агента, внутри — по сумме.
  return out.sort((a, b) =>
    (a.agentName ?? "").localeCompare(b.agentName ?? "", "ru") || (a.agentId ?? 0) - (b.agentId ?? 0) || b.totalRevenue - a.totalRevenue);
}

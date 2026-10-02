/**
 * «Прибыль»: выручка, себестоимость и валовая прибыль по товарам, магазинам
 * и агентам; на них же стоит ABC-анализ.
 *
 * ── Один проход по строкам заказов ──────────────────────────────────────────
 *
 * Все суммы строки — одним запросом с группировкой по нужному разрезу.
 * Скидка заказа делится между строками по их доле в сумме заказа оконной
 * суммой (SUM … OVER PARTITION BY order_id): отдельный запрос «сумма строк
 * каждого заказа» или подзапрос на строку — это второй проход по тем же
 * строкам. Сумма строк заказа после деления равна orders.total — тому самому
 * числу, из которого P&L берёт выручку.
 *
 * Возвраты вычитаются по правилу выручки (services/revenue-returns.ts): по
 * дате проведения, только по заказам, которые сами в выручке. Магазин и агент
 * — из заказа, товар — из строк документа.
 *
 * ── Сверка ──────────────────────────────────────────────────────────────────
 *
 * Итог разложения сверяется с services/period-gross.ts — тем же расчётом, из
 * которого P&L показывает выручку и себестоимость. Разойтись они могут только
 * на заказе без строк товаров (старый импорт, ручная правка): его сумма есть
 * в P&L, а разложить её не по чему. Тогда экран называет разницу, а не
 * прячет её.
 */
import { sql, type SQL } from "drizzle-orm";
import { orders, orderItems, products, shops, users } from "@db/schema";
import { revenuePeriodConditions, deliveredQty } from "../lib/order-status";
import {
  returnsInPeriod, returnedByProduct, NOTHING_RETURNED,
  type ReturnedValue, type ReturnRow,
} from "./revenue-returns";
import { periodGross } from "./period-gross";
import {
  MARGIN_RULES, marginFlagOf, marginPctOf, pct1,
  type MarginDim, type MarginReason, type MarginRow,
} from "@contracts/margin";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/** Строка разреза до округления — дробные суммы, как их сложила база. */
interface RawLine {
  key: number | null;
  name: string | null;
  sub: string | null;
  /** Сумма строк по цене строки, до скидки заказа. */
  gross: number;
  /** То же после скидки заказа (доля orders.total). */
  net: number;
  cost: number;
  /** Сколько недополучили на строках дешевле себестоимости. */
  belowCost: number;
  /** На сколько цена прайс-листа/ступени ниже карточки. */
  listCut: number;
  /** Выручка строк без себестоимости. */
  noCost: number;
  qty: number;
  orders: number;
}

function rowsOf(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw[0] : raw;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

const num = (v: unknown) => Number(v ?? 0) || 0;

async function salesLines(db: Db, tenantId: number, from: string, to: string, dim: MarginDim): Promise<RawLine[]> {
  const dq = deliveredQty();
  const line = sql`${dq} * ${orderItems.unitPrice}`;
  let key: SQL, name: SQL, sub: SQL, join: SQL;
  if (dim === "product") {
    key = sql`${orderItems.productId}`; name = sql`${products.name}`; sub = sql`${products.code}`; join = sql``;
  } else if (dim === "shop") {
    key = sql`${orders.shopId}`; name = sql`${shops.name}`; sub = sql`${shops.city}`;
    join = sql`LEFT JOIN ${shops} ON ${shops.id} = ${orders.shopId} AND ${shops.tenantId} = ${tenantId}`;
  } else {
    key = sql`${orders.agentId}`; name = sql`${users.name}`; sub = sql`NULL`;
    join = sql`LEFT JOIN ${users} ON ${users.id} = ${orders.agentId} AND ${users.tenantId} = ${tenantId}`;
  }
  const where = sql.join(revenuePeriodConditions(tenantId, from, to), sql` AND `);
  const raw = await db.execute(sql`
    SELECT x.k AS k, ANY_VALUE(x.name) AS name, ANY_VALUE(x.sub) AS sub,
      SUM(x.gross) AS gross, SUM(x.net) AS net, SUM(x.cost) AS cost,
      SUM(x.below_cost) AS belowCost, SUM(x.list_cut) AS listCut, SUM(x.no_cost) AS noCost,
      SUM(x.qty) AS qty, COUNT(DISTINCT x.order_id) AS orders
    FROM (
      SELECT ${key} AS k, ${name} AS name, ${sub} AS sub, ${orderItems.orderId} AS order_id,
        ${dq} AS qty,
        ${line} AS gross,
        CASE WHEN SUM(${line}) OVER w > 0 THEN ${line} * ${orders.total} / SUM(${line}) OVER w ELSE 0 END AS net,
        ${dq} * ${orderItems.costPrice} AS cost,
        CASE WHEN ${orderItems.unitPrice} < ${orderItems.costPrice}
          THEN ${dq} * (${orderItems.costPrice} - ${orderItems.unitPrice}) ELSE 0 END AS below_cost,
        CASE WHEN ${orderItems.priceListId} IS NOT NULL AND ${orderItems.unitPrice} < ${products.unitPrice}
          THEN ${dq} * (${products.unitPrice} - ${orderItems.unitPrice}) ELSE 0 END AS list_cut,
        CASE WHEN ${orderItems.costPrice} = 0 THEN ${line} ELSE 0 END AS no_cost
      FROM ${orderItems}
      INNER JOIN ${orders} ON ${orders.id} = ${orderItems.orderId}
      LEFT JOIN ${products} ON ${products.id} = ${orderItems.productId} AND ${products.tenantId} = ${tenantId}
      ${join}
      WHERE ${where}
      WINDOW w AS (PARTITION BY ${orderItems.orderId})
    ) x
    GROUP BY x.k
  `);
  return rowsOf(raw).map(r => ({
    key: r.k == null ? null : Number(r.k),
    name: r.name == null ? null : String(r.name),
    sub: r.sub == null || r.sub === "" ? null : String(r.sub),
    gross: num(r.gross), net: num(r.net), cost: num(r.cost),
    belowCost: num(r.belowCost), listCut: num(r.listCut), noCost: num(r.noCost),
    qty: num(r.qty), orders: num(r.orders),
  }));
}

/** Имена тех, у кого в периоде только возвраты (продажи были раньше). */
async function namesOf(db: Db, tenantId: number, dim: MarginDim, ids: number[]): Promise<Map<number, { name: string; sub: string | null }>> {
  const out = new Map<number, { name: string; sub: string | null }>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const q = dim === "product"
    ? sql`SELECT ${products.id} AS id, ${products.name} AS name, ${products.code} AS sub FROM ${products} WHERE ${products.tenantId} = ${tenantId} AND ${products.id} IN (${list})`
    : dim === "shop"
      ? sql`SELECT ${shops.id} AS id, ${shops.name} AS name, ${shops.city} AS sub FROM ${shops} WHERE ${shops.tenantId} = ${tenantId} AND ${shops.id} IN (${list})`
      : sql`SELECT ${users.id} AS id, ${users.name} AS name, NULL AS sub FROM ${users} WHERE ${users.tenantId} = ${tenantId} AND ${users.id} IN (${list})`;
  for (const r of rowsOf(await db.execute(q))) {
    out.set(Number(r.id), { name: String(r.name ?? ""), sub: r.sub == null || r.sub === "" ? null : String(r.sub) });
  }
  return out;
}

function returnsBy(dim: MarginDim, rows: ReturnRow[]): Map<number, ReturnedValue> {
  const out = new Map<number, ReturnedValue>();
  for (const r of rows) {
    const k = dim === "shop" ? r.shopId : r.agentId;
    if (k == null) continue;
    const prev = out.get(k) ?? NOTHING_RETURNED;
    out.set(k, { amount: prev.amount + r.amount, cost: prev.cost + r.cost, count: prev.count + 1 });
  }
  return out;
}

/** Строка разреза в дробных суммах — сырьё и для «Прибыли», и для ABC. */
export interface ExactRow {
  key: number | null;
  name: string;
  sub: string | null;
  revenue: number;
  cost: number;
  line: RawLine;
  returned: ReturnedValue;
}

export interface MarginExact {
  rows: ExactRow[];
  /** Строки возвратов периода — уже прочитаны, сверке они нужны те же. */
  returnRows: ReturnRow[];
}

/** Разрез за период: продажи минус возвраты, дробными суммами. */
export async function marginExact(db: Db, tenantId: number, from: string, to: string, dim: MarginDim): Promise<MarginExact> {
  const [lines, returnRows] = await Promise.all([
    salesLines(db, tenantId, from, to, dim),
    returnsInPeriod(db, tenantId, from, to),
  ]);

  let byKey: Map<number, ReturnedValue>;
  let unassigned: ReturnedValue = NOTHING_RETURNED;
  if (dim === "product") {
    const r = await returnedByProduct(db, tenantId, from, to, returnRows);
    byKey = r.byProduct;
    unassigned = r.unassigned;
  } else {
    byKey = returnsBy(dim, returnRows);
  }

  const seen = new Set(lines.map(l => l.key));
  const onlyReturns = [...byKey.keys()].filter(k => !seen.has(k));
  const names = await namesOf(db, tenantId, dim, onlyReturns);

  const empty = (key: number | null): RawLine => ({
    key, name: null, sub: null, gross: 0, net: 0, cost: 0, belowCost: 0, listCut: 0, noCost: 0, qty: 0, orders: 0,
  });
  const all = [...lines, ...onlyReturns.map(k => ({ ...empty(k), ...names.get(k) }))];
  const rows: ExactRow[] = all.map(l => {
    const ret = l.key == null ? NOTHING_RETURNED : byKey.get(l.key) ?? NOTHING_RETURNED;
    return {
      key: l.key, name: l.name ?? (l.key == null ? "—" : `#${l.key}`), sub: l.sub,
      revenue: l.net - ret.amount, cost: l.cost - ret.cost, line: l, returned: ret,
    };
  });
  if (unassigned.amount !== 0 || unassigned.cost !== 0) {
    rows.push({
      key: null, name: "Возвраты без строк товара", sub: null,
      revenue: -unassigned.amount, cost: -unassigned.cost, line: empty(null), returned: unassigned,
    });
  }
  return { rows, returnRows };
}

function reasonsOf(r: ExactRow): MarginReason[] {
  const out: MarginReason[] = [];
  const l = r.line;
  const belowCost = Math.round(l.belowCost);
  if (belowCost >= 1) out.push({ code: "below_cost", amount: belowCost });
  const discount = Math.round(l.gross - l.net);
  const gross = Math.round(l.gross);
  if (discount >= 1 && discount * 100 >= gross * MARGIN_RULES.BIG_DISCOUNT_PCT) {
    out.push({ code: "discount", amount: discount, pct: Math.round((discount * 100) / gross) });
  }
  const cut = Math.round(l.listCut);
  if (cut >= 1 && cut * 100 >= (gross + cut) * MARGIN_RULES.PRICE_LIST_CUT_PCT) {
    out.push({ code: "price_list", amount: cut, pct: Math.round((cut * 100) / (gross + cut)) });
  }
  const returned = Math.round(r.returned.amount);
  const sold = Math.round(l.net);
  if (returned >= 1 && (sold <= 0 || returned * 100 >= sold * MARGIN_RULES.HIGH_RETURNS_PCT)) {
    out.push({ code: "returns", amount: returned, pct: sold > 0 ? Math.round((returned * 100) / sold) : 100 });
  }
  const noCost = Math.round(l.noCost);
  if (noCost >= 1) out.push({ code: "no_cost", amount: noCost });
  return out;
}

export interface MarginReport {
  from: string;
  to: string;
  by: MarginDim;
  rows: MarginRow[];
  totals: { revenue: number; cost: number; profit: number; marginPct: number | null; flagged: number };
  /**
   * Сверка с P&L за тот же период. matches — разложение и P&L совпали до
   * сума; иначе diff — на сколько P&L больше разложения.
   */
  pnl: {
    revenue: number; cost: number; profit: number;
    matches: boolean;
    diff: { revenue: number; cost: number };
  };
}

export async function marginReport(db: Db, tenantId: number, from: string, to: string, by: MarginDim): Promise<MarginReport> {
  const { rows: exact, returnRows } = await marginExact(db, tenantId, from, to, by);
  const pnl = await periodGross(db, tenantId, from, to, returnRows);

  const sumRevenue = exact.reduce((s, r) => s + r.revenue, 0);
  const sumCost = exact.reduce((s, r) => s + r.cost, 0);
  const matches = Math.abs(pnl.revenue - sumRevenue) < 1 && Math.abs(pnl.cogs - sumCost) < 1;
  /*
    Плитки — числами P&L, когда разложение с ним сходится: дробь деления
    скидки могла бы округлиться в другую сторону, и «сходится с P&L» стояло бы
    под числом, отличным от P&L на сум.
  */
  const totals = {
    revenue: Math.round(matches ? pnl.revenue : sumRevenue), cost: Math.round(matches ? pnl.cogs : sumCost),
    profit: 0, marginPct: null as number | null, flagged: 0,
  };
  totals.profit = totals.revenue - totals.cost;
  totals.marginPct = marginPctOf(totals.revenue, totals.profit);

  const rows: MarginRow[] = exact.map(r => {
    const revenue = Math.round(r.revenue);
    const cost = Math.round(r.cost);
    const profit = revenue - cost;
    const flag = marginFlagOf({ revenue, profit }, totals.revenue);
    return {
      key: r.key, name: r.name, sub: r.sub,
      revenue, cost, profit,
      marginPct: marginPctOf(revenue, profit),
      revenueShare: pct1(revenue, totals.revenue) ?? 0,
      profitShare: pct1(profit, totals.profit),
      qty: by === "product" ? Math.round(r.line.qty * 100) / 100 : null,
      orders: r.line.orders,
      flag,
      reasons: reasonsOf(r),
    };
  }).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "ru"));
  totals.flagged = rows.filter(r => r.flag).length;

  const pnlRevenue = Math.round(pnl.revenue);
  const pnlCost = Math.round(pnl.cogs);
  const diff = { revenue: Math.round(pnl.revenue - sumRevenue), cost: Math.round(pnl.cogs - sumCost) };
  return {
    from, to, by, rows, totals,
    pnl: {
      revenue: pnlRevenue, cost: pnlCost, profit: pnlRevenue - pnlCost,
      // Меньше сума — это дробь деления скидки, а не расхождение.
      matches,
      diff,
    },
  };
}

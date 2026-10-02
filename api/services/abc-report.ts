/**
 * ABC-анализ товаров и магазинов за период.
 *
 * Деньги — из того же разреза, что «Прибыль» (services/margin-report.ts):
 * выручка после скидки и за вычетом возвратов периода, прибыль — выручка
 * минус себестоимость. Классы и границы — contracts/margin.ts (abcClassify),
 * там же — что происходит ровно на 80% и 95%.
 *
 * ── Две подсказки, ради которых раздел открывают ────────────────────────────
 *
 *  • C-товары на ОСНОВНОМ складе: продаём только с него (решение владельца),
 *    поэтому лежащее на других складах «заморожено» по другой причине и сюда
 *    не идёт. Товар с остатком, но без продаж за период — тоже C: это самые
 *    замороженные деньги, и без него подсказка врала бы в лучшую сторону.
 *  • A-магазины без заказа ABC_RULES.A_SHOP_IDLE_DAYS дней и дольше — со
 *    светофором магазина (services/shop-light.ts): «давно не заказывал» и
 *    «у него просрочка» — разные разговоры.
 *
 * ── Кто что видит ───────────────────────────────────────────────────────────
 *
 * ABC по выручке — тем же ролям, что «Продажи» (reportsQuery). По прибыли и
 * себестоимость остатка — только тем, кому открыт P&L (finance): прибыль
 * строки и себестоимость склада — та же наценка, которую financeQuery прячет
 * от офиса и поля. Остальным остаток оценивается по цене продажи.
 */
import { and, eq, gt } from "drizzle-orm";
import { products, warehouses, warehouseStock } from "@db/schema";
import { marginExact } from "./margin-report";
import { shopLights } from "./shop-light";
import {
  ABC_RULES, abcClassify, abcTotals,
  type AbcClass, type AbcMetric, type AbcSubject,
} from "@contracts/margin";
import type { ShopLightColor, ShopLightReason } from "@contracts/shop-light";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface AbcRow {
  key: number | null;
  name: string;
  sub: string | null;
  /** Деньги, по которым ставится класс: выручка или прибыль. */
  value: number;
  revenue: number;
  /** Прибыль — только при metric = profit (только тем, кому открыт P&L). */
  profit?: number;
  abc: AbcClass;
  share: number;
  cumShare: number;
  /** Остаток на основном складе (товары). */
  stockQty?: number;
}

export interface AbcReport {
  of: AbcSubject;
  metric: AbcMetric;
  rows: AbcRow[];
  totals: ReturnType<typeof abcTotals>;
  /** C-товары с остатком на основном складе. */
  cStock: null | {
    count: number;
    /** По себестоимости — только finance; иначе null. */
    atCost: number | null;
    atPrice: number;
    top: Array<{ key: number; name: string; qty: number; unit: string; atCost: number | null; atPrice: number }>;
  };
  /** A-магазины без заказа A_SHOP_IDLE_DAYS+ дней. */
  idleA: null | Array<{
    key: number; name: string; sub: string | null; value: number;
    daysSinceOrder: number; color: ShopLightColor; reasons: ShopLightReason[];
  }>;
}

async function defaultStock(db: Db, tenantId: number) {
  return db.select({
    productId: warehouseStock.productId,
    qty: warehouseStock.currentStock,
    name: products.name,
    code: products.code,
    costPrice: products.costPrice,
    unitPrice: products.unitPrice,
    unit: products.unit,
  })
    .from(warehouseStock)
    .innerJoin(warehouses, and(eq(warehouses.id, warehouseStock.warehouseId), eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(warehouseStock.tenantId, tenantId), gt(warehouseStock.currentStock, "0")));
}

export async function abcReport(db: Db, tenantId: number, opts: {
  from: string; to: string; of: AbcSubject; metric: AbcMetric; finance: boolean;
}): Promise<AbcReport> {
  const showProfit = opts.metric === "profit" && opts.finance;
  const [{ rows: exact }, stock] = await Promise.all([
    marginExact(db, tenantId, opts.from, opts.to, opts.of),
    opts.of === "product" ? defaultStock(db, tenantId) : Promise.resolve([]),
  ]);

  const base = exact.map(r => {
    const revenue = Math.round(r.revenue);
    const profit = revenue - Math.round(r.cost);
    return { key: r.key, name: r.name, sub: r.sub, revenue, profit, value: opts.metric === "profit" ? profit : revenue };
  });

  const stockOf = new Map(stock.map(s => [Number(s.productId), s]));
  if (opts.of === "product") {
    // Лежит, но за период не продавался — нулевые деньги, класс C.
    const sold = new Set(base.map(b => b.key));
    for (const s of stock) {
      const k = Number(s.productId);
      if (!sold.has(k)) base.push({ key: k, name: s.name, sub: s.code ?? null, revenue: 0, profit: 0, value: 0 });
    }
  }

  const placed = abcClassify(base);
  const rows: AbcRow[] = placed.map(r => {
    const row: AbcRow = {
      key: r.key, name: r.name, sub: r.sub, value: r.value, revenue: r.revenue,
      abc: r.abc, share: r.share, cumShare: r.cumShare,
    };
    if (showProfit) row.profit = r.profit;
    if (opts.of === "product" && r.key != null) {
      const s = stockOf.get(r.key);
      if (s) row.stockQty = Math.round(Number(s.qty) * 1000) / 1000;
    }
    return row;
  });

  let cStock: AbcReport["cStock"] = null;
  if (opts.of === "product") {
    const lying = placed.filter(r => r.abc === "C" && r.key != null && stockOf.has(r.key)).map(r => {
      const s = stockOf.get(r.key!)!;
      const qty = Number(s.qty) || 0;
      return {
        key: r.key!, name: r.name, qty: Math.round(qty * 1000) / 1000, unit: String(s.unit),
        atCost: opts.finance ? Math.round(qty * (Number(s.costPrice) || 0)) : null,
        atPrice: Math.round(qty * (Number(s.unitPrice) || 0)),
      };
    });
    const sortKey = (x: { atCost: number | null; atPrice: number }) => (opts.finance ? x.atCost ?? 0 : x.atPrice);
    lying.sort((a, b) => sortKey(b) - sortKey(a) || a.name.localeCompare(b.name, "ru"));
    cStock = {
      count: lying.length,
      atCost: opts.finance ? lying.reduce((s, x) => s + (x.atCost ?? 0), 0) : null,
      atPrice: lying.reduce((s, x) => s + x.atPrice, 0),
      top: lying.slice(0, 10),
    };
  }

  let idleA: AbcReport["idleA"] = null;
  if (opts.of === "shop") {
    const aShops = placed.filter(r => r.abc === "A" && r.key != null);
    const lights = await shopLights(db, tenantId, aShops.map(r => r.key!));
    idleA = aShops.flatMap(r => {
      const l = lights.get(r.key!);
      if (!l || l.daysSinceOrder == null || l.daysSinceOrder < ABC_RULES.A_SHOP_IDLE_DAYS) return [];
      return [{ key: r.key!, name: r.name, sub: r.sub, value: r.value, daysSinceOrder: l.daysSinceOrder, color: l.color, reasons: l.reasons }];
    }).sort((a, b) => b.daysSinceOrder - a.daysSinceOrder || b.value - a.value);
  }

  return { of: opts.of, metric: opts.metric, rows, totals: abcTotals(placed), cStock, idleA };
}


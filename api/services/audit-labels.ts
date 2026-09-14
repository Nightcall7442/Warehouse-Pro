import { and, eq, inArray } from "drizzle-orm";
import { orders, shops, products, users, arrivals, loadingLists, stockCounts, priceLists, apiKeys, tenants, supplies, suppliers, returns, payments } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/*
  Имя объекта журнала — как его зовут люди.

  Журнал хранит targetType + targetId («order», 1234) — этого хватает машине и
  не хватает директору: номер строки базы в программе не показывается нигде.
  Здесь по типу берётся то, что человек видит на экране: номер заказа, имя
  магазина, название товара, имя сотрудника. Одна выборка на тип, а не на
  строку: страница журнала — полсотни записей, и полсотни запросов ради
  подписей были бы заметны.

  Типы, у которых человеческого имени нет (settings, database, role), остаются
  без подписи — экран покажет только действие.
*/
type Loader = (db: Db, tenantId: number, ids: number[]) => Promise<Map<number, string>>;

const money = (v: unknown) => `${String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} сум`;

const LOADERS: Record<string, Loader> = {
  order: async (db, tenantId, ids) => {
    const rows = await db.select({ id: orders.id, n: orders.orderNumber, shop: shops.name })
      .from(orders).leftJoin(shops, eq(shops.id, orders.shopId))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, ids)));
    return new Map(rows.map(r => [r.id, r.shop ? `${r.n} · ${r.shop}` : r.n]));
  },
  shop: async (db, tenantId, ids) => {
    const rows = await db.select({ id: shops.id, n: shops.name }).from(shops).where(and(eq(shops.tenantId, tenantId), inArray(shops.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  product: async (db, tenantId, ids) => {
    const rows = await db.select({ id: products.id, n: products.name, code: products.code }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
    return new Map(rows.map(r => [r.id, r.code ? `${r.n} (${r.code})` : r.n]));
  },
  user: async (db, tenantId, ids) => {
    const rows = await db.select({ id: users.id, n: users.name }).from(users).where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  arrival: async (db, tenantId, ids) => {
    const rows = await db.select({ id: arrivals.id, n: arrivals.arrivalNumber }).from(arrivals).where(and(eq(arrivals.tenantId, tenantId), inArray(arrivals.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  loading_list: async (db, tenantId, ids) => {
    const rows = await db.select({ id: loadingLists.id, n: loadingLists.listNumber }).from(loadingLists).where(and(eq(loadingLists.tenantId, tenantId), inArray(loadingLists.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  stock_count: async (db, tenantId, ids) => {
    const rows = await db.select({ id: stockCounts.id, n: stockCounts.number }).from(stockCounts).where(and(eq(stockCounts.tenantId, tenantId), inArray(stockCounts.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  price_list: async (db, tenantId, ids) => {
    const rows = await db.select({ id: priceLists.id, n: priceLists.name }).from(priceLists).where(and(eq(priceLists.tenantId, tenantId), inArray(priceLists.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  api_key: async (db, tenantId, ids) => {
    const rows = await db.select({ id: apiKeys.id, n: apiKeys.name }).from(apiKeys).where(and(eq(apiKeys.tenantId, tenantId), inArray(apiKeys.id, ids)));
    return new Map(rows.map(r => [r.id, r.n]));
  },
  supply: async (db, tenantId, ids) => {
    const rows = await db.select({ id: supplies.id, n: supplies.supplyNumber, sup: suppliers.name })
      .from(supplies).leftJoin(suppliers, eq(suppliers.id, supplies.supplierId))
      .where(and(eq(supplies.tenantId, tenantId), inArray(supplies.id, ids)));
    return new Map(rows.map(r => [r.id, r.sup ? `${r.n} · ${r.sup}` : r.n]));
  },
  return: async (db, tenantId, ids) => {
    const rows = await db.select({ id: returns.id, order: orders.orderNumber, shop: shops.name })
      .from(returns).leftJoin(orders, eq(orders.id, returns.orderId)).leftJoin(shops, eq(shops.id, returns.shopId))
      .where(and(eq(returns.tenantId, tenantId), inArray(returns.id, ids)));
    return new Map(rows.map(r => [r.id, [r.shop, r.order].filter(Boolean).join(" · ") || `возврат №${r.id}`]));
  },
  payment: async (db, tenantId, ids) => {
    const rows = await db.select({ id: payments.id, amount: payments.amount, shop: shops.name })
      .from(payments).leftJoin(shops, eq(shops.id, payments.shopId))
      .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, ids)));
    return new Map(rows.map(r => [r.id, `${r.shop ?? ""} · ${money(r.amount)}`.replace(/^ · /, "")]));
  },
  tenant: async (db, _tenantId, ids) => {
    const rows = await db.select({ id: tenants.id, n: tenants.name }).from(tenants).where(inArray(tenants.id, ids));
    return new Map(rows.map(r => [r.id, r.n]));
  },
};

export const LABELED_TYPES = Object.keys(LOADERS);

/** Имя одного объекта — для записи в момент действия. */
export async function labelFor(db: Db, tenantId: number, targetType: string, targetId: number): Promise<string | null> {
  const load = LOADERS[targetType];
  if (!load) return null;
  try {
    return (await load(db, tenantId, [targetId])).get(targetId) ?? null;
  } catch {
    return null; // подпись — украшение записи, а не её условие
  }
}

/** Имена для страницы: строки, записанные до появления подписи, получают её при чтении. */
export async function labelsFor(db: Db, tenantId: number, rows: Array<{ targetType: string | null; targetId: number | null; targetLabel: string | null }>): Promise<Map<string, string>> {
  const want = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.targetLabel || !r.targetType || !r.targetId || !LOADERS[r.targetType]) continue;
    (want.get(r.targetType) ?? want.set(r.targetType, new Set()).get(r.targetType)!).add(r.targetId);
  }
  const out = new Map<string, string>();
  await Promise.all([...want].map(async ([type, ids]) => {
    try {
      for (const [id, label] of await LOADERS[type](db, tenantId, [...ids])) out.set(`${type}:${id}`, label);
    } catch { /* без подписи, но с записью */ }
  }));
  return out;
}

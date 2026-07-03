import { orders, warehouseStock, users, shops, orderItems, products } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { subDays } from "date-fns";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export const DashboardService = {
  async getOverview(db: Db, tenantId: number) {
    const cacheKey = CacheKeys.dashboardKpis(tenantId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const db2 = db;
    const today = new Date().toISOString().split("T")[0];

    const [todaysOrders, todaysRevenue, activeAgents, totalStock, customerDebt, marginResult] = await Promise.all([
      db2.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`)),
      db2.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, eq(orders.status, "completed"))),
      db2.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db2.select({ total: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` }).from(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId)),
      db2.select({ total: sql<string>`COALESCE(SUM(${shops.debt}), 0)` }).from(shops)
        .where(eq(shops.tenantId, tenantId)),
      db2.select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
        totalCost: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orderItems.quantity} * ${products.costPrice} ELSE 0 END), 0)`,
      }).from(orders)
        .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orders.tenantId, tenantId)),
    ]);

    const totalRev = Number(marginResult[0]?.totalRevenue ?? 0);
    const totalCostVal = Number(marginResult[0]?.totalCost ?? 0);
    const grossMargin = totalRev > 0 ? ((totalRev - totalCostVal) / totalRev) * 100 : 0;

    const result = {
      todayOrders: Number(todaysOrders[0]?.count ?? 0),
      todayRevenue: Number(todaysRevenue[0]?.total ?? 0),
      activeAgents: Number(activeAgents[0]?.count ?? 0),
      totalStock: Number(totalStock[0]?.total ?? 0),
      customerDebt: Number(customerDebt[0]?.total ?? 0),
      grossMargin: Math.round(grossMargin * 10) / 10,
    };

    cache.set(cacheKey, result, CacheTTL.kpis);
    return result;
  },

  async getRevenueTrend(db: Db, tenantId: number, days: number = 30) {
    const cacheKey = `dashboard:revenueTrend:${tenantId}:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const startDate = subDays(new Date(), days).toISOString().split("T")[0];

    const result = await db.select({
      date: sql<string>`DATE(${orders.createdAt})`,
      revenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
    })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) >= ${startDate}`))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    cache.set(cacheKey, result, CacheTTL.kpis);
    return result;
  },

  async getOrderTrend(db: Db, tenantId: number, days: number = 30) {
    const cacheKey = `dashboard:orderTrend:${tenantId}:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const startDate = subDays(new Date(), days).toISOString().split("T")[0];

    const result = await db.select({
      date: sql<string>`DATE(${orders.createdAt})`,
      orderCount: sql<number>`count(*)`,
      revenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
    })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) >= ${startDate}`))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    cache.set(cacheKey, result, CacheTTL.kpis);
    return result;
  },

  async getStatusBreakdown(db: Db, tenantId: number) {
    const cacheKey = `dashboard:statusBreakdown:${tenantId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = await db.select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.tenantId, tenantId))
      .groupBy(orders.status);

    cache.set(cacheKey, result, CacheTTL.kpis);
    return result;
  },

  async getRecentActivity(db: Db, tenantId: number) {
    return db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, createdAt: orders.createdAt, shopName: shops.name, agentName: users.name,
    })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(eq(orders.tenantId, tenantId))
      .orderBy(desc(orders.createdAt))
      .limit(10);
  },
};

import { notifications, warehouseStock, products, orders, dailyPlans, shops } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";
import { sseBus } from "../lib/sse";
import { DEBT_NOTIFICATION_THRESHOLD } from "../lib/constants";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

type NotificationType = "order" | "payment" | "stock" | "system";

export const NotificationService = {
  /**
   * Create a notification and emit SSE event for real-time push.
   * Fire-and-forget — errors don't block the caller.
   */
  async create(
    db: Db,
    opts: {
      tenantId: number;
      userId: number;
      type: NotificationType;
      title: string;
      message?: string;
      link?: string;
    },
  ): Promise<void> {
    try {
      const [result] = await db.insert(notifications).values({
        tenantId: opts.tenantId,
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        message: opts.message ?? null,
        link: opts.link ?? null,
      });

      // Emit SSE for real-time push
      sseBus.emit({
        type: "notification.new",
        tenantId: opts.tenantId,
        userId: opts.userId,
        data: {
          id: Number(result.insertId),
          type: opts.type,
          title: opts.title,
          message: opts.message,
          link: opts.link,
        },
      });

      // Invalidate unread count cache
      cache.invalidatePrefix(`notif_unread:${opts.tenantId}:${opts.userId}`);
    } catch (err) {
      logger.error("Failed to create notification", { error: String(err), type: opts.type });
    }
  },

  /**
   * Notify multiple users in a tenant (e.g., all operators about a new order).
   */
  async createBulk(
    db: Db,
    opts: {
      tenantId: number;
      userIds: number[];
      type: NotificationType;
      title: string;
      message?: string;
      link?: string;
    },
  ): Promise<void> {
    for (const userId of opts.userIds) {
      await this.create(db, { ...opts, userId });
    }
  },

  async list(db: Db, tenantId: number, userId: number) {
    return db.select({
      id: notifications.id, type: notifications.type, title: notifications.title,
      message: notifications.message, isRead: notifications.isRead,
      link: notifications.link, createdAt: notifications.createdAt,
    }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.tenantId, tenantId)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  },

  async unreadCount(db: Db, tenantId: number, userId: number): Promise<number> {
    const cacheKey = `notif_unread:${tenantId}:${userId}`;
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.isRead, false),
      ));
    const count = Number(result?.count ?? 0);
    cache.set(cacheKey, count, 30_000); // 30s cache
    return count;
  },

  async markRead(db: Db, tenantId: number, notificationId: number, userId: number) {
    await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), eq(notifications.tenantId, tenantId)));

    cache.invalidatePrefix(`notif_unread:${tenantId}:${userId}`);

    sseBus.emit({
      type: "notification.new",
      tenantId,
      userId,
      data: { notificationId, action: "read" },
    });

    return { success: true };
  },

  async markAllRead(db: Db, tenantId: number, userId: number) {
    await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.tenantId, tenantId)));

    cache.invalidatePrefix(`notif_unread:${tenantId}:${userId}`);

    sseBus.emit({
      type: "notification.new",
      tenantId,
      userId,
      data: { action: "read_all" },
    });

    return { success: true };
  },

  async getSmartAlerts(db: Db, tenantId: number, userId: number) {
    const cacheKey = CacheKeys.smartAlerts(tenantId, userId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const today = new Date().toISOString().split("T")[0];
    const alerts: Array<{ type: string; title: string; message: string; severity: "info" | "warning" | "danger" }> = [];

    const [lowStock, pendingOrders, todayPlans, highDebt] = await Promise.all([
      db.select({
        productName: products.name,
        available: warehouseStock.available,
        reorderPoint: products.reorderPoint,
      })
        .from(warehouseStock)
        .leftJoin(products, eq(warehouseStock.productId, products.id))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.available} < ${products.reorderPoint}`))
        .limit(5),

      db.select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "new"))),

      db.select({
        total: sql<number>`count(*)`,
        visited: sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
      })
        .from(dailyPlans)
        .where(and(eq(dailyPlans.tenantId, tenantId), sql`DATE(${dailyPlans.planDate}) = ${today}`)),

      db.select({
        shopName: shops.name,
        debt: shops.debt,
      })
        .from(shops)
        .where(and(eq(shops.tenantId, tenantId), sql`${shops.debt} > ${DEBT_NOTIFICATION_THRESHOLD}`))
        .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL)`))
        .limit(3),
    ]);

    lowStock.forEach(s => {
      alerts.push({
        type: "low_stock",
        title: `Низкий остаток: ${s.productName}`,
        message: `Осталось ${Number(s.available ?? 0).toFixed(1)} (порог: ${Number(s.reorderPoint ?? 0).toFixed(0)})`,
        severity: "warning",
      });
    });

    const pendingCount = Number(pendingOrders[0]?.count ?? 0);
    if (pendingCount > 0) {
      alerts.push({
        type: "pending_orders",
        title: `${pendingCount} новых заказов`,
        message: "Ожидают обработки",
        severity: "info",
      });
    }

    const planData = todayPlans[0];
    if (planData && Number(planData.total) > 0) {
      const pct = Math.round((Number(planData.visited) / Number(planData.total)) * 100);
      alerts.push({
        type: "plan_summary",
        title: `План: ${planData.visited}/${planData.total} (${pct}%)`,
        message: pct === 100 ? "Все визиты выполнены!" : `${Number(planData.total) - Number(planData.visited)} визитов осталось`,
        severity: pct === 100 ? "info" : pct >= 50 ? "warning" : "danger",
      });
    }

    highDebt.forEach(s => {
      alerts.push({
        type: "high_debt",
        title: `Долг: ${s.shopName}`,
        message: `${Number(s.debt ?? 0).toLocaleString("ru")} сум`,
        severity: "danger",
      });
    });

    cache.set(cacheKey, alerts, CacheTTL.alerts);
    return alerts;
  },
};

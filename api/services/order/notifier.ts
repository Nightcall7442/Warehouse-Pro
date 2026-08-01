import { eq, and, sql } from "drizzle-orm";
import { orders, shops, users, notifications } from "@db/schema";
import { logger } from "../../lib/logger";
import type { Db, OrderStatus } from "./types";

/**
 * In-app notifications and push for order events.
 *
 * Every function here runs *after* its transaction has committed and swallows its
 * own failures: a push provider being down must not roll back an order that is
 * already placed. Failures are logged, not raised.
 */

const STATUS_LABELS: Record<string, string> = {
  completed: "выполнен",
  cancelled: "отменён",
  processing: "в обработке",
};

export const OrderNotifier = {
  /** Tell operators/CEO/supervisors that an order came in. */
  async orderCreated(db: Db, tenantId: number, order: { id: number; orderNumber: string; shopId: number; total: number }): Promise<void> {
    try {
      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, order.shopId)).limit(1);
      const operators = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

      const title = `Новый заказ ${order.orderNumber}`;
      const body = `${shop?.name ?? "Магазин"} — ${order.total.toLocaleString("ru")} сум`;

      // Batch insert notifications (N+1 fix)
      if (operators.length > 0) {
        await db.insert(notifications).values(operators.map(op => ({
          tenantId,
          userId: op.id,
          type: "order" as const,
          title,
          message: body,
          link: `/orders/${order.id}`,
        })));
      }

      const { sendPushToRole } = await import("../push-service");
      const pushMsg = { title, body, data: { type: "order", orderId: order.id } };
      await Promise.all([
        sendPushToRole(tenantId, "ceo", pushMsg),
        sendPushToRole(tenantId, "operator", pushMsg),
        sendPushToRole(tenantId, "supervisor", pushMsg),
      ]);
    } catch (e) {
      logger.warn("Order notification failed", { error: String(e) });
    }
  },

  /** Tell the agent who placed the order that its status moved. */
  async statusChanged(db: Db, tenantId: number, orderId: number, newStatus: OrderStatus): Promise<void> {
    try {
      const [orderRow] = await db.select({ orderNumber: orders.orderNumber, agentId: orders.agentId, shopId: orders.shopId })
        .from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      if (!orderRow?.agentId) return;

      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, orderRow.shopId)).limit(1);
      const label = STATUS_LABELS[newStatus] ?? newStatus;
      const { sendPushToUser } = await import("../push-service");
      await sendPushToUser(orderRow.agentId, {
        title: `Заказ ${orderRow.orderNumber}`,
        body: `Статус изменён: ${label}${shop?.name ? ` (${shop.name})` : ""}`,
        data: { type: "order.status_changed", orderId },
      }).catch(() => {});
    } catch (e) {
      logger.warn("Status change notification failed", { error: String(e) });
    }
  },
};

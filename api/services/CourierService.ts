import { orders, shops, users, payments, notifications } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "../lib/sse";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface DeliveryRecord {
  id: number;
  orderNumber: string;
  status: string;
  deliveryStatus: string;
  total: string;
  shopName: string | null;
  shopAddress: string | null;
  shopCity: string | null;
  shopGpsLat: string | null;
  shopGpsLng: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export const CourierService = {
  async listDeliveries(db: Db, tenantId: number, courierId?: number) {
    const baseSelect = {
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      deliveryStatus: orders.deliveryStatus,
      total: orders.total,
      shopName: shops.name,
      shopAddress: shops.address,
      shopCity: shops.city,
      shopGpsLat: shops.gpsLat,
      shopGpsLng: shops.gpsLng,
      createdAt: orders.createdAt,
      deliveredAt: orders.deliveredAt,
    };

    if (courierId) {
      return db.select(baseSelect)
        .from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(
          eq(orders.tenantId, tenantId),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        ))
        .orderBy(desc(orders.createdAt))
        .limit(50);
    }

    return db.select(baseSelect)
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(
        eq(orders.tenantId, tenantId),
        eq(orders.deliveryStatus, "assigned"),
      ))
      .orderBy(desc(orders.createdAt))
      .limit(50);
  },

  async assignCourier(db: Db, tenantId: number, orderId: number, courierId: number) {
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1);
    if (!order) throw new Error("Заказ не найден");
    if (order.status !== "processing" && order.status !== "new") {
      throw new Error("Можно назначить курьера только на заказ в статусе 'новый' или 'в обработке'");
    }

    const [courier] = await db.select().from(users)
      .where(and(eq(users.id, courierId), eq(users.tenantId, tenantId), eq(users.role, "courier")))
      .limit(1);
    if (!courier) throw new Error("Курьер не найден");

    await db.update(orders)
      .set({ courierId, deliveryStatus: "assigned" })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

    const [shop] = await db.select({ name: shops.name }).from(shops)
      .where(eq(shops.id, order.shopId)).limit(1);

    await db.insert(notifications).values({
      tenantId,
      userId: courierId,
      type: "order",
      title: "Назначен заказ на доставку",
      message: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
    });

    sseBus.emit({
      type: "notification.new",
      tenantId,
      userId: courierId,
      data: { title: "Назначен заказ на доставку", orderNumber: order.orderNumber },
    });

    return { success: true };
  },

  async markOutForDelivery(db: Db, tenantId: number, orderId: number, courierId: number) {
    const [order] = await db.select().from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.tenantId, tenantId),
        eq(orders.courierId, courierId),
        eq(orders.deliveryStatus, "assigned"),
      )).limit(1);
    if (!order) throw new Error("Заказ не найден или не назначен на вас");

    await db.update(orders)
      .set({ deliveryStatus: "out_for_delivery" })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

    return { success: true };
  },

  async markDelivered(db: Db, tenantId: number, orderId: number, courierId: number, data?: { cashAmount?: string }) {
    const [order] = await db.select().from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.tenantId, tenantId),
        eq(orders.courierId, courierId),
        sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
      )).limit(1);
    if (!order) throw new Error("Заказ не найден или не назначен на вас");

    await db.transaction(async (tx) => {
      await tx.update(orders)
        .set({ deliveryStatus: "delivered", deliveredAt: new Date(), status: "completed" })
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

      if (data?.cashAmount && Number(data.cashAmount) > 0) {
        await tx.insert(payments).values({
          tenantId,
          shopId: order.shopId,
          amount: data.cashAmount,
          type: "payment",
          notes: `Доставка ${order.orderNumber} — наличные от курьера`,
          createdBy: courierId,
        });
      }
    });

    const [ceo] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "ceo")))
      .limit(1);

    if (ceo) {
      await db.insert(notifications).values({
        tenantId,
        userId: ceo.id,
        type: "order",
        title: "Заказ доставлен",
        message: `Заказ ${order.orderNumber} доставлен${data?.cashAmount ? `, наличные: ${data.cashAmount}` : ""}`,
      });

      sseBus.emit({
        type: "notification.new",
        tenantId,
        userId: ceo.id,
        data: { title: "Заказ доставлен", orderNumber: order.orderNumber },
      });
    }

    return { success: true };
  },
};

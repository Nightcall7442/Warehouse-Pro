import { z } from "zod";
import { createRouter, courierQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, shops, users, payments, notifications } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "./lib/sse";
import { logger } from "./lib/logger";

export const courierRouter = createRouter({
  listMyDeliveries: courierQuery.query(async ({ ctx }) => {
    const db = getDb();
    const courierId = ctx.user.role === "courier" ? ctx.user.id : undefined;

    if (!courierId) {
      return db.select({
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
      })
        .from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.deliveryStatus, "assigned"),
        ))
        .orderBy(desc(orders.createdAt))
        .limit(50);
    }

    return db.select({
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
    })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(
        eq(orders.tenantId, ctx.tenant.id),
        eq(orders.courierId, courierId),
        sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
      ))
      .orderBy(desc(orders.createdAt))
      .limit(50);
  }),

  assignCourier: operatorQuery
    .input(z.object({ orderId: z.number().int().positive(), courierId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [order] = await db.select().from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!order) throw new Error("Заказ не найден");
      if (order.status !== "processing" && order.status !== "new") {
        throw new Error("Можно назначить курьера только на заказ в статусе 'новый' или 'в обработке'");
      }

      const [courier] = await db.select().from(users)
        .where(and(eq(users.id, input.courierId), eq(users.tenantId, ctx.tenant.id), eq(users.role, "courier")))
        .limit(1);
      if (!courier) throw new Error("Курьер не найден");

      await db.update(orders)
        .set({ courierId: input.courierId, deliveryStatus: "assigned" })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      const [shop] = await db.select({ name: shops.name }).from(shops)
        .where(eq(shops.id, order.shopId)).limit(1);

      await db.insert(notifications).values({
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        type: "order",
        title: "Назначен заказ на доставку",
        message: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
      });

      sseBus.emit({
        type: "notification.new",
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        data: { title: "Назначен заказ на доставку", orderNumber: order.orderNumber },
      });

      logger.info("courier assigned", { orderId: input.orderId, courierId: input.courierId });

      return { success: true };
    }),

  markOutForDelivery: courierQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select().from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          eq(orders.deliveryStatus, "assigned"),
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      await db.update(orders)
        .set({ deliveryStatus: "out_for_delivery" })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      return { success: true };
    }),

  markDelivered: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      cashAmount: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select().from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      await db.transaction(async (tx) => {
        await tx.update(orders)
          .set({ deliveryStatus: "delivered", deliveredAt: new Date(), status: "completed" })
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        if (input.cashAmount && Number(input.cashAmount) > 0) {
          await tx.insert(payments).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            amount: input.cashAmount,
            type: "payment",
            notes: `Доставка ${order.orderNumber} — наличные от курьера`,
            createdBy: courierId,
          });
        }
      });

      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo")))
        .limit(1);

      if (ceo) {
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} доставлен${input.cashAmount ? `, наличные: ${input.cashAmount}` : ""}`,
        });

        sseBus.emit({
          type: "notification.new",
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          data: { title: "Заказ доставлен", orderNumber: order.orderNumber },
        });
      }

      logger.info("order delivered", { orderId: input.orderId, courierId, cashAmount: input.cashAmount });

      return { success: true };
    }),
});

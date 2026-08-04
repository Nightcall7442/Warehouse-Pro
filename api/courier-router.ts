import { z } from "zod";
import { createRouter, courierQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, shops, users, payments, notifications, orderItems, products, warehouseStock, warehouses, debtReminders } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "./lib/sse";
import { logger } from "./lib/logger";
import { sendPushToUser } from "./services/push-service";
import { sanitizeString } from "./lib/sanitize";

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
        totalWeightKg: sql<string>`COALESCE((
          SELECT SUM(CAST(oi.quantity AS DECIMAL) * CAST(COALESCE(p.unit_weight, '1') AS DECIMAL))
          FROM ${orderItems} oi
          LEFT JOIN ${products} p ON p.id = oi.product_id
          WHERE oi.order_id = ${orders.id}
        ), 0)`,
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
      totalWeightKg: sql<string>`COALESCE((
        SELECT SUM(CAST(oi.quantity AS DECIMAL) * CAST(COALESCE(p.unit_weight, '1') AS DECIMAL))
        FROM ${orderItems} oi
        LEFT JOIN ${products} p ON p.id = oi.product_id
        WHERE oi.order_id = ${orders.id}
      ), 0)`,
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

      const [order] = await db.select({ id: orders.id, status: orders.status, courierId: orders.courierId, shopId: orders.shopId, orderNumber: orders.orderNumber }).from(orders)
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

      // Send push notification to courier
      try {
        const { sendPushToUser } = await import("./services/push-service");
        await sendPushToUser(input.courierId, {
          title: "Назначен заказ на доставку",
          body: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
          data: { type: "delivery", orderId: input.orderId },
        });
      } catch { /* push is non-critical */ }

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

      const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId, status: orders.status, deliveryStatus: orders.deliveryStatus }).from(orders)
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
      cashAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Неверный формат суммы").optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId, status: orders.status, deliveryStatus: orders.deliveryStatus, total: orders.total }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      if (order.status === "delivered" || order.status === "cancelled") {
        throw new Error("Заказ уже завершён или отменён — повторное списание невозможно");
      }

      if (input.cashAmount && Number(input.cashAmount) > Number(order.total) * 1.2) {
        throw new Error("Сумма наличных превышает сумму заказа");
      }

      await db.transaction(async (tx) => {
        await tx.update(orders)
          .set({ deliveryStatus: "delivered", deliveredAt: new Date(), status: "delivered" })
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));
        // Get default warehouse for stock operations
        const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.tenantId, ctx.tenant.id), eq(warehouses.isDefault, true))).limit(1);
        const whId = defaultWh?.id;
        if (!whId) throw new Error("Склад по умолчанию не найден");

        // Lock stock rows with FOR UPDATE to prevent race conditions
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, whId)))
            .for("update");
        }
        // Now safely deduct stock — verify each deduction
        for (const item of items) {
          const qty = Number(item.quantity);
          const [result] = await tx.execute(sql`
            UPDATE warehouse_stock
            SET current_stock = current_stock - ${qty}, reserved = reserved - ${qty}
            WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
          `);
          // If no rows affected, stock row doesn't exist — log warning but continue
          if (result && typeof result === "object" && "affectedRows" in result && (result as Record<string, unknown>).affectedRows === 0) {
            console.warn(`[Stock] No stock row for product ${item.productId} in tenant ${ctx.tenant.id}`);
          }
        }

        if (input.cashAmount && Number(input.cashAmount) > 0) {
          const cashAmount = Number(input.cashAmount);
          await tx.insert(payments).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            amount: input.cashAmount,
            type: "payment",
            notes: `Доставка ${order.orderNumber} — наличные от курьера`,
            createdBy: courierId,
          });
          // Update shop debt: amount paid reduces the debt
          await tx.execute(sql`
            UPDATE shops
            SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) - ${cashAmount})
            WHERE id = ${order.shopId} AND tenant_id = ${ctx.tenant.id}
          `);
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

        // Push notification to CEO
        sendPushToUser(ceo.id, {
          title: "Заказ доставлен",
          body: `Заказ ${order.orderNumber} доставлен${input.cashAmount ? `, наличные: ${input.cashAmount}` : ""}`,
          data: { type: "order.delivered", orderId: input.orderId },
        }).catch(() => {});
      }

      logger.info("order delivered", { orderId: input.orderId, courierId, cashAmount: input.cashAmount });

      return { success: true };
    }),

  // ── Complete Delivery with payment/return status ────────────────────────────
  completeDelivery: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      result: z.enum(["paid", "partial_paid", "returned", "partial_returned"]),
      paidAmount: z.string().optional(),        // for paid/partial_paid
      paymentMethod: z.enum(["cash", "card", "transfer"]).default("cash"),
      debtDueDate: z.string().optional(),        // for partial_paid
      returnReason: z.string().max(200).optional(), // for returned/partial_returned
      returnedItems: z.array(z.object({          // for partial_returned
        itemId: z.number(),
        returnedQty: z.number(),
      })).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({
        id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId,
        status: orders.status, deliveryStatus: orders.deliveryStatus,
        total: orders.total, paymentMethod: orders.paymentMethod, agentId: orders.agentId,
      }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      const orderTotal = Number(order.total);
      const paidAmount = Number(input.paidAmount ?? 0);
      const debtAmount = orderTotal - paidAmount;

      await db.transaction(async (tx) => {
        // Get default warehouse
        const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.tenantId, ctx.tenant.id), eq(warehouses.isDefault, true))).limit(1);
        const whId = defaultWh?.id;
        if (!whId) throw new Error("Склад по умолчанию не найден");

        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));

        // ── Handle stock based on result ──
        if (input.result === "paid" || input.result === "partial_paid") {
          // Full or partial delivery — deduct stock for ALL items
          for (const item of items) {
            const qty = Number(item.quantity);
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET current_stock = current_stock - ${qty}, reserved = GREATEST(0, reserved - ${qty})
              WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
            `);
          }
        } else if (input.result === "returned") {
          // Full return — release reserved stock (no current_stock change since it was reserved)
          for (const item of items) {
            const qty = Number(item.quantity);
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET reserved = GREATEST(0, reserved - ${qty}), available = available + ${qty}
              WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
            `);
          }
        } else if (input.result === "partial_returned" && input.returnedItems) {
          // Partial return — deduct delivered qty, return undelivered qty
          const returnedMap = new Map(input.returnedItems.map(ri => [ri.itemId, ri.returnedQty]));
          for (const item of items) {
            const qty = Number(item.quantity);
            const returnedQty = returnedMap.get(item.id) ?? 0;
            const deliveredQty = qty - returnedQty;

            if (deliveredQty > 0) {
              // Deduct delivered stock; the returned portion of the reservation
              // goes back to available (goods physically returned to the warehouse).
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET current_stock = current_stock - ${deliveredQty},
                    reserved = GREATEST(0, reserved - ${qty}),
                    available = available + ${returnedQty}
                WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
              `);
            } else {
              // All returned — just release reservation
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET reserved = GREATEST(0, reserved - ${qty}), available = available + ${qty}
                WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
              `);
            }

            // Update delivered quantity on order item
            await tx.update(orderItems)
              .set({ deliveredQuantity: String(deliveredQty), returnReason: input.returnReason ?? null })
              .where(eq(orderItems.id, item.id));
          }
        }

        // ── Determine final order status ──
        let finalStatus: string;
        let deliveryResult = input.result;

        // Only a full return leaves the order undelivered. A partial return or a
        // partial payment still means goods were handed over, so the order is
        // "delivered" — what came back is recorded per line, and any unpaid
        // remainder lives on the payment row and the shop's debt.
        finalStatus = input.result === "returned" ? "returned" : "delivered";

        // ── Update order ──
        await tx.update(orders).set({
          status: finalStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
          deliveryStatus: "delivered",
          deliveredAt: new Date(),
          deliveryResult,
          deliveryNotes: input.notes ? sanitizeString(input.notes) : null,
        }).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        // ── Record payment ──
        if (paidAmount > 0) {
          await tx.insert(payments).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            orderId: order.id,
            amount: String(paidAmount),
            type: "payment",
            paymentMethod: input.paymentMethod,
            status: debtAmount > 0 ? "partially_paid" : "paid",
            totalOrderAmount: String(orderTotal),
            paidAmount: String(paidAmount),
            debtAmount: String(Math.max(0, debtAmount)),
            debtDueDate: input.debtDueDate ?? null,
            paidAt: new Date(),
            notes: input.notes ? sanitizeString(input.notes) : null,
            createdBy: courierId,
          });

          // Reduce shop debt by paid amount
          await tx.execute(sql`
            UPDATE shops SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) - ${paidAmount})
            WHERE id = ${order.shopId} AND tenant_id = ${ctx.tenant.id}
          `);
        }

        // ── Create debt reminder if partial payment ──
        if (debtAmount > 0 && input.debtDueDate) {
          await tx.insert(debtReminders).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            orderId: order.id,
            amount: String(debtAmount),
            dueDate: input.debtDueDate,
            status: "pending",
          });
        }
      });

      // ── Notifications ──
      const resultLabels: Record<string, string> = {
        paid: "100% оплачен",
        partial_paid: `частично оплачен (${paidAmount.toLocaleString("ru")} из ${orderTotal.toLocaleString("ru")})`,
        returned: "возврат",
        partial_returned: "частичный возврат",
      };

      // Notify agent
      if (order.agentId) {
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: order.agentId,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} — ${resultLabels[input.result]}`,
        });
        sendPushToUser(order.agentId, {
          title: "Заказ доставлен",
          body: `${order.orderNumber} — ${resultLabels[input.result]}`,
          data: { type: "order.delivered", orderId: input.orderId },
        }).catch(() => {});
      }

      // Notify CEO
      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo"))).limit(1);
      if (ceo) {
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} — ${resultLabels[input.result]}`,
        });
      }

      logger.info("delivery completed", { orderId: input.orderId, courierId, result: input.result, paidAmount });

      return { success: true, result: input.result, finalStatus };
    }),

  markFailed: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({ id: orders.id, status: orders.status, deliveryStatus: orders.deliveryStatus, orderNumber: orders.orderNumber }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      if (order.status === "delivered" || order.status === "cancelled") {
        throw new Error("Заказ уже завершён или отменён — повторное действие невозможно");
      }

      const safeReason = input.reason ? sanitizeString(input.reason) : "";

      await db.transaction(async (tx) => {
        // Update order status — keep deliveryStatus for history, but allow reassignment
        await tx.update(orders)
          .set({ deliveryStatus: "failed", status: "new", courierId: null })
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        // The reservation deliberately stays in place. The goods never left the
        // warehouse (current_stock is only touched on delivery) and the order goes
        // back to "new" for another delivery attempt, so it still owns them.
        // Releasing here made the same units sellable twice and drove `reserved`
        // negative once the retried delivery completed. Stock is returned only
        // when the order is cancelled or deleted.
      });

      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo")))
        .limit(1);

      if (ceo) {
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Доставка не состоялась",
          message: `Заказ ${order.orderNumber}${safeReason ? ` — ${safeReason}` : ""}`,
        });

        sseBus.emit({
          type: "notification.new",
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          data: { title: "Доставка не состоялась", orderNumber: order.orderNumber },
        });

        // Push notification to CEO
        sendPushToUser(ceo.id, {
          title: "Доставка не состоялась",
          body: `Заказ ${order.orderNumber}${safeReason ? ` — ${safeReason}` : ""}`,
          data: { type: "order.failed", orderId: input.orderId },
        }).catch(() => {});
      }

      logger.info("order delivery failed", { orderId: input.orderId, courierId, reason: input.reason });

      return { success: true };
    }),
});

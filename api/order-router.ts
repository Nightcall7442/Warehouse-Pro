import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery, adminQuery } from "./middleware";
import { OrderService } from "./services/order";
import { cache, CacheKeys } from "./lib/cache";
import { getDb } from "./queries/connection";
import { savedFilters, orderComments, shops, payments, users, orders } from "@db/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { sanitizeString } from "./lib/sanitize";

export const orderRouter = createRouter({
  // ── Server-side KPI stats (all orders, not just current page) ──────────────
  stats: fieldSalesQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      status: z.string().optional(),
      agentId: z.number().optional(),
      paymentMethod: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const conditions = [eq(orders.tenantId, tenantId), isNull(orders.deletedAt)];

      if (input?.status) conditions.push(eq(orders.status, input.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" | "partially_returned" | "partial_return_kept"));
      if (input?.agentId) conditions.push(eq(orders.agentId, input.agentId));
      if (input?.paymentMethod) conditions.push(eq(orders.paymentMethod, input.paymentMethod as "cash" | "card" | "transfer" | "debt"));
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo) conditions.push(sql`${orders.createdAt} <= ${input.dateTo + ' 23:59:59'}`);
      if (input?.search) {
        conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + input.search + '%'} OR ${shops.name} LIKE ${'%' + input.search + '%'})`);
      }

      const [result] = await db.select({
        total: sql<number>`count(*)`,
        totalRevenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
      }).from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions));

      // Get counts per status (WITH same filters as total)
      const statusCounts = await db.select({
        status: orders.status,
        count: sql<number>`count(*)`,
      }).from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions))
        .groupBy(orders.status);

      const statusMap: Record<string, number> = {};
      for (const row of statusCounts) {
        statusMap[row.status] = Number(row.count);
      }

      return {
        total: Number(result?.total ?? 0),
        totalRevenue: Number(result?.totalRevenue ?? 0),
        newCount: statusMap["new"] ?? 0,
        processingCount: statusMap["processing"] ?? 0,
        shippedCount: statusMap["shipped"] ?? 0,
        pendingCount: statusMap["pending"] ?? 0,
        deliveredCount: statusMap["delivered"] ?? 0,
        cancelledCount: statusMap["cancelled"] ?? 0,
        returnedCount: statusMap["returned"] ?? 0,
        partiallyReturnedCount: statusMap["partially_returned"] ?? 0,
        partialReturnKeptCount: statusMap["partial_return_kept"] ?? 0,
      };
    }),

  list: fieldSalesQuery
    .input(z.object({
      page:        z.number().int().min(1).default(1),
      pageSize:    z.number().int().min(1).max(5000).default(25),
      search:      z.string().max(200).optional(),
      status:      z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned", "partially_returned", "partial_return_kept"]).optional(),
      agentId:     z.number().int().positive().optional(),
      dateFrom:    z.string().optional(),
      dateTo:      z.string().optional(),
      showDeleted: z.boolean().optional(),
      paymentMethod: z.enum(["cash", "card", "transfer", "debt"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return OrderService.list(ctx.db, ctx.tenant.id, input ?? {}, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  getById: fieldSalesQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getById(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  myOrders: fieldSalesQuery.query(async ({ ctx }) => {
    return OrderService.myOrders(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  create: fieldSalesQuery
    .input(z.object({
      shopId:         z.number().int().positive(),
      agentId:        z.number().int().positive().optional(),
      warehouseId:    z.number().int().positive().optional(),
      idempotencyKey: z.string().uuid().optional(),
      items:          z.array(z.object({
        productId: z.number().int().positive(),
        quantity:  z.union([z.number(), z.string()]).transform(String).refine(v => Number(v) > 0, "Количество должно быть положительным"),
      })).min(1).max(100),
      notes:          z.string().max(500).optional(),
      discount:       z.union([z.number(), z.string()]).transform(String).default("0.00"),
      paymentMethod:  z.enum(["cash", "card", "transfer", "debt"]).default("cash"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await OrderService.create(ctx.db, ctx.tenant.id, ctx.user.id, input);
      } catch (err) {
        const cause = err instanceof Error ? err.cause : undefined;
        console.error("[order.create FAILED]", {
          message: err instanceof Error ? err.message : String(err),
          code: err && typeof err === "object" && "code" in err ? (err as Record<string, unknown>).code : undefined,
          errno: err && typeof err === "object" && "errno" in err ? (err as Record<string, unknown>).errno : undefined,
          sqlMessage: err && typeof err === "object" && "sqlMessage" in err ? (err as Record<string, unknown>).sqlMessage : undefined,
          causeCode: cause && typeof cause === "object" && "code" in cause ? (cause as Record<string, unknown>).code : undefined,
          causeErrno: cause && typeof cause === "object" && "errno" in cause ? (cause as Record<string, unknown>).errno : undefined,
          causeSqlMessage: cause && typeof cause === "object" && "sqlMessage" in cause ? (cause as Record<string, unknown>).sqlMessage : undefined,
          causeMessage: cause instanceof Error ? cause.message : String(cause),
          input: { shopId: input.shopId, itemCount: input.items.length, paymentMethod: input.paymentMethod },
        });
        throw err;
      }
    }),

  cancel: fieldSalesQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.cancel(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  updateStatus: operatorQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned", "partially_returned", "partial_return_kept"]) }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateStatus(ctx.db, ctx.tenant.id, input.id, input.status);
    }),

  update: operatorQuery
    .input(z.object({
      id: z.number().int().positive(),
      notes: z.string().max(500).optional(),
      discount: z.union([z.number(), z.string()]).transform(String).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      return OrderService.update(ctx.db, ctx.tenant.id, id, data);
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.delete(ctx.db, ctx.tenant.id, input.id);
    }),

  restore: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.restore(ctx.db, ctx.tenant.id, input.id);
    }),

  // ── Batch Print Invoices ────────────────────────────────────────────────────
  batchPrintInvoices: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1).max(50),
      format: z.enum(["a4", "a5", "thermal"]).default("a4"),
      options: z.object({
        includeQrCode: z.boolean().default(true),
        includeBarcodes: z.boolean().default(false),
        includeCostPrice: z.boolean().default(false),
        includeSignature: z.boolean().default(true),
        includeNotes: z.boolean().default(true),
        pageBreakPerOrder: z.boolean().default(true),
        sortBy: z.enum(["orderNumber", "shop", "agentRoute"]).default("orderNumber"),
      }).default({}),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await OrderService.batchGetOrdersForPrint(ctx.db, ctx.tenant.id, input.orderIds);
      // Mark invoices as printed
      await OrderService.markInvoicesPrinted(ctx.db, ctx.tenant.id, input.orderIds);
      // Audit log
      try {
        const { recordAudit } = await import("./services/audit-log");
        await recordAudit(ctx.db, {
          tenantId: ctx.tenant.id, actorId: ctx.user.id,
          action: "order.invoices_printed", targetType: "order",
          meta: { orderIds: input.orderIds, count: result.length },
        });
      } catch { /* non-blocking */ }
      return { orders: result, format: input.format, options: input.options };
    }),

  // ── Bulk Status Update ──────────────────────────────────────────────────────
  bulkUpdateStatus: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1).max(100),
      status: z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned", "partially_returned", "partial_return_kept"]),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.bulkUpdateStatus(
        ctx.db, ctx.tenant.id, input.orderIds, input.status,
        ctx.user.id, input.comment,
      );
    }),

  // ── Bulk Assign Agent ───────────────────────────────────────────────────────
  bulkAssignAgent: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1),
      agentId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.bulkAssignAgent(ctx.db, ctx.tenant.id, input.orderIds, input.agentId);
    }),

  // ── Loading Lists ──────────────────────────────────────────────────────────
  createLoadingList: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1),
      format: z.enum(["aggregated", "byOrder", "byRoute"]).default("aggregated"),
      warehouseId: z.number().int().positive().optional(),
      options: z.object({
        includeBarcodes: z.boolean().default(true),
        includeWeight: z.boolean().default(true),
        includeTotalWeight: z.boolean().default(true),
        includeRouteMap: z.boolean().default(false),
      }).default({}),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.createLoadingList(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  listLoadingLists: operatorQuery
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return OrderService.listLoadingLists(ctx.db, ctx.tenant.id, input ?? {});
    }),

  updateLoadingListStatus: operatorQuery
    .input(z.object({
      listId: z.number().int().positive(),
      status: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateLoadingListStatus(ctx.db, ctx.tenant.id, input.listId, input.status);
    }),

  // ── Saved Filters ──────────────────────────────────────────────────────────
  saveFilter: fieldSalesQuery
    .input(z.object({
      name: z.string().min(1).max(100),
      config: z.record(z.unknown()),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // If setting as default, unset other defaults for this user
      if (input.isDefault) {
        await db.update(savedFilters)
          .set({ isDefault: false })
          .where(and(eq(savedFilters.userId, ctx.user.id), eq(savedFilters.tenantId, ctx.tenant.id)));
      }
      const [result] = await db.insert(savedFilters).values({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        name: sanitizeString(input.name),
        filterConfig: input.config,
        isDefault: input.isDefault,
      });
      return { id: Number(result.insertId) };
    }),

  listFilters: fieldSalesQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({
      id: savedFilters.id,
      name: savedFilters.name,
      filterConfig: savedFilters.filterConfig,
      isDefault: savedFilters.isDefault,
      createdAt: savedFilters.createdAt,
    }).from(savedFilters)
      .where(and(eq(savedFilters.userId, ctx.user.id), eq(savedFilters.tenantId, ctx.tenant.id)))
      .orderBy(desc(savedFilters.createdAt));
  }),

  deleteFilter: fieldSalesQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(savedFilters)
        .where(and(eq(savedFilters.id, input.id), eq(savedFilters.userId, ctx.user.id)));
      return { success: true };
    }),

  // ── Order Comments ─────────────────────────────────────────────────────────
  addComment: fieldSalesQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      content: z.string().min(1).max(2000),
      parentId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(orderComments).values({
        tenantId: ctx.tenant.id,
        orderId: input.orderId,
        userId: ctx.user.id,
        content: sanitizeString(input.content),
        parentId: input.parentId ?? null,
      });
      return { id: Number(result.insertId) };
    }),

  listComments: fieldSalesQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const comments = await db.select({
        id: orderComments.id,
        orderId: orderComments.orderId,
        userId: orderComments.userId,
        content: orderComments.content,
        parentId: orderComments.parentId,
        createdAt: orderComments.createdAt,
        userName: users.name,
        userAvatar: users.avatar,
      }).from(orderComments)
        .leftJoin(users, eq(orderComments.userId, users.id))
        .where(and(eq(orderComments.orderId, input.orderId), eq(orderComments.tenantId, ctx.tenant.id)))
        .orderBy(orderComments.createdAt);

      // Build threaded structure
      const byId = new Map(comments.map(c => [c.id, { ...c, replies: [] as typeof comments }]));
      const roots: typeof comments = [];
      for (const c of comments) {
        const node = byId.get(c.id)!;
        if (c.parentId && byId.has(c.parentId)) {
          byId.get(c.parentId)!.replies.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    }),

  // ── Partial Payment ────────────────────────────────────────────────────────
  recordPartialPayment: fieldSalesQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      paidAmount: z.string().refine(v => Number(v) > 0, "Сумма должна быть положительной"),
      method: z.enum(["cash", "card", "transfer"]),
      debtDueDate: z.string().optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.recordPartialPayment(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  // ── Partial Delivery ───────────────────────────────────────────────────────
  recordPartialDelivery: fieldSalesQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      items: z.array(z.object({
        itemId: z.number().int().positive(),
        deliveredQuantity: z.number().min(0),
        returnReason: z.string().max(100).optional(),
      })).min(1),
      photos: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.recordPartialDelivery(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  // ── Combined Delivery + Payment ────────────────────────────────────────────
  recordDeliveryAndPayment: fieldSalesQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      deliveredItems: z.array(z.object({
        itemId: z.number().int().positive(),
        deliveredQuantity: z.number().min(0),
        returnReason: z.string().max(100).optional(),
      })).min(1),
      payment: z.object({
        paidAmount: z.string().refine(v => Number(v) >= 0, "Сумма не может быть отрицательной"),
        method: z.enum(["cash", "card", "transfer"]),
        debtDueDate: z.string().optional(),
        notes: z.string().max(500).optional(),
      }),
      photos: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.recordDeliveryAndPayment(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  // ── Get Adjustments ────────────────────────────────────────────────────────
  getAdjustments: fieldSalesQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getAdjustments(ctx.db, ctx.tenant.id, input.orderId);
    }),

  // ── Get Order Payments ─────────────────────────────────────────────────────
  getOrderPayments: fieldSalesQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getOrderPayments(ctx.db, ctx.tenant.id, input.orderId);
    }),
});

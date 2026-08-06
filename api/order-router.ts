import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery } from "./middleware";
import { OrderService } from "./services/order";
import { getDb } from "./queries/connection";
import { savedFilters, orderComments, shops, payments, users, orders } from "@db/schema";
import { eq, and, or, desc, sql, isNull, inArray } from "drizzle-orm";
import { sanitizeString } from "./lib/sanitize";
import { OPEN_ORDER_STATUSES, CLOSED_ORDER_STATUSES } from "./lib/order-status";

export const orderRouter = createRouter({
  // ── Server-side KPI stats (all orders, not just current page) ──────────────
  stats: fieldSalesQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      status: z.string().optional(),
      agentId: z.number().optional(),
      agentIds: z.array(z.number().int().positive()).max(200).optional(),
      paymentMethod: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const conditions = [eq(orders.tenantId, tenantId), isNull(orders.deletedAt)];

      if (input?.status) conditions.push(eq(orders.status, input.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned"));
      if (input?.agentIds?.length) conditions.push(inArray(orders.agentId, input.agentIds));
      else if (input?.agentId) conditions.push(eq(orders.agentId, input.agentId));
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
      };
    }),

  /**
   * One row per agent for the Orders page's "by agent" view.
   *
   * An operator's actual job here is triage: they want to see, at a glance,
   * which agent has work waiting on them and how much money is tied up in it,
   * then open that agent and act on the whole batch. So this returns the same
   * numbers the summary row shows — not a generic group-by that the client
   * would then have to add up itself.
   *
   * `openCount` is the one that matters operationally: orders still in play
   * (new/processing/shipped/pending) are what an operator can still act on.
   * `debt` is what those orders have not been paid for, computed the same way
   * shop debt is — total minus payments booked against that order — so the
   * figure agrees with what the shop's balance says.
   *
   * Agents with no orders in the window are included with zeroes rather than
   * omitted: "this agent brought in nothing today" is exactly the thing a
   * supervisor is looking for, and dropping the row hides it.
   *
   * The row set is "every active agent, plus anyone else who actually placed
   * an order in this window". Restricting it to role='agent' alone would
   * silently drop orders an operator or CEO entered directly — they'd be
   * counted in the page's totals but findable in no group, which is worse
   * than an extra row.
   */
  agentSummary: operatorQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      archived: z.boolean().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const conditions = [eq(orders.tenantId, tenantId), isNull(orders.deletedAt)];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);
      if (input?.archived !== undefined) {
        conditions.push(input.archived
          ? inArray(orders.status, CLOSED_ORDER_STATUSES)
          : inArray(orders.status, OPEN_ORDER_STATUSES));
      }
      if (input?.search) {
        // The shop name lives on a table joined *after* orders below, and a
        // JOIN condition cannot reference a table that hasn't been joined yet
        // — written as `${shops.name} LIKE ...` here it produced "Unknown
        // column 'shops.name' in 'on clause'" and the whole endpoint failed
        // (silently, since the agent filter just rendered empty) the moment
        // anyone typed in the Orders search box. A correlated subquery gets
        // at the shop without depending on join order.
        const term = `%${input.search}%`;
        conditions.push(sql`(${orders.orderNumber} LIKE ${term} OR EXISTS (
          SELECT 1 FROM ${shops} s2 WHERE s2.id = ${orders.shopId} AND s2.name LIKE ${term}
        ))`);
      }

      const rows = await db.select({
        agentId:   users.id,
        agentName: users.name,
        orderCount: sql<number>`COUNT(${orders.id})`,
        totalValue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(15,2))), 0)`,
        openCount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN ('new','processing','shipped','pending') THEN 1 ELSE 0 END), 0)`,
        deliveredCount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN 1 ELSE 0 END), 0)`,
        // Unpaid balance on this agent's orders, mirroring recalcShopDebt's
        // per-order rule: a credit order owes from creation, anything else once
        // it reached delivered, in both cases net of payments against it.
        debt: sql<string>`COALESCE(SUM(
          CASE
            WHEN ${orders.status} IN ('cancelled','returned') THEN 0
            WHEN ${orders.paymentMethod} = 'debt' OR ${orders.status} = 'delivered'
              THEN GREATEST(0, CAST(${orders.total} AS DECIMAL(15,2)) - COALESCE((
                SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM ${payments} p
                WHERE p.order_id = ${orders.id} AND p.type = 'payment'
              ), 0))
            ELSE 0
          END
        ), 0)`,
        lastOrderAt: sql<string | null>`MAX(${orders.createdAt})`,
      })
        .from(users)
        // LEFT so an agent with nothing in this window still gets a row.
        .leftJoin(orders, and(eq(orders.agentId, users.id), ...conditions))
        .where(and(
          eq(users.tenantId, tenantId),
          or(
            and(eq(users.role, "agent"), eq(users.status, "active")),
            // Anyone who actually has an order in this window, whatever their
            // role or current status — a deactivated agent's orders still need
            // a home.
            sql`EXISTS (SELECT 1 FROM ${orders} o2 WHERE o2.agent_id = ${users.id} AND o2.tenant_id = ${tenantId} AND o2.deleted_at IS NULL)`,
          )!,
        ))
        .groupBy(users.id, users.name)
        .orderBy(desc(sql`COUNT(${orders.id})`));

      return rows.map(r => ({
        ...r,
        orderCount: Number(r.orderCount),
        openCount: Number(r.openCount),
        deliveredCount: Number(r.deliveredCount),
      }));
    }),

  list: fieldSalesQuery
    .input(z.object({
      page:        z.number().int().min(1).default(1),
      pageSize:    z.number().int().min(1).max(5000).default(25),
      search:      z.string().max(200).optional(),
      status:      z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned"]).optional(),
      archived:    z.boolean().optional(),
      agentId:     z.number().int().positive().optional(),
      // Plural form for the toolbar filter, which compares several agents at
      // once. Capped so a crafted request can't turn the IN list into a way to
      // make the database chew through an unbounded set.
      agentIds:    z.array(z.number().int().positive()).max(200).optional(),
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
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned"]) }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateStatus(ctx.db, ctx.tenant.id, input.id, input.status);
    }),

  update: operatorQuery
    .input(z.object({
      id: z.number().int().positive(),
      notes: z.string().max(500).optional(),
      discount: z.union([z.number(), z.string()]).transform(String).optional(),
      paymentMethod: z.enum(["cash", "card", "transfer", "debt"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      return OrderService.update(ctx.db, ctx.tenant.id, id, data);
    }),

  updateItems: operatorQuery
    .input(z.object({
      id: z.number().int().positive(),
      items: z.array(z.object({
        // Existing line: pass itemId. New line: pass productId instead.
        itemId: z.number().int().positive().optional(),
        productId: z.number().int().positive().optional(),
        quantity: z.number().min(0),
        unitPrice: z.union([z.number(), z.string()]).transform(String).optional(),
      }).refine(i => i.itemId !== undefined || i.productId !== undefined, "Нужен itemId или productId"))
        .min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateItems(ctx.db, ctx.tenant.id, input.id, { items: input.items });
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
        // `prefault`, not `default`: zod 4's `default` hands the literal `{}`
        // straight back without running the schema, so an omitted `options`
        // arrived with every flag undefined instead of the defaults above.
      }).prefault({}),
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
      status: z.enum(["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned"]),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.bulkUpdateStatus(
        ctx.db, ctx.tenant.id, input.orderIds, input.status,
        ctx.user.id, input.comment,
      );
    }),

  // ── Bulk Complete + Full Payment ────────────────────────────────────────────
  bulkCompleteWithPayment: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.bulkCompleteWithPayment(ctx.db, ctx.tenant.id, ctx.user.id, input.orderIds);
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

  bulkAssignCourier: operatorQuery
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1),
      courierId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // Verify courier exists and belongs to tenant
      const [courier] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.courierId), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (!courier) throw new Error("Курьер не найден");

      await db.update(orders)
        .set({ courierId: input.courierId, deliveryStatus: "assigned" })
        .where(and(eq(orders.tenantId, ctx.tenant.id), inArray(orders.id, input.orderIds)));

      return { updated: input.orderIds.length };
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
      }).prefault({}),
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
      config: z.record(z.string(), z.unknown()),
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

import { z } from "zod";
import { createRouter, operatorQuery, agentQuery } from "./middleware";
import { OrderService } from "./services/order";
import { getDb } from "./queries/connection";
import { orders } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";

export const orderRouter = createRouter({
  stats: agentQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.tenant.id;
    const [row] = await db.select({
      total:        sql<number>`count(*)`,
      newCount:     sql<number>`count(CASE WHEN ${orders.status} = 'new' THEN 1 END)`,
      processingCount: sql<number>`count(CASE WHEN ${orders.status} = 'processing' THEN 1 END)`,
      completedCount:  sql<number>`count(CASE WHEN ${orders.status} = 'completed' THEN 1 END)`,
      cancelledCount:  sql<number>`count(CASE WHEN ${orders.status} = 'cancelled' THEN 1 END)`,
      totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
    }).from(orders).where(eq(orders.tenantId, tenantId));
    return {
      total:            Number(row?.total ?? 0),
      newCount:         Number(row?.newCount ?? 0),
      processingCount:  Number(row?.processingCount ?? 0),
      completedCount:   Number(row?.completedCount ?? 0),
      cancelledCount:   Number(row?.cancelledCount ?? 0),
      totalRevenue:     Number(row?.totalRevenue ?? 0),
    };
  }),

  list: agentQuery
    .input(z.object({
      page:          z.number().int().min(1).default(1),
      pageSize:      z.number().int().min(1).max(1000).default(25),
      search:        z.string().max(200).optional(),
      status:        z.enum(["new", "processing", "completed", "cancelled"]).optional(),
      paymentMethod: z.enum(["cash", "transfer", "debt", "card"]).optional(),
      agentId:       z.number().int().positive().optional(),
      dateFrom:      z.string().optional(),
      dateTo:        z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return OrderService.list(ctx.db, ctx.tenant.id, input ?? {}, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  getById: agentQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getById(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  myOrders: agentQuery.query(async ({ ctx }) => {
    return OrderService.myOrders(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  create: agentQuery
    .input(z.object({
      shopId:         z.number().int().positive(),
      agentId:        z.number().int().positive().optional(),
      idempotencyKey: z.string().uuid().optional(),
      items:          z.array(z.object({
        productId: z.number().int().positive(),
        quantity:  z.union([z.number(), z.string()]).transform(String),
      })).min(1).max(100),
      notes:         z.string().max(500).optional(),
      discount:      z.union([z.number(), z.string()]).transform(String).default("0.00"),
      paymentMethod: z.enum(["cash", "transfer", "debt", "card"]).default("cash"),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.create(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  cancel: agentQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.cancel(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  updateStatus: operatorQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "processing", "completed", "cancelled"]) }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateStatus(ctx.db, ctx.tenant.id, input.id, input.status);
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.delete(ctx.db, ctx.tenant.id, input.id);
    }),
});

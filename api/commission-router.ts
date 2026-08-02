import { z } from "zod";
import { createRouter, operatorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { commissions, users } from "@db/schema";
import { eq, and, gte, lte, desc, isNull , inArray } from "drizzle-orm";
import { cache, CacheKeys } from "./lib/cache";

export const commissionRouter = createRouter({
  // List commissions for a period
  list: authedQuery
    .input(z.object({
      periodType: z.enum(["monthly", "quarterly"]).optional(),
      userId: z.number().optional(),
      status: z.enum(["pending", "approved", "paid"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(commissions.tenantId, ctx.tenant.id)];

      if (input?.periodType) conditions.push(eq(commissions.periodType, input.periodType));
      if (input?.userId) conditions.push(eq(commissions.userId, input.userId));
      if (input?.status) conditions.push(eq(commissions.status, input.status));

      return db.select({
        id: commissions.id,
        userId: commissions.userId,
        userName: users.name,
        commissionRate: commissions.commissionRate,
        periodType: commissions.periodType,
        periodStart: commissions.periodStart,
        periodEnd: commissions.periodEnd,
        salesAmount: commissions.salesAmount,
        commissionAmount: commissions.commissionAmount,
        status: commissions.status,
      }).from(commissions)
        .leftJoin(users, eq(commissions.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(commissions.periodStart));
    }),

  // Set commission rate for a user
  setRate: operatorQuery
    .input(z.object({
      userId: z.number(),
      commissionRate: z.number().min(0).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Update or create monthly commission record for current period
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

      const [existing] = await db.select()
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.userId, input.userId),
          eq(commissions.periodType, "monthly"),
          eq(commissions.periodStart, monthStart),
        )).limit(1);

      if (existing) {
        await db.update(commissions)
          .set({ commissionRate: input.commissionRate.toFixed(2) })
          .where(eq(commissions.id, existing.id));
      } else {
        await db.insert(commissions).values({
          tenantId: ctx.tenant.id,
          userId: input.userId,
          commissionRate: input.commissionRate.toFixed(2),
          periodType: "monthly",
          periodStart: monthStart,
          periodEnd: monthEnd,
          salesAmount: "0.00",
          commissionAmount: "0.00",
        });
      }

      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));
      return { success: true };
    }),

  // Calculate commissions for a period
  calculate: operatorQuery
    .input(z.object({
      periodType: z.enum(["monthly", "quarterly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const agentCommissions = await db.select()
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.periodType, input.periodType),
          gte(commissions.periodStart, input.periodStart),
          lte(commissions.periodEnd, input.periodEnd),
        ));

      const { orders, returns } = await import("@db/schema");
      const { sql: sqlFn } = await import("drizzle-orm");
      const periodEndDate = new Date(input.periodEnd + "T23:59:59");

      const results = await Promise.all(
        agentCommissions.map(async (agent) => {
          const [orderResult] = await db.select({
            total: sqlFn<string>`COALESCE(SUM(${orders.total}), 0)`,
          }).from(orders).where(and(
            eq(orders.tenantId, ctx.tenant.id),
            eq(orders.agentId, agent.userId),
            inArray(orders.status, ["delivered", "completed"]),
            isNull(orders.deletedAt),
            gte(orders.createdAt, agent.periodStart),
            lte(orders.createdAt, periodEndDate),
          ));

          const [returnResult] = await db.select({
            total: sqlFn<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
          }).from(returns)
            .innerJoin(orders, eq(returns.orderId, orders.id))
            .where(and(
              eq(returns.tenantId, ctx.tenant.id),
              eq(orders.agentId, agent.userId),
              eq(returns.status, "completed"),
              isNull(orders.deletedAt),
              gte(orders.createdAt, agent.periodStart),
              lte(orders.createdAt, periodEndDate),
            ));

          const salesAmount = Math.max(0, Number(orderResult.total) - Number(returnResult.total));
          const commissionAmount = salesAmount * (Number(agent.commissionRate) / 100);

          await db.update(commissions)
            .set({
              salesAmount: salesAmount.toFixed(2),
              commissionAmount: commissionAmount.toFixed(2),
            })
            .where(eq(commissions.id, agent.id));

          return agent.id;
        })
      );

      return { success: true, updated: results.length };
    }),

  // Approve/paid commission
  updateStatus: operatorQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "approved", "paid"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(commissions)
        .set({ status: input.status })
        .where(and(eq(commissions.id, input.id), eq(commissions.tenantId, ctx.tenant.id)));
      return { success: true };
    }),
});

import { z } from "zod";
import { createRouter, operatorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { salesTargets, commissions, users, orders, orderItems, products } from "@db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

export const salesTargetRouter = createRouter({
  // List sales targets for a period
  list: authedQuery
    .input(z.object({
      periodType: z.enum(["daily", "weekly", "monthly"]).optional(),
      userId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(salesTargets.tenantId, ctx.tenant.id)];

      if (input?.periodType) conditions.push(eq(salesTargets.periodType, input.periodType));
      if (input?.userId) conditions.push(eq(salesTargets.userId, input.userId));
      if (input?.dateFrom) conditions.push(gte(salesTargets.periodStart, input.dateFrom));
      if (input?.dateTo) conditions.push(lte(salesTargets.periodEnd, input.dateTo));

      return db.select({
        id: salesTargets.id,
        userId: salesTargets.userId,
        userName: users.name,
        shopId: salesTargets.shopId,
        periodType: salesTargets.periodType,
        periodStart: salesTargets.periodStart,
        periodEnd: salesTargets.periodEnd,
        targetAmount: salesTargets.targetAmount,
        actualAmount: salesTargets.actualAmount,
        notes: salesTargets.notes,
      }).from(salesTargets)
        .leftJoin(users, eq(salesTargets.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(salesTargets.periodStart));
    }),

  // Create or update sales target
  upsert: operatorQuery
    .input(z.object({
      id: z.number().optional(),
      userId: z.number(),
      shopId: z.number().optional(),
      periodType: z.enum(["daily", "weekly", "monthly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
      targetAmount: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      if (input.id) {
        await db.update(salesTargets)
          .set({
            targetAmount: input.targetAmount.toFixed(2),
            notes: input.notes,
          })
          .where(and(eq(salesTargets.id, input.id), eq(salesTargets.tenantId, ctx.tenant.id)));
        return { success: true, id: input.id };
      }

      const [result] = await db.insert(salesTargets).values({
        tenantId: ctx.tenant.id,
        userId: input.userId,
        shopId: input.shopId ?? null,
        periodType: input.periodType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        targetAmount: input.targetAmount.toFixed(2),
        notes: input.notes,
      });

      return { success: true, id: Number(result.insertId) };
    }),

  // Recalculate actual amounts from orders
  recalculateActuals: operatorQuery
    .input(z.object({
      periodType: z.enum(["daily", "weekly", "monthly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Get all targets for this period
      const targets = await db.select()
        .from(salesTargets)
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.periodType, input.periodType),
          gte(salesTargets.periodStart, input.periodStart),
          lte(salesTargets.periodEnd, input.periodEnd),
        ));

      // For each target, calculate actual sales
      for (const target of targets) {
        const conditions = [
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.agentId, target.userId),
          gte(orders.createdAt, target.periodStart),
          lte(orders.createdAt, target.periodEnd + "T23:59:59"),
        ];

        if (target.shopId) {
          conditions.push(eq(orders.shopId, target.shopId));
        }

        const [result] = await db.select({
          total: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        }).from(orders).where(and(...conditions));

        await db.update(salesTargets)
          .set({ actualAmount: result.total })
          .where(eq(salesTargets.id, target.id));
      }

      return { success: true, updated: targets.length };
    }),

  // Get sales target summary for dashboard
  summary: authedQuery
    .query(async ({ ctx }) => {
      const db = getDb();
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

      const targets = await db.select({
        userId: salesTargets.userId,
        userName: users.name,
        targetAmount: salesTargets.targetAmount,
        actualAmount: salesTargets.actualAmount,
      }).from(salesTargets)
        .leftJoin(users, eq(salesTargets.userId, users.id))
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.periodType, "monthly"),
          gte(salesTargets.periodStart, monthStart),
          lte(salesTargets.periodEnd, monthEnd),
        ));

      return targets.map(t => ({
        ...t,
        completion: Number(t.targetAmount) > 0
          ? Math.round((Number(t.actualAmount) / Number(t.targetAmount)) * 100)
          : 0,
      }));
    }),
});

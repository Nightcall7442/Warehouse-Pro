import { z } from "zod";
import { createRouter, operatorQuery, authedQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { salesTargets, users, orders, dailyPlans } from "@db/schema";
import { eq, and, gte, lte, sql, desc , inArray } from "drizzle-orm";
import { cache, CacheKeys } from "./lib/cache";
import { suggestQuotas } from "./services/quota-suggest";

export const salesTargetRouter = createRouter({
  // List sales targets for a period
  list: authedQuery
    .input(z.object({
      periodType: z.enum(["daily", "weekly", "monthly"]).optional(),
      userId: z.number().optional(),
      territoryId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(salesTargets.tenantId, ctx.tenant.id)];

      if (input?.periodType) conditions.push(eq(salesTargets.periodType, input.periodType));
      if (input?.userId) conditions.push(eq(salesTargets.userId, input.userId));
      if (input?.territoryId) conditions.push(eq(salesTargets.territoryId, input.territoryId));
      if (input?.dateFrom) conditions.push(gte(salesTargets.periodStart, input.dateFrom));
      if (input?.dateTo) conditions.push(lte(salesTargets.periodEnd, input.dateTo));

      return db.select({
        id: salesTargets.id,
        userId: salesTargets.userId,
        userName: users.name,
        shopId: salesTargets.shopId,
        territoryId: salesTargets.territoryId,
        periodType: salesTargets.periodType,
        periodStart: salesTargets.periodStart,
        periodEnd: salesTargets.periodEnd,
        targetAmount: salesTargets.targetAmount,
        actualAmount: salesTargets.actualAmount,
        orderCountTarget: salesTargets.orderCountTarget,
        visitTarget: salesTargets.visitTarget,
        actualOrderCount: salesTargets.actualOrderCount,
        actualVisitPct: salesTargets.actualVisitPct,
        notes: salesTargets.notes,
      }).from(salesTargets)
        .leftJoin(users, eq(salesTargets.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(salesTargets.periodStart));
    }),

  // Create or update sales target
  upsert: supervisorQuery
    .input(z.object({
      id: z.number().optional(),
      userId: z.number(),
      shopId: z.number().optional(),
      territoryId: z.number().optional(),
      periodType: z.enum(["daily", "weekly", "monthly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
      targetAmount: z.number(),
      orderCountTarget: z.number().optional(),
      visitTarget: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      if (input.id) {
        await db.update(salesTargets)
          .set({
            targetAmount: input.targetAmount.toFixed(2),
            orderCountTarget: input.orderCountTarget ?? null,
            visitTarget: input.visitTarget != null ? String(input.visitTarget) : null,
            notes: input.notes,
          })
          .where(and(eq(salesTargets.id, input.id), eq(salesTargets.tenantId, ctx.tenant.id)));
        cache.invalidate(CacheKeys.salesTargets(ctx.tenant.id));
        return { success: true, id: input.id };
      }

      const [result] = await db.insert(salesTargets).values({
        tenantId: ctx.tenant.id,
        userId: input.userId,
        shopId: input.shopId ?? null,
        territoryId: input.territoryId ?? null,
        periodType: input.periodType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        targetAmount: input.targetAmount.toFixed(2),
        orderCountTarget: input.orderCountTarget ?? null,
        visitTarget: input.visitTarget != null ? String(input.visitTarget) : null,
        notes: input.notes,
      });

      cache.invalidate(CacheKeys.salesTargets(ctx.tenant.id));
      return { success: true, id: Number(result.insertId) };
    }),

  // Bulk create/update targets (supervisor applies suggestions)
  bulkUpsert: supervisorQuery
    .input(z.object({
      periodStart: z.string(),
      periodEnd: z.string(),
      targets: z.array(z.object({
        userId: z.number(),
        targetAmount: z.number(),
        orderCountTarget: z.number().optional(),
        visitTarget: z.number().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      let created = 0;
      let updated = 0;

      for (const t of input.targets) {
        const [existing] = await db.select({ id: salesTargets.id })
          .from(salesTargets)
          .where(and(
            eq(salesTargets.tenantId, ctx.tenant.id),
            eq(salesTargets.userId, t.userId),
            eq(salesTargets.periodType, "monthly"),
            eq(salesTargets.periodStart, input.periodStart),
          ))
          .limit(1);

        if (existing) {
          await db.update(salesTargets)
            .set({
              targetAmount: t.targetAmount.toFixed(2),
              orderCountTarget: t.orderCountTarget ?? null,
              visitTarget: t.visitTarget != null ? String(t.visitTarget) : null,
            })
            .where(eq(salesTargets.id, existing.id));
          updated++;
        } else {
          await db.insert(salesTargets).values({
            tenantId: ctx.tenant.id,
            userId: t.userId,
            periodType: "monthly",
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            targetAmount: t.targetAmount.toFixed(2),
            orderCountTarget: t.orderCountTarget ?? null,
            visitTarget: t.visitTarget != null ? String(t.visitTarget) : null,
          });
          created++;
        }
      }

      cache.invalidate(CacheKeys.salesTargets(ctx.tenant.id));
      return { success: true, created, updated };
    }),

  // Recalculate actual amounts from orders + visits
  recalculateActuals: operatorQuery
    .input(z.object({
      periodType: z.enum(["daily", "weekly", "monthly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const targets = await db.select()
        .from(salesTargets)
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.periodType, input.periodType),
          gte(salesTargets.periodStart, input.periodStart),
          lte(salesTargets.periodEnd, input.periodEnd),
        ));

      for (const target of targets) {
        const conditions = [
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.agentId, target.userId),
          inArray(orders.status, ["delivered", "completed"]),
          gte(orders.createdAt, target.periodStart),
          lte(orders.createdAt, target.periodEnd + " 23:59:59"),
        ];
        if (target.shopId) conditions.push(eq(orders.shopId, target.shopId));

        // Revenue + order count
        const [orderStats] = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,2))), 0)`,
          count: sql<string>`COUNT(*)`,
        }).from(orders).where(and(...conditions));

        // Visit completion %
        const [visitStats] = await db.select({
          total: sql<string>`COUNT(*)`,
          completed: sql<string>`SUM(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 ELSE 0 END)`,
        }).from(dailyPlans).where(and(
          eq(dailyPlans.tenantId, ctx.tenant.id),
          eq(dailyPlans.userId, target.userId),
          gte(dailyPlans.date, target.periodStart),
          lte(dailyPlans.date, target.periodEnd),
        ));

        const visitPct = Number(visitStats.total) > 0
          ? (Number(visitStats.completed) / Number(visitStats.total)) * 100
          : 0;

        await db.update(salesTargets)
          .set({
            actualAmount: orderStats.total,
            actualOrderCount: Number(orderStats.count),
            actualVisitPct: visitPct.toFixed(2),
          })
          .where(eq(salesTargets.id, target.id));
      }

      return { success: true, updated: targets.length };
    }),

  // Auto-suggest quotas from 3-month history
  autoSuggest: operatorQuery
    .input(z.object({ targetMonth: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      return suggestQuotas(db, ctx.tenant.id, input.targetMonth);
    }),

  // Agent's own quota for current month
  myQuota: authedQuery
    .input(z.object({ month: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const now = input?.month ? new Date(input.month) : new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

      const [target] = await db.select({
        targetAmount: salesTargets.targetAmount,
        actualAmount: salesTargets.actualAmount,
        orderCountTarget: salesTargets.orderCountTarget,
        actualOrderCount: salesTargets.actualOrderCount,
        visitTarget: salesTargets.visitTarget,
        actualVisitPct: salesTargets.actualVisitPct,
      }).from(salesTargets)
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.userId, ctx.user.id),
          eq(salesTargets.periodType, "monthly"),
          eq(salesTargets.periodStart, monthStart),
        ))
        .limit(1);

      if (!target) return null;

      const revenueTarget = Number(target.targetAmount);
      const revenueActual = Number(target.actualAmount);
      const orderTarget = target.orderCountTarget ?? 0;
      const orderActual = target.actualOrderCount;
      const visitTgt = target.visitTarget ? Number(target.visitTarget) : 0;
      const visitAct = Number(target.actualVisitPct);

      return {
        revenue: {
          target: revenueTarget,
          actual: revenueActual,
          pct: revenueTarget > 0 ? Math.min(100, Math.round((revenueActual / revenueTarget) * 100)) : 0,
        },
        orders: {
          target: orderTarget,
          actual: orderActual,
          pct: orderTarget > 0 ? Math.min(100, Math.round((orderActual / orderTarget) * 100)) : 0,
        },
        visits: {
          target: visitTgt,
          actual: visitAct,
          pct: visitTgt > 0 ? Math.min(100, Math.round(visitAct)) : 0,
        },
        month: monthStart,
      };
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
        orderCountTarget: salesTargets.orderCountTarget,
        actualOrderCount: salesTargets.actualOrderCount,
        visitTarget: salesTargets.visitTarget,
        actualVisitPct: salesTargets.actualVisitPct,
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
        revenueCompletion: Number(t.targetAmount) > 0
          ? Math.round((Number(t.actualAmount) / Number(t.targetAmount)) * 100)
          : 0,
        orderCompletion: t.orderCountTarget && Number(t.orderCountTarget) > 0
          ? Math.round((Number(t.actualOrderCount) / Number(t.orderCountTarget)) * 100)
          : null,
        visitCompletion: t.visitTarget && Number(t.visitTarget) > 0
          ? Number(t.actualVisitPct)
          : null,
      }));
    }),
});

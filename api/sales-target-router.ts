import { z } from "zod";
import { createRouter, operatorQuery, authedQuery, supervisorQuery, managementQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { salesTargets, users, orders, dailyPlans } from "@db/schema";
import { eq, and, gte, lte, sql, desc, inArray, type SQL } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "./lib/order-status";
import { cache, CacheKeys } from "./lib/cache";
import { suggestQuotas } from "./services/quota-suggest";

export const salesTargetRouter = createRouter({
  // List sales targets for a period
  // Everyone's targets and everyone's progress against them. The mobile app
  // already shows this tab to supervisors only — that was a hidden button, not
  // a closed door, and the procedure answered anyone who asked. myQuota below
  // stays open to all: it returns the caller's own plan and nobody else's.
  list: managementQuery
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
      if (input?.dateFrom) conditions.push(sql`${salesTargets.periodStart} >= ${input.dateFrom}`);
      if (input?.dateTo) conditions.push(sql`${salesTargets.periodEnd} <= ${input.dateTo}`);

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
        // period_start/period_end are DATE columns, which drizzle types as Date
        // — but the period is keyed by the "YYYY-MM-DD" string every lookup
        // here compares against, and a Date param would be rendered in the
        // server's local zone and could land on the neighbouring day.
        periodStart: sql`${input.periodStart}`,
        periodEnd: sql`${input.periodEnd}`,
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
            sql`${salesTargets.periodStart} = ${input.periodStart}`,
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
            periodStart: sql`${input.periodStart}`,
            periodEnd: sql`${input.periodEnd}`,
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
          sql`${salesTargets.periodStart} >= ${input.periodStart}`,
          sql`${salesTargets.periodEnd} <= ${input.periodEnd}`,
        ));

      for (const target of targets) {
        // periodEnd arrives from a DATE column as a Date at midnight, so the
        // upper bound has to be moved to the end of that day — otherwise the
        // whole of the target's last day falls outside the range.
        const periodEndOfDay = new Date(target.periodEnd);
        periodEndOfDay.setHours(23, 59, 59, 999);

        const conditions = [
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.agentId, target.userId),
          inArray(orders.status, REVENUE_ORDER_STATUSES),
          gte(orders.createdAt, target.periodStart),
          lte(orders.createdAt, periodEndOfDay),
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
          eq(dailyPlans.agentId, target.userId),
          gte(dailyPlans.planDate, target.periodStart),
          lte(dailyPlans.planDate, target.periodEnd),
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
        shopId: salesTargets.shopId,
        periodEnd: salesTargets.periodEnd,
        targetAmount: salesTargets.targetAmount,
        orderCountTarget: salesTargets.orderCountTarget,
        visitTarget: salesTargets.visitTarget,
      }).from(salesTargets)
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.userId, ctx.user.id),
          eq(salesTargets.periodType, "monthly"),
          sql`${salesTargets.periodStart} = ${monthStart}`,
        ))
        .limit(1);

      if (!target) return null;

      // Progress is computed here rather than read from the stored actual_*
      // columns. Those are only ever filled in by recalculateActuals, which an
      // operator has to trigger by hand — so an agent opening their own plan
      // would be shown whatever was last computed, quite possibly zero, which
      // is worse than showing nothing. The stored columns still serve the
      // operator-facing list views, where one query covers every agent.
      const periodEnd = target.periodEnd ?? monthEnd;
      // periodEnd arrives from a DATE column as a Date at midnight, so the upper
      // bound has to be moved to the end of that day — otherwise every order
      // placed on the last day of the plan falls outside the range.
      const periodEndOfDay = new Date(periodEnd);
      periodEndOfDay.setHours(23, 59, 59, 999);
      // Dates are compared through sql`` rather than gte/lte: these columns are
      // timestamps and the bounds are date strings, which is the idiom the rest
      // of the codebase (OrderService.list) already uses for exactly this.
      const orderConditions: SQL[] = [
        eq(orders.tenantId, ctx.tenant.id),
        eq(orders.agentId, ctx.user.id),
        inArray(orders.status, REVENUE_ORDER_STATUSES),
        sql`${orders.createdAt} >= ${monthStart}`,
        sql`${orders.createdAt} <= ${periodEndOfDay}`,
      ];
      if (target.shopId) orderConditions.push(eq(orders.shopId, target.shopId));

      const [[orderStats], [visitStats]] = await Promise.all([
        db.select({
          total: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,2))), 0)`,
          count: sql<string>`COUNT(*)`,
        }).from(orders).where(and(...orderConditions)),
        db.select({
          total: sql<string>`COUNT(*)`,
          completed: sql<string>`SUM(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 ELSE 0 END)`,
        }).from(dailyPlans).where(and(
          eq(dailyPlans.tenantId, ctx.tenant.id),
          eq(dailyPlans.agentId, ctx.user.id),
          sql`${dailyPlans.planDate} >= ${monthStart}`,
          sql`${dailyPlans.planDate} <= ${periodEnd}`,
        )),
      ]);

      const revenueTarget = Number(target.targetAmount);
      const revenueActual = Number(orderStats?.total ?? 0);
      const orderTarget = target.orderCountTarget ?? 0;
      const orderActual = Number(orderStats?.count ?? 0);
      const visitTgt = target.visitTarget ? Number(target.visitTarget) : 0;
      const plannedVisits = Number(visitStats?.total ?? 0);
      const visitAct = plannedVisits > 0
        ? (Number(visitStats?.completed ?? 0) / plannedVisits) * 100
        : 0;

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
        // How far into the month we are. A bare percentage doesn't tell an
        // agent whether they are on course — 60% is comfortable on day 25 and
        // alarming on day 5 — and the client can't derive this safely, since
        // the device clock and timezone need not agree with the server's.
        daysTotal: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
        daysElapsed: Math.min(
          new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
          new Date().getFullYear() === now.getFullYear() && new Date().getMonth() === now.getMonth()
            ? new Date().getDate()
            : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
        ),
      };
    }),

  // Get sales target summary for dashboard
  summary: managementQuery
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
          sql`${salesTargets.periodStart} >= ${monthStart}`,
          sql`${salesTargets.periodEnd} <= ${monthEnd}`,
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

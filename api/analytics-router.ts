import { z } from "zod";
import { createRouter, reportsQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, orderItems, products, shops, users, dailyPlans, arrivals } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { MS_PER_DAY } from "./lib/constants";

export const analyticsRouter = createRouter({
  salesByShop: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        shopName:   shops.name,
        revenue:    sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(*)`,
      })
        .from(orders).leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions)).groupBy(shops.id).orderBy(desc(sql`SUM(${orders.total})`)).limit(20);
    }),

  topProducts: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        productName:  products.name,
        productCode:  products.code,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
      })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...conditions)).groupBy(products.id).orderBy(desc(sql`SUM(${orderItems.quantity})`)).limit(10);
    }),

  agentPerformance: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id)];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        agentName:     users.name,
        agentId:       users.id,
        orderCount:    sql<number>`count(*)`,
        totalRevenue:  sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        avgOrderValue: sql<string>`COALESCE(AVG(${orders.total}), 0)`,
      })
        .from(orders).leftJoin(users, eq(orders.agentId, users.id))
        .where(and(...conditions)).groupBy(users.id).orderBy(desc(sql`SUM(${orders.total})`));
    }),

  // ── COGS + Margins ──────────────────────────────────────────────────────────
  cogsByProduct: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        productName:  products.name,
        productCode:  products.code,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
        totalCost:    sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${products.costPrice}, 0)), 0)`,
      })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...conditions)).groupBy(products.id).orderBy(desc(sql`SUM(${orderItems.subtotal})`)).limit(20);
    }),

  cogsSummary: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      const result = await getDb().select({
        totalRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        totalCost:    sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${products.costPrice}, 0)), 0)`,
        totalDiscount: sql<string>`COALESCE(SUM(${orders.discount}), 0)`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(...conditions));

      return result[0] ?? { totalRevenue: "0", totalCost: "0", totalDiscount: "0" };
    }),

  // ── Per-Shop Revenue Trend ──────────────────────────────────────────────────
  shopRevenueTrend: reportsQuery
    .input(z.object({ shopId: z.number(), days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      if (!input?.shopId) return [];
      const cutoff = new Date(Date.now() - input.days * MS_PER_DAY).toISOString();

      return getDb().select({
        date: sql<string>`DATE(${orders.createdAt})`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(*)`,
      })
        .from(orders)
        .where(and(eq(orders.tenantId, ctx.tenant.id), eq(orders.shopId, input.shopId), eq(orders.status, "completed"), sql`${orders.createdAt} >= ${cutoff}`))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    }),

  // ── Debt Report ─────────────────────────────────────────────────────────────
  debtReport: reportsQuery.query(async ({ ctx }) => {
    return getDb().select({
      shopName: shops.name,
      city: shops.city,
      debt: shops.debt,
      agentName: users.name,
    })
      .from(shops).leftJoin(users, eq(shops.agentId, users.id))
      .where(and(eq(shops.tenantId, ctx.tenant.id), sql`${shops.debt} > 0`))
      .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL)`));
  }),

  // ── Agent Efficiency ────────────────────────────────────────────────────────
  agentEfficiency: reportsQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();

      const rows = await getDb().select({
        agentName: users.name,
        agentId: users.id,
        visits: sql<number>`count(DISTINCT ${dailyPlans.id})`,
        orders: sql<number>`count(DISTINCT ${orders.id})`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        avgOrderValue: sql<string>`COALESCE(AVG(${orders.total}), 0)`,
      })
        .from(users)
        .leftJoin(dailyPlans, and(eq(dailyPlans.agentId, users.id), sql`${dailyPlans.planDate} >= ${cutoff}`))
        .leftJoin(orders, and(eq(orders.agentId, users.id), eq(orders.status, "completed"), sql`${orders.createdAt} >= ${cutoff}`))
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "agent")))
        .groupBy(users.id).orderBy(desc(sql`COALESCE(SUM(${orders.total}), 0)`));

      return rows.map(r => ({
        ...r,
        conversionRate: Number(r.visits) > 0 ? ((Number(r.orders) / Number(r.visits)) * 100).toFixed(1) : "0",
      }));
    }),

  // ── Full P&L Report ─────────────────────────────────────────────────────────
  pnl: reportsQuery
    .input(z.object({
      from: z.string(),
      to: z.string(),
      compareWithPrev: z.boolean().default(true),
    }))
    .query(async ({ input, ctx }) => {
      const tid = ctx.tenant.id;
      const db = getDb();
      const from = input.from;
      const to = input.to;

      const prevFromMs = new Date(from).getTime();
      const currFromMs = new Date(from).getTime();
      const currToMs = new Date(to).getTime();
      const periodMs = currToMs - currFromMs;
      const prevFrom = new Date(prevFromMs - periodMs).toISOString().slice(0, 10);
      const prevTo = new Date(currFromMs - MS_PER_DAY).toISOString().slice(0, 10);

      async function calcPeriod(dateFrom: string, dateTo: string) {
        const orderConds = [
          eq(orders.tenantId, tid),
          eq(orders.status, "completed"),
          sql`${orders.createdAt} >= ${dateFrom}`,
          sql`${orders.createdAt} <= ${dateTo + " 23:59:59"}`,
        ];
        const revRow = await db.select({
          totalRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
          totalDiscount: sql<string>`COALESCE(SUM(${orders.discount}), 0)`,
          orderCount: sql<number>`count(*)`,
        })
          .from(orders)
          .where(and(...orderConds));

        const cogsRow = await db.select({
          totalCOGS: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${products.costPrice}, 0)), 0)`,
        })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .leftJoin(orders, eq(orderItems.orderId, orders.id))
          .where(and(
            eq(orders.tenantId, tid),
            eq(orders.status, "completed"),
            sql`${orders.createdAt} >= ${dateFrom}`,
            sql`${orders.createdAt} <= ${dateTo + " 23:59:59"}`,
          ));

        const expenseRow = await db.select({
          totalExpenses: sql<string>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
          arrivalCount: sql<number>`count(*)`,
        })
          .from(arrivals)
          .where(and(
            eq(arrivals.tenantId, tid),
            eq(arrivals.status, "completed"),
            sql`${arrivals.arrivalDate} >= ${dateFrom}`,
            sql`${arrivals.arrivalDate} <= ${dateTo}`,
          ));

        const revenue = Number(revRow[0]?.totalRevenue ?? 0);
        const discount = Number(revRow[0]?.totalDiscount ?? 0);
        const orderCount = Number(revRow[0]?.orderCount ?? 0);
        const cogs = Number(cogsRow[0]?.totalCOGS ?? 0);
        const operatingExpenses = Number(expenseRow[0]?.totalExpenses ?? 0);
        const arrivalCount = Number(expenseRow[0]?.arrivalCount ?? 0);
        const grossProfit = revenue - cogs;
        const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const netProfit = grossProfit - operatingExpenses;
        const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

        return {
          revenue, discount, orderCount, cogs, operatingExpenses,
          arrivalCount, grossProfit, grossMarginPct, netProfit, netMarginPct,
        };
      }

      const current = await calcPeriod(from, to);
      const previous = input.compareWithPrev
        ? await calcPeriod(prevFrom, prevTo)
        : null;

      const delta = (curr: number, prev: number | null) => {
        if (prev === null || prev === 0) return null;
        return ((curr - prev) / Math.abs(prev)) * 100;
      };

      // Monthly trend (group by YYYY-MM)
      const monthlyRows = await db.select({
        month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        cogs: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${products.costPrice}, 0)), 0)`,
        orderCount: sql<number>`count(DISTINCT ${orders.id})`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(
          eq(orders.tenantId, tid),
          eq(orders.status, "completed"),
          sql`${orders.createdAt} >= ${from}`,
          sql`${orders.createdAt} <= ${to + " 23:59:59"}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      const monthlyExpenses = await db.select({
        month: sql<string>`DATE_FORMAT(${arrivals.arrivalDate}, '%Y-%m')`,
        expenses: sql<string>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
      })
        .from(arrivals)
        .where(and(
          eq(arrivals.tenantId, tid),
          eq(arrivals.status, "completed"),
          sql`${arrivals.arrivalDate} >= ${from}`,
          sql`${arrivals.arrivalDate} <= ${to}`,
        ))
        .groupBy(sql`DATE_FORMAT(${arrivals.arrivalDate}, '%Y-%m')`);

      const expenseByMonth: Record<string, number> = {};
      for (const r of monthlyExpenses) {
        expenseByMonth[r.month] = Number(r.expenses);
      }

      const trend = monthlyRows.map(r => {
        const rev = Number(r.revenue);
        const cost = Number(r.cogs);
        const gp = rev - cost;
        const exp = expenseByMonth[r.month] ?? 0;
        return {
          month: r.month,
          revenue: rev,
          cogs: cost,
          grossProfit: gp,
          operatingExpenses: exp,
          netProfit: gp - exp,
          orderCount: Number(r.orderCount),
        };
      });

      return {
        current,
        previous,
        deltas: {
          revenue: delta(current.revenue, previous?.revenue ?? null),
          cogs: delta(current.cogs, previous?.cogs ?? null),
          grossProfit: delta(current.grossProfit, previous?.grossProfit ?? null),
          grossMarginPct: previous !== null
            ? current.grossMarginPct - previous.grossMarginPct
            : null,
          operatingExpenses: delta(current.operatingExpenses, previous?.operatingExpenses ?? null),
          netProfit: delta(current.netProfit, previous?.netProfit ?? null),
          netMarginPct: previous !== null
            ? current.netMarginPct - previous.netMarginPct
            : null,
        },
        trend,
        period: { from, to },
        prevPeriod: input.compareWithPrev ? { from: prevFrom, to: prevTo } : null,
      };
    }),

  // ── P&L by Payment Method ──────────────────────────────────────────────────
  pnlByPaymentMethod: reportsQuery
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      const tid = ctx.tenant.id;
      const db = getDb();

      const rows = await db.select({
        paymentMethod: orders.paymentMethod,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        discount: sql<string>`COALESCE(SUM(${orders.discount}), 0)`,
        cogs: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${products.costPrice}, 0)), 0)`,
        orderCount: sql<number>`count(DISTINCT ${orders.id})`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(
          eq(orders.tenantId, tid),
          eq(orders.status, "completed"),
          sql`${orders.createdAt} >= ${input.from}`,
          sql`${orders.createdAt} <= ${input.to + " 23:59:59"}`,
        ))
        .groupBy(orders.paymentMethod)
        .orderBy(desc(sql`SUM(${orders.total})`));

      return rows.map(r => {
        const rev = Number(r.revenue);
        const cost = Number(r.cogs);
        return {
          paymentMethod: r.paymentMethod,
          revenue: rev,
          discount: Number(r.discount),
          cogs: cost,
          grossProfit: rev - cost,
          grossMarginPct: rev > 0 ? ((rev - cost) / rev) * 100 : 0,
          orderCount: Number(r.orderCount),
        };
      });
    }),

  // ── Payment Method Breakdown for Monthly Trend ──────────────────────────────
  paymentMethodTrend: reportsQuery
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      const tid = ctx.tenant.id;
      const db = getDb();

      const rows = await db.select({
        month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
        paymentMethod: orders.paymentMethod,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      })
        .from(orders)
        .where(and(
          eq(orders.tenantId, tid),
          eq(orders.status, "completed"),
          sql`${orders.createdAt} >= ${input.from}`,
          sql`${orders.createdAt} <= ${input.to + " 23:59:59"}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`, orders.paymentMethod)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      // Transform to { month, cash, transfer, debt, card }[]
      const monthMap = new Map<string, Record<string, number>>();
      for (const r of rows) {
        if (!monthMap.has(r.month)) {
          monthMap.set(r.month, { month: r.month, cash: 0, transfer: 0, debt: 0, card: 0 });
        }
        const entry = monthMap.get(r.month)!;
        entry[r.paymentMethod as keyof typeof entry] = Number(r.revenue);
      }

      return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
    }),
});

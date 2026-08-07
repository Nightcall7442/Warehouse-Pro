import { z } from "zod";
import { createRouter, reportsQuery, financeQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, orderItems, products, shops, users, dailyPlans, arrivals, agentTerritories } from "@db/schema";
import { eq, and, sql, desc , inArray } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES, revenueOrderConditions, liveOrderConditions } from "./lib/order-status";
import { MS_PER_DAY } from "./lib/constants";

export const analyticsRouter = createRouter({
  salesByShop: reportsQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      agentId: z.number().int().positive().optional(),
      territoryId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10000).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = revenueOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      // P1-15 FIX: Include full last day by adding 23:59:59
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);
      if (input?.agentId)     conditions.push(eq(orders.agentId, input.agentId));
      if (input?.territoryId) conditions.push(eq(shops.territoryId, input.territoryId));

      // The dashboard wants a top-N chart; an export wants every row. Left at
      // the chart default so existing callers are untouched, and raised only
      // when the reports hub explicitly asks — an export that silently drops
      // the tail is worse than no export, because nothing on the sheet says
      // anything is missing.
      return getDb().select({
        shopName:   shops.name,
        revenue:    sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(*)`,
      })
        .from(orders).leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions)).groupBy(shops.id).orderBy(desc(sql`SUM(${orders.total})`)).limit(input?.limit ?? 20);
    }),

  topProducts: reportsQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      agentId: z.number().int().positive().optional(),
      // Category is a varchar on the product, not a foreign key — there is no
      // categories table — so this filters by the name itself.
      category: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(10000).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = revenueOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);
      if (input?.agentId)  conditions.push(eq(orders.agentId, input.agentId));
      if (input?.category) conditions.push(eq(products.category, input.category));

      return getDb().select({
        productName:  products.name,
        productCode:  products.code,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
      })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...conditions)).groupBy(products.id).orderBy(desc(sql`SUM(${orderItems.quantity})`)).limit(input?.limit ?? 10);
    }),

  agentPerformance: reportsQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = liveOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);

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
  // NOTE: COGS uses current `products.costPrice`, not historical. If product costs
  // change over time, historical P&L and COGS reports will be inaccurate.
  // Consider adding `costPrice` to `orderItems` to snapshot the cost at order time.
  cogsByProduct: financeQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      category: z.string().max(100).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = revenueOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);
      if (input?.category) conditions.push(eq(products.category, input.category));

      return getDb().select({
        productName:  products.name,
        productCode:  products.code,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
        totalCost:    sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${orderItems.costPrice}, 0)), 0)`,
      })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...conditions)).groupBy(products.id).orderBy(desc(sql`SUM(${orderItems.subtotal})`)).limit(20);
    }),

  cogsSummary: financeQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = revenueOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);

      // P0-10 FIX: Use separate queries to avoid fan-out from LEFT JOIN order_items
      const [revenueRow] = await getDb().select({
        totalRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        totalDiscount: sql<string>`COALESCE(SUM(${orders.discount}), 0)`,
      }).from(orders).where(and(...conditions));

      const [costRow] = await getDb().select({
        totalCost: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${orderItems.costPrice}, 0)), 0)`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(...conditions));

      return {
        totalRevenue: revenueRow?.totalRevenue ?? "0",
        totalCost: costRow?.totalCost ?? "0",
        totalDiscount: revenueRow?.totalDiscount ?? "0",
      };
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
        .where(and(eq(orders.tenantId, ctx.tenant.id), eq(orders.shopId, input.shopId), inArray(orders.status, REVENUE_ORDER_STATUSES), sql`${orders.createdAt} >= ${cutoff}`))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    }),

  // ── Debt Report ─────────────────────────────────────────────────────────────
  // Debt is a balance as of now, not a flow over a range, so there is no period
  // here on purpose.
  debtReport: reportsQuery
    .input(z.object({
      agentId: z.number().int().positive().optional(),
      territoryId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(shops.tenantId, ctx.tenant.id), sql`${shops.debt} > 0`];
      // The agent who holds the shop, not the one who took the last order —
      // the question this report answers is whose round the debt sits on.
      if (input?.agentId)     conditions.push(eq(shops.agentId, input.agentId));
      if (input?.territoryId) conditions.push(eq(shops.territoryId, input.territoryId));

      return getDb().select({
        shopName: shops.name,
        city: shops.city,
        debt: shops.debt,
        agentName: users.name,
      })
        .from(shops).leftJoin(users, eq(shops.agentId, users.id))
        .where(and(...conditions))
        .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL)`));
    }),

  // ── Agent Efficiency ────────────────────────────────────────────────────────
  agentEfficiency: reportsQuery
    .input(z.object({
      days: z.number().default(30),
      territoryId: z.number().int().positive().optional(),
    }).optional())
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
        .leftJoin(orders, and(eq(orders.agentId, users.id), inArray(orders.status, REVENUE_ORDER_STATUSES), sql`${orders.createdAt} >= ${cutoff}`))
        .where(and(
          eq(users.tenantId, ctx.tenant.id),
          eq(users.role, "agent"),
          // An agent can work several territories, so this is a membership
          // test rather than a column comparison. EXISTS rather than a join:
          // joining agent_territories would multiply the rows an agent
          // contributes and quietly inflate every aggregate above.
          ...(input?.territoryId ? [sql`EXISTS (
            SELECT 1 FROM ${agentTerritories}
            WHERE ${agentTerritories.agentId} = ${users.id}
              AND ${agentTerritories.tenantId} = ${ctx.tenant.id}
              AND ${agentTerritories.territoryId} = ${input.territoryId})`] : []),
        ))
        .groupBy(users.id).orderBy(desc(sql`COALESCE(SUM(${orders.total}), 0)`));

      return rows.map(r => ({
        ...r,
        conversionRate: Number(r.visits) > 0 ? ((Number(r.orders) / Number(r.visits)) * 100).toFixed(1) : "0",
      }));
    }),

  // ── Full P&L Report ─────────────────────────────────────────────────────────
  pnl: financeQuery
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
          inArray(orders.status, REVENUE_ORDER_STATUSES),
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
          totalCOGS: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${orderItems.costPrice}, 0)), 0)`,
        })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .leftJoin(orders, eq(orderItems.orderId, orders.id))
          .where(and(
            eq(orders.tenantId, tid),
            inArray(orders.status, REVENUE_ORDER_STATUSES),
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

      // Помесячный ряд. Выручка и себестоимость берутся ДВУМЯ запросами и
      // сшиваются по месяцу в JS — тем же приёмом, что и в cogsSummary выше.
      //
      // Одним запросом было нельзя: присоединение order_items размножает строку
      // заказа по числу позиций, и SUM(orders.total) поверх такого набора
      // считает заказ столько раз, сколько в нём товаров. orderCount от этого
      // защищён через COUNT(DISTINCT), а revenue — нет, поэтому на одном и том
      // же экране P&L карточки показывали 5 520 500, а график под ними —
      // 29 673 500. И grossProfit, и маржа считаются от выручки, то есть весь
      // график был выдумкой, растущей вместе со средним размером корзины.
      const monthlyRevenue = await db.select({
        month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(DISTINCT ${orders.id})`,
      })
        .from(orders)
        .where(and(
          ...revenueOrderConditions(tid),
          sql`${orders.createdAt} >= ${from}`,
          sql`${orders.createdAt} <= ${to + " 23:59:59"}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      const monthlyCogs = await db.select({
        month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
        cogs: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${orderItems.costPrice}, 0)), 0)`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(and(
          ...revenueOrderConditions(tid),
          sql`${orders.createdAt} >= ${from}`,
          sql`${orders.createdAt} <= ${to + " 23:59:59"}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      const cogsByMonth: Record<string, string> = {};
      for (const r of monthlyCogs) cogsByMonth[r.month] = r.cogs;

      const monthlyRows = monthlyRevenue.map(r => ({
        ...r,
        cogs: cogsByMonth[r.month] ?? "0",
      }));

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
  pnlByPaymentMethod: financeQuery
    .input(z.object({
      from: z.string(),
      to: z.string(),
      agentId: z.number().int().positive().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tid = ctx.tenant.id;

      const rows = await db.select({
        paymentMethod: orders.paymentMethod,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(*)`,
        cogs: sql<string>`COALESCE(SUM(${orderItems.quantity} * COALESCE(${orderItems.costPrice}, 0)), 0)`,
      })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(
          eq(orders.tenantId, tid),
          inArray(orders.status, REVENUE_ORDER_STATUSES),
          sql`${orders.createdAt} >= ${input.from}`,
          sql`${orders.createdAt} <= ${input.to + " 23:59:59"}`,
          ...(input.agentId ? [eq(orders.agentId, input.agentId)] : []),
        ))
        .groupBy(orders.paymentMethod);

      return rows.map(r => {
        const revenue = Number(r.revenue);
        const cogs = Number(r.cogs);
        const grossProfit = revenue - cogs;
        const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        return {
          paymentMethod: r.paymentMethod ?? "unknown",
          revenue,
          cogs,
          grossProfit,
          grossMarginPct,
          orderCount: Number(r.orderCount),
        };
      });
    }),

  // ── Sales by Agent × Product ────────────────────────────────────────────────
  agentProductSales: reportsQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      agentId: z.number().int().positive().optional(),
      category: z.string().max(100).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = revenueOrderConditions(ctx.tenant.id);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo + " 23:59:59"}`);
      if (input?.agentId)  conditions.push(eq(orders.agentId, input.agentId));
      if (input?.category) conditions.push(eq(products.category, input.category));

      return getDb().select({
        agentId:      users.id,
        agentName:    users.name,
        productId:    products.id,
        productName:  products.name,
        productCode:  products.code,
        unit:         products.unit,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
        orderCount:   sql<number>`count(DISTINCT ${orders.id})`,
      })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .leftJoin(users, eq(orders.agentId, users.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(and(...conditions))
        .groupBy(orders.agentId, orderItems.productId)
        .orderBy(users.name, desc(sql`SUM(${orderItems.subtotal})`));
    }),

  // ── Payment Method Trend ──────────────────────────────────────────────────
  paymentMethodTrend: reportsQuery
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tid = ctx.tenant.id;

      const rows = await db.select({
        month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
        paymentMethod: orders.paymentMethod,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      })
        .from(orders)
        .where(and(
          eq(orders.tenantId, tid),
          inArray(orders.status, REVENUE_ORDER_STATUSES),
          sql`${orders.createdAt} >= ${input.from}`,
          sql`${orders.createdAt} <= ${input.to + " 23:59:59"}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`, orders.paymentMethod)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      // Pivot: group by month, columns per payment method
      const pivot: Record<string, { month: string; cash: number; transfer: number; debt: number; card: number }> = {};
      for (const r of rows) {
        const m = r.month;
        if (!pivot[m]) pivot[m] = { month: m, cash: 0, transfer: 0, debt: 0, card: 0 };
        const method = (r.paymentMethod ?? "unknown").toLowerCase();
        const key = method === "cash" || method === "naqd" ? "cash"
          : method === "transfer" || method === "perevod" ? "transfer"
          : method === "debt" || method === "qarz" ? "debt"
          : method === "card" || method === "plastic" ? "card"
          : "cash";
        pivot[m][key] += Number(r.revenue);
      }

      return Object.values(pivot).sort((a, b) => a.month.localeCompare(b.month));
    }),
});

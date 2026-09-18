import { photoRef } from "./lib/photo-url";
import { z } from "zod";
import { createRouter, reportsQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, users, dailyPlans, agentLocations, subscriptions, shops, products, stockMovements } from "@db/schema";
import { eq, and, sql, gte, desc , inArray, isNull } from "drizzle-orm";
import { movementReferenceNumber } from "./lib/movement-reference";
import { REVENUE_ORDER_STATUSES } from "./lib/order-status";
import { subDays, format } from "date-fns";
import { onDate } from "./lib/date-range";
import { reportCached, ReportTTL } from "./lib/report-cache";

export const reportsRouter = createRouter({
  /** KPI summary for the Reports page */
  /*
    Было: каждое открытие «Отчётов» — шесть запросов в базу; 30 директоров в
    9:00 — 180 запросов в пул на 20 соединений. Теперь: один пересчёт на
    организацию в минуту, остальные берут готовое (report-cache склеивает
    одновременные промахи и делит результат между экземплярами через Redis).
    Минута, а не 20 с: «активных сейчас» — окно два часа, «заказов за 30
    дней» — минута не видна. Пинги геолокации кэш не сбрасывают (иначе сброс
    каждую секунду), поэтому свежесть activeNow держит только TTL.
    Ключ — только арендатор: супервайзер здесь видит всю организацию.
  */
  getDashboardSummary: reportsQuery.query(({ ctx }) => {
    const tenantId = ctx.tenant.id;
    return reportCached(tenantId, "reports.getDashboardSummary", {}, ReportTTL.minute, async () => {
      const db       = getDb();
      const now      = new Date();
      const today    = format(now, "yyyy-MM-dd");
      const d30ago   = subDays(now, 30).toISOString();

      const [
        agentCount, visitsToday, month, sub, activeNow,
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),

        db.select({ count: sql<number>`count(*)` }).from(dailyPlans)
          .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today), eq(dailyPlans.status, "visited"))),

        // Было два запроса по одному и тому же условию — count и SUM порознь.
        // Теперь один: числа те же, обращение к базе одно.
        db.select({ count: sql<number>`count(*)`, total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
          .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), inArray(orders.status, REVENUE_ORDER_STATUSES), gte(orders.createdAt, new Date(d30ago)))),

        db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1),

        // Active agents today (those with location pings in last 2h).
        // Ждался отдельным await после Promise.all без причины — теперь в нём.
        db.select({ agentId: agentLocations.agentId })
          .from(agentLocations)
          .where(and(
            eq(agentLocations.tenantId, tenantId),
            gte(agentLocations.createdAt, new Date(now.getTime() - 2 * 3600_000)),
          ))
          .groupBy(agentLocations.agentId),
      ]);

      const agentTotal = Number(agentCount[0]?.count ?? 0);
      const ordersM    = Number(month[0]?.count ?? 0);

      return {
        totalAgents:    agentTotal,
        activeNow:      activeNow.length,
        visitsToday:    Number(visitsToday[0]?.count ?? 0),
        ordersMonth:    ordersM,
        revenueMonth:   Number(month[0]?.total ?? 0),
        avgOrdersPerAgent: agentTotal > 0 ? +(ordersM / agentTotal).toFixed(1) : 0,
        subscription:   sub[0] ?? null,
      };
    });
  }),

  /** Daily visit/order chart for a date range */
  getVisitChart: reportsQuery
    .input(z.object({ days: z.number().default(30) }))
    .query(({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      // Пять минут: график по дням за 7/30/90 дней — от одного заказа или визита
      // линия не двигается; входов три, ключей на организацию три.
      return reportCached(tenantId, "reports.getVisitChart", { days: input.days }, ReportTTL.fiveMin, async () => {
        const db       = getDb();
        const since    = subDays(new Date(), input.days);

        const [visits, ordersData] = await Promise.all([
          db.select({
            date:  sql<string>`DATE(${dailyPlans.planDate})`,
            count: sql<number>`count(*)`,
          })
            .from(dailyPlans)
            .where(and(eq(dailyPlans.tenantId, tenantId), gte(dailyPlans.planDate, since)))
            .groupBy(sql`DATE(${dailyPlans.planDate})`)
            .orderBy(sql`DATE(${dailyPlans.planDate})`),

          db.select({
            date:    sql<string>`DATE(${orders.createdAt})`,
            count:   sql<number>`count(*)`,
            revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
          })
            .from(orders)
            // Тот же фильтр, что и у плитки «Заказов» рядом на экране: там
            // считаются только доставленные. Здесь его не было, и линия графика
            // шла выше плитки ровно на отменённые и возвращённые заказы —
            // человек видел два разных числа об одном периоде и не мог знать,
            // какому верить.
            .where(and(
              eq(orders.tenantId, tenantId),
              isNull(orders.deletedAt),
              inArray(orders.status, REVENUE_ORDER_STATUSES),
              gte(orders.createdAt, since),
            ))
            .groupBy(sql`DATE(${orders.createdAt})`)
            .orderBy(sql`DATE(${orders.createdAt})`),
        ]);

        // Merge by date
        const dateMap: Record<string, { date: string; visits: number; orders: number; revenue: number }> = {};
        visits.forEach(v => {
          dateMap[v.date] = { date: v.date, visits: Number(v.count), orders: 0, revenue: 0 };
        });
        ordersData.forEach(o => {
          if (!dateMap[o.date]) dateMap[o.date] = { date: o.date, visits: 0, orders: 0, revenue: 0 };
          dateMap[o.date].orders  = Number(o.count);
          dateMap[o.date].revenue = Number(o.revenue);
        });

        return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
      });
    }),

  /** Top-10 agents by visits/orders */
  /*
    Эффективность агентов жила здесь и не вызывалась ниоткуда. На тот же
    вопрос отвечают два живых экрана: analytics.agentPerformance («сколько
    продал») в отчётах и kpi.agentList («как работает» — визиты, конверсия,
    балл) на странице KPI. Третий ответ был бы третьей правдой.
  */

  /** Today's plan completion per agent */
  getPlanCompletion: reportsQuery.query(({ ctx }) => {
    const tenantId = ctx.tenant.id;
    // 20 с, без инвалидации: визиты отмечают в поле сотнями в день, сбрасывать
    // кэш всей организации на каждый нельзя; супервайзер смотрит ход дня —
    // 20 с он не заметит, а 30 открытых экранов дадут один запрос.
    return reportCached(tenantId, "reports.getPlanCompletion", {}, ReportTTL.live, async () => {
      const db       = getDb();
      const today    = format(new Date(), "yyyy-MM-dd");

      const rows = await db.select({
        agentId:   dailyPlans.agentId,
        agentName: users.name,
        total:     sql<number>`count(*)`,
        visited:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
        planned:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'planned' THEN 1 END)`,
        skipped:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'skipped' THEN 1 END)`,
      })
        .from(dailyPlans)
        .leftJoin(users, and(eq(dailyPlans.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today)))
        .groupBy(dailyPlans.agentId);

      return rows.map(r => ({
        ...r,
        pct: r.total > 0 ? Math.round((Number(r.visited) / Number(r.total)) * 100) : 0,
      }));
    });
  }),

  /*
    Два журнала ниже (визиты и движения склада) нарочно без reportCached:
    выгрузка до 10 000 строк по произвольным датам — попаданий не будет, а
    мегабайты в памяти и Redis вытеснят то, ради чего кэш заведён.
  */
  /**
   * Every planned visit in a period, one row each.
   *
   * The other visit endpoints here answer "how many" — this one answers "which
   * ones", which is what somebody reaches for when a shop says nobody came.
   * Photo and note presence rather than their contents: a visit photo is a
   * multi-megabyte blob and no spreadsheet wants it, but whether one exists is
   * exactly the question being asked.
   */
  getVisitsLog: reportsQuery
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      agentId: z.number().int().positive().optional(),
      shopId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10000).default(1000),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        sql`${dailyPlans.planDate} >= ${input.dateFrom}`,
        sql`${dailyPlans.planDate} <= ${input.dateTo}`,
      ];
      if (input.agentId) conditions.push(eq(dailyPlans.agentId, input.agentId));
      if (input.shopId) conditions.push(eq(dailyPlans.shopId, input.shopId));

      return getDb().select({
        planDate: dailyPlans.planDate,
        status: dailyPlans.status,
        visitedAt: dailyPlans.visitedAt,
        agentName: users.name,
        shopName: shops.name,
        shopCity: shops.city,
        shopAddress: shops.address,
        /*
          Ссылка на снимок, а не признак «да/нет».

          Здесь отдавался hasPhoto — единица или ноль, — и колонка «Фото» в
          выгрузке печатала «да». То есть журнал сообщал, что доказательство
          существует, и не давал на него посмотреть, а открывают этот журнал
          именно затем, чтобы разобрать спорный день.

          Сам снимок по-прежнему не выбирается: photo_url это data-url до
          нескольких мегабайт, а строк в журнале бывает десять тысяч.
        */
        photoUrl: photoRef("visit", dailyPlans.id, dailyPlans.photoUrl, dailyPlans.updatedAt),
        notes: dailyPlans.notes,
      })
        .from(dailyPlans)
        .leftJoin(users, and(eq(dailyPlans.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .leftJoin(shops, and(eq(dailyPlans.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
        .where(and(...conditions))
        .orderBy(desc(dailyPlans.planDate))
        .limit(input.limit);
    }),

  /**
   * Warehouse-wide stock movement log.
   *
   * warehouse.movements answers for one product at a time — it takes a
   * productId — so there was no way to export what moved through the warehouse
   * over a period, which is the version an accountant asks for.
   */
  getStockMovements: reportsQuery
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      type: z.enum(["in", "out", "adjustment"]).optional(),
      limit: z.number().int().min(1).max(10000).default(1000),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(stockMovements.tenantId, ctx.tenant.id),
        sql`${stockMovements.createdAt} >= ${input.dateFrom}`,
        sql`${stockMovements.createdAt} <= ${input.dateTo + " 23:59:59"}`,
      ];
      if (input.type) conditions.push(eq(stockMovements.type, input.type));

      return getDb().select({
        createdAt: stockMovements.createdAt,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        productName: products.name,
        productCode: products.code,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        referenceNumber: movementReferenceNumber,
        notes: stockMovements.notes,
      })
        .from(stockMovements)
        .leftJoin(products, and(eq(stockMovements.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(...conditions))
        .orderBy(desc(stockMovements.createdAt))
        .limit(input.limit);
    }),
});

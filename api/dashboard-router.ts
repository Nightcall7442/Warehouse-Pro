import { z } from "zod";
import { createRouter, fieldSalesQuery, supervisorQuery } from "./middleware";
import { orders, warehouseStock, users, shops, agentLocations, dailyPlans, orderItems } from "@db/schema";
import { eq, and, or, sql, desc, isNull, inArray } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES, OPEN_ORDER_STATUSES, deliveredQty } from "./lib/order-status";
import { subDays } from "date-fns";
import { reportCached, ReportTTL } from "./lib/report-cache";
import { onDay, onDate, sinceDay } from "./lib/date-range";
import { returnsInPeriod, totalReturned } from "./services/revenue-returns";

/**
 * Сколько дней назад смотрит плитка валовой маржи на дашборде.
 *
 * 90 дней — достаточно, чтобы процент не прыгал от одного крупного заказа, и
 * достаточно мало, чтобы запрос упирался в idx_orders_tenant_date, а не в
 * полную историю тенанта. Накопительная маржа за всё время, если она когда-то
 * понадобится, — это отдельная процедура со своим длинным TTL, а не плитка,
 * которая пересчитывается после каждой правки заказа.
 */
const MARGIN_WINDOW_DAYS = 90;

type DashboardKpis = {
  todayOrders:  number;
  todayRevenue: number;
  /** Вчерашние — ради стрелки под плиткой: сравнение дня с днём, а не недели с обрывком. */
  yesterdayOrders:  number;
  yesterdayRevenue: number;
  activeAgents: number;
  totalStock:   number;
  customerDebt: number;
  grossMargin:  number;
  /** Довезено сегодня — по времени доставки, а не оформления. */
  deliveredToday: number;
  /** Ещё в пути или у курьера: вместе с довезёнными — «из скольких». */
  deliveryPending: number;
};

/*
  Кэш главной страницы.

  Было: кэш только у kpis — `cache.get/set` по ключу `kpis:{tenant}` на две
  минуты, без склейки одновременных промахов и без чтения Redis на второй
  реплике; остальные ручки ходили в базу при каждом открытии. Тридцать
  директоров, открывших главную в 9:00, давали тридцать пересчётов kpis по
  одиннадцать параллельных запросов — 330 запросов в пул на 20 соединений.

  Теперь: каждая ручка, кроме персональной agentDashboard, обёрнута в
  reportCached. Ключ — организация + имя ручки + все аргументы, влияющие на
  ответ; промах считается один раз на ключ, остальные ждут ту же Promise;
  сброс `report:{tenant}:*` зовут сервисы записи (order-*, courier-delivery,
  returns, планы) — здесь его дублировать не нужно.

  Область видимости: supervisorQuery не сужает выборку по территориям —
  связи супервайзер → территория в схеме нет, и супервайзер видит всю
  организацию, как директор. Поэтому в ключе нет userId. Единственное
  исключение — revenueTrend: там ветка по роли, и ключ обязан её различать.

  TTL по свежести:
    minute — плитки и графики, которые меняются от записи заказа и сбрасываются
             сервисами; минута нужна лишь как потолок между сбросами;
    live   — то, что живёт на пингах геолокации (supervisorDashboard) или
             читается как лента «сейчас» (activity): пинги пишутся каждым
             агентом каждые ~30 с и сброс не зовут — держит только TTL.
*/
export const dashboardRouter = createRouter({
  kpis: supervisorQuery.query(({ ctx }) => reportCached(ctx.tenant.id, "dashboard.kpis", {}, ReportTTL.minute, async (): Promise<DashboardKpis> => {
    const tenantId = ctx.tenant.id;
    const db       = ctx.db;
    const today    = new Date().toISOString().split("T")[0];
    // Окно валовой маржи. Раньше оба запроса шли по ВСЕЙ истории тенанта:
    // JOIN order_items × orders без единого ограничения по дате. Кеш kpis
    // сбрасывается каждой мутацией заказа, а агенты правят заказы весь
    // рабочий день, поэтому двухминутный TTL почти никогда не доживал до
    // следующего открытия дашборда — и каждое открытие сканировало сотни
    // тысяч строк order_items ради одного процента. Плитка на экране
    // называется просто «ВАЛОВАЯ ПРИБЫЛЬ», без периода, и накопительная
    // маржа за все годы на ней всё равно ничего не значила: она меняется
    // на сотые доли и не реагирует на то, что происходит в бизнесе сейчас.
    const marginFrom = subDays(new Date(), MARGIN_WINDOW_DAYS).toISOString().split("T")[0];

    const yesterday = subDays(new Date(), 1).toISOString().split("T")[0];
    const ordersOn  = (day: string) => db.select({ count: sql<number>`count(*)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, day), isNull(orders.deletedAt)));
    const revenueOn = (day: string) => db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, day), inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt)));

    const [todaysOrders, todaysRevenue, yesterdaysOrders, yesterdaysRevenue, activeAgents, totalStock, customerDebt, revenueResult, costResult, deliveredToday, deliveryPending] = await Promise.all([
      ordersOn(today),
      revenueOn(today),
      ordersOn(yesterday),
      revenueOn(yesterday),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ total: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` }).from(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId)),
      db.select({ total: sql<string>`COALESCE(SUM(${shops.debt}), 0)` }).from(shops)
        .where(eq(shops.tenantId, tenantId)),
      db.select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), sinceDay(orders.createdAt, marginFrom))),
      db.select({
        // Себестоимость берётся из строки заказа и по доставленному количеству.
        //
        // products.costPrice — цена товара СЕГОДНЯ, а не в момент продажи:
        // подняли закупку — и вся прошлая прибыль пересчиталась задним числом.
        // В строке заказа себестоимость зафиксирована при оформлении.
        //
        // Количество — доставленное: при частичной доставке выручка
        // уменьшается, и себестоимость обязана уменьшиться вместе с ней.
        totalCost: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${deliveredQty()} * ${orderItems.costPrice} ELSE 0 END), 0)`,
        // Окно то же, что и у выручки: числитель и знаменатель одной дроби
        // обязаны считаться по одному набору заказов, иначе процент — выдумка.
      }).from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        // innerJoin(products) отсюда убран: ни одного поля products выражение
        // не использует, а соединение стоило lookup по первичному ключу на
        // каждую строку order_items — на сотнях тысяч строк это удваивало
        // работу запроса, ничего не добавляя к результату.
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), sinceDay(orders.createdAt, marginFrom))),
      /*
        «Довезено сегодня N из M». Главная знала только «заказов за сегодня»
        — сколько оформили; сколько из них доехало до магазина, директор
        узнавал по звонку. Время доставки — deliveredAt; у строк, доставленных
        до того, как оно стало писаться, берём последнее изменение.
      */
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(
          eq(orders.tenantId, tenantId), eq(orders.status, "delivered"), isNull(orders.deletedAt),
          or(onDay(orders.deliveredAt, today), and(isNull(orders.deliveredAt), onDay(orders.updatedAt, today))),
        )),
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(
          eq(orders.tenantId, tenantId), isNull(orders.deletedAt),
          inArray(orders.deliveryStatus, ["assigned", "out_for_delivery"]),
        )),
    ]);

    /*
      Возвраты уменьшают и выручку, и себестоимость.

      Плитка называется «ВАЛОВАЯ ПРИБЫЛЬ» и стоит на первом экране директора, а
      P&L на соседней странице ту же прибыль считает ЗА ВЫЧЕТОМ возвратов
      (analytics.pnl). Две цифры про одно и то же расходились ровно на сумму
      возвратов, и объяснить это расхождение было нечем.

      Окно то же, что у выручки и себестоимости выше: числитель и знаменатель
      одной дроби обязаны считаться по одному набору событий.
    */
    const returned = totalReturned(await returnsInPeriod(db, tenantId, marginFrom, today));

    const totalRev = Number(revenueResult[0]?.totalRevenue ?? 0) - returned.amount;
    const totalCostVal = Number(costResult[0]?.totalCost ?? 0) - returned.cost;
    const grossMargin = totalRev > 0 ? ((totalRev - totalCostVal) / totalRev) * 100 : 0;

    const result: DashboardKpis = {
      todayOrders:  Number(todaysOrders[0]?.count ?? 0),
      todayRevenue: Number(todaysRevenue[0]?.total ?? 0),
      yesterdayOrders:  Number(yesterdaysOrders[0]?.count ?? 0),
      yesterdayRevenue: Number(yesterdaysRevenue[0]?.total ?? 0),
      activeAgents: Number(activeAgents[0]?.count ?? 0),
      totalStock:   Number(totalStock[0]?.total ?? 0),
      customerDebt: Number(customerDebt[0]?.total ?? 0),
      grossMargin:  Math.round(grossMargin * 10) / 10,
      deliveredToday:  Number(deliveredToday[0]?.count ?? 0),
      deliveryPending: Number(deliveryPending[0]?.count ?? 0),
    };

    return result;
  })),

  trends: supervisorQuery
    .input(z.object({ range: z.enum(["7d", "30d", "month"]) }))
    .query(({ input, ctx }) => reportCached(ctx.tenant.id, "dashboard.trends", { range: input.range }, ReportTTL.minute, async () => {
      const db        = ctx.db;
      const tenantId  = ctx.tenant.id;
      // «Месяц» — с первого числа: пилюля рядом с «30д» обязана отличаться от неё.
      const startDate = input.range === "month"
        ? new Date().toISOString().slice(0, 8) + "01"
        : subDays(new Date(), input.range === "7d" ? 7 : 30).toISOString().split("T")[0];

      return db.select({
        date:       sql<string>`DATE(${orders.createdAt})`,
        orderCount: sql<number>`count(*)`,
        revenue:    sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), sinceDay(orders.createdAt, startDate), isNull(orders.deletedAt)))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    })),

  /*
    Только открытые заказы. Донат «Статусы заказов» считал по всей истории
    организации: через год «доставлено» съедало круг целиком, и три заказа,
    которые ждут офиса сегодня, в нём не читались вовсе.
  */
  statusBreakdown: supervisorQuery.query(({ ctx }) => reportCached(ctx.tenant.id, "dashboard.statusBreakdown", {}, ReportTTL.minute, async () => {
    return ctx.db.select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt), inArray(orders.status, OPEN_ORDER_STATUSES)))
      .groupBy(orders.status);
  })),

  // Лента «что происходит сейчас»: запрос копеечный (индекс назад, 10 строк),
  // кэш здесь ради «один пересчёт на организацию», а не ради базы — поэтому live.
  activity: supervisorQuery.query(({ ctx }) => reportCached(ctx.tenant.id, "dashboard.activity", {}, ReportTTL.live, async () => {
    return ctx.db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, createdAt: orders.createdAt, shopName: shops.name, agentName: users.name,
    })
      .from(orders)
      .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
      .leftJoin(users, and(eq(orders.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
      .where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt)))
      .orderBy(desc(orders.createdAt)).limit(10);
  })),

  // Не кэшируется намеренно: ответ персональный (свои заказы, свои магазины),
  // ключ обязан был бы включать userId — 30 агентов дали бы 30 ключей, каждый
  // читается одним человеком с одного телефона. Попаданий не будет, а место в
  // памяти кэша (500 записей на процесс) — будет съедено. Запросы S по индексу.
  agentDashboard: fieldSalesQuery.query(async ({ ctx }) => {
    const db       = ctx.db;
    const tenantId = ctx.tenant.id;
    const userId   = ctx.user.id;
    const today    = new Date().toISOString().split("T")[0];

    const [agentOrders, assignedShops] = await Promise.all([
      db.select({ count: sql<number>`count(*)`, total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
        .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.agentId, userId), onDay(orders.createdAt, today), isNull(orders.deletedAt))),
      // Долг берётся тем же запросом, что и число магазинов: агенту он нужен
      // на первом экране — это то, за чем он и едет, — а лишнего обращения к
      // базе это не стоит.
      db.select({
        count: sql<number>`count(*)`,
        debt:  sql<string>`COALESCE(SUM(${shops.debt}), 0)`,
      }).from(shops)
        .where(and(eq(shops.tenantId, tenantId), eq(shops.agentId, userId))),
    ]);

    return {
      todayOrders:   Number(agentOrders[0]?.count ?? 0),
      todayRevenue:  Number(agentOrders[0]?.total ?? 0),
      assignedShops: Number(assignedShops[0]?.count ?? 0),
      shopsDebt:     Number(assignedShops[0]?.debt ?? 0),
    };
  }),

  // live, не minute: «онлайн агентов» считается по пингам за 10 минут, а пинги
  // сброс кэша не зовут (иначе сброс `report:{tenant}:*` каждую секунду).
  // Минута резала бы «онлайн» заметно; 20 секунд — нет.
  supervisorDashboard: supervisorQuery.query(({ ctx }) => reportCached(ctx.tenant.id, "dashboard.supervisorDashboard", {}, ReportTTL.live, async () => {
    const db       = ctx.db;
    const tenantId = ctx.tenant.id;
    const today    = new Date().toISOString().split("T")[0];
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const [todaysOrders, todaysRevenue, activeAgents, onlineAgents, pendingPlans] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), isNull(orders.deletedAt))),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ count: sql<number>`count(distinct ${agentLocations.agentId})` }).from(agentLocations)
        .where(and(eq(agentLocations.tenantId, tenantId), sql`${agentLocations.createdAt} >= ${tenMinAgo}`)),
      db.select({ count: sql<number>`count(*)` }).from(dailyPlans)
        // plan_date is a DATE column — DATE() around it is a no-op that still blocks idx_plans_tenant_date
        .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today), eq(dailyPlans.status, "planned"))),
    ]);

    return {
      todayOrders:   Number(todaysOrders[0]?.count ?? 0),
      todayRevenue:  Number(todaysRevenue[0]?.total ?? 0),
      activeAgents:  Number(activeAgents[0]?.count ?? 0),
      onlineAgents:  Number(onlineAgents[0]?.count ?? 0),
      pendingPlans:  Number(pendingPlans[0]?.count ?? 0),
    };
  })),

  /** Revenue trend for sparkline — last N days daily revenue */
  revenueTrend: fieldSalesQuery
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(({ input, ctx }) => {
      const days = input?.days ?? 7;
      // Ветка по роли обязана быть в ключе. Привилегированные видят выручку
      // фирмы, агент — только свою; общий ключ `{days}` отдал бы агенту
      // фирменную выручку из кэша, заполненного директором минуту назад.
      // У привилегированных ключ общий (scope: "tenant") — им и нужен один
      // пересчёт на организацию; у остальных — свой по userId.
      const companyWide = ["ceo", "operator", "supervisor", "superadmin"].includes(ctx.user.role);
      const scope = companyWide ? { days, scope: "tenant" as const } : { days, userId: ctx.user.id };
      return reportCached(ctx.tenant.id, "dashboard.revenueTrend", scope, ReportTTL.minute, async () => {
        const db = ctx.db;
        const tenantId = ctx.tenant.id;
        const startDate = subDays(new Date(), days).toISOString().split("T")[0];

        const rows = await db.select({
          date: sql<string>`DATE(${orders.createdAt})`,
          revenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
        })
          .from(orders)
          .where(and(
            eq(orders.tenantId, tenantId),
            sinceDay(orders.createdAt, startDate),
            isNull(orders.deletedAt),
            // This feeds the sparkline on the agent's own home screen, and the
            // guard admits agents. Unscoped, every agent's phone drew the
            // company's daily revenue.
            ...(companyWide ? [] : [eq(orders.agentId, ctx.user.id)]),
          ))
          .groupBy(sql`DATE(${orders.createdAt})`)
          .orderBy(sql`DATE(${orders.createdAt})`);

        // Fill missing days with 0
        const result: number[] = [];
        for (let i = 0; i < days; i++) {
          const d = subDays(new Date(), days - 1 - i).toISOString().split("T")[0];
          const found = rows.find(r => r.date === d);
          result.push(Number(found?.revenue ?? 0));
        }
        return result;
      });
    }),
});
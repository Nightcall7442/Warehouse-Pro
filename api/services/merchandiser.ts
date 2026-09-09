import { eq, and, sql, desc } from "drizzle-orm";
import { visitReports, dailyPlans, shops, users } from "@db/schema";
import { cache, CacheKeys } from "../lib/cache";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface ChecklistItem {
  productId: number;
  productName: string;
  present: boolean;
  price?: string;
  promoNote?: string;
}

export interface SubmitReportInput {
  planId: number;
  shopId: number;
  photos: string[];
  checklist: ChecklistItem[];
  competitorNotes?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Отчёты мерчандайзера о визите.

   ── Что было ────────────────────────────────────────────────────────────────

   Служба и три ручки к ней (по магазину, по промежутку дат, по одному отчёту)
   написаны целиком. Из веба не вызывалась НИ ОДНА: мерчандайзер снимал полку,
   заполнял чек-лист по товарам, писал про конкурентов — и это не видел никто
   и никогда. Единственный вызов из браузера — submitReport, то есть запись.

   Причина, по которой витрину нельзя было просто нарисовать, лежит здесь:
   photos — массив JSON с data-url внутри. Список отдавал их целиком, и
   страница из двадцати пяти отчётов весила бы сотни мегабайт.

   ── Как сейчас ──────────────────────────────────────────────────────────────

   Ни один список и ни одна карточка не отдают снимки. Отдаётся их ЧИСЛО, а
   экран собирает ссылки /api/photos/report/<id>/<номер> — снимок тянется
   лениво, по одному, и кэшируется браузером. Ровно так же устроены фото
   товара и магазина (api/lib/photo-url.ts).
   ═══════════════════════════════════════════════════════════════════════════ */
export const MerchandiserService = {
  async submitReport(db: Db, tenantId: number, userId: number, input: SubmitReportInput) {
    const [plan] = await db.select().from(dailyPlans)
      .where(and(
        eq(dailyPlans.id, input.planId),
        eq(dailyPlans.tenantId, tenantId),
      )).limit(1);

    if (!plan) throw new Error("План визита не найден");
    if (plan.agentId !== userId) throw new Error("Этот план назначен другому сотруднику");

    const [report] = await db.insert(visitReports).values({
      tenantId,
      shopId: input.shopId,
      userId,
      planId: input.planId,
      photos: input.photos,
      checklist: input.checklist,
      competitorNotes: input.competitorNotes,
    });

    /*
      Время визита ставится вместе со статусом.

      Отметить визит можно тремя путями: «без фото» (agent.updatePlanStatus),
      «с фото» (agent.saveVisitPhoto) и отчётом мерчандайзера — этим. Время
      ставил только первый, и колонка «Время визита» в журнале оказывалась
      заполненной ровно у тех, кто отметился без единого доказательства.

      Отчёт мерчандайзера — самый подробный из трёх: фотографии, чек-лист по
      выкладке, заметки о конкурентах. И он же оставался без времени.
    */
    await db.update(dailyPlans)
      .set({ status: "visited", visitedAt: new Date() })
      .where(and(eq(dailyPlans.id, input.planId), eq(dailyPlans.tenantId, tenantId)));

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));

    return { success: true, reportId: Number(report.insertId) };
  },

  async getReportsByShop(db: Db, tenantId: number, shopId: number, opts?: { page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const limit = opts?.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(visitReports.tenantId, tenantId), eq(visitReports.shopId, shopId)];

    const [data, countResult] = await Promise.all([
      db.select({
        id: visitReports.id,
        shopId: visitReports.shopId,
        userId: visitReports.userId,
        planId: visitReports.planId,
        /*
          Число снимков, а не сами снимки.

          В photos лежат data-url целиком, по мегабайту с лишним. Страница из
          двадцати пяти отчётов по три снимка — это сотни мегабайт в одном
          ответе; именно поэтому витрины отчётов не существовало. Экран строит
          ссылки /api/photos/report/<id>/<номер> и тянет снимки лениво.
        */
        photoCount: sql<number>`COALESCE(JSON_LENGTH(${visitReports.photos}), 0)`,
        checklist: visitReports.checklist,
        competitorNotes: visitReports.competitorNotes,
        createdAt: visitReports.createdAt,
        userName: users.name,
        shopName: shops.name,
      })
        .from(visitReports)
        .leftJoin(shops, and(eq(visitReports.shopId, shops.id), eq(shops.tenantId, tenantId)))
        .leftJoin(users, and(eq(visitReports.userId, users.id), eq(users.tenantId, tenantId)))
        .where(and(...conditions))
        .orderBy(desc(visitReports.createdAt))
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(visitReports).where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async getReportsByDateRange(db: Db, tenantId: number, dateFrom: string, dateTo: string, opts?: { page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const limit = opts?.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(visitReports.tenantId, tenantId),
      sql`${visitReports.createdAt} >= ${dateFrom}`,
      sql`${visitReports.createdAt} <= ${dateTo + " 23:59:59"}`,
    ];

    const [data, countResult] = await Promise.all([
      db.select({
        id: visitReports.id,
        shopId: visitReports.shopId,
        userId: visitReports.userId,
        planId: visitReports.planId,
        /*
          Число снимков, а не сами снимки.

          В photos лежат data-url целиком, по мегабайту с лишним. Страница из
          двадцати пяти отчётов по три снимка — это сотни мегабайт в одном
          ответе; именно поэтому витрины отчётов не существовало. Экран строит
          ссылки /api/photos/report/<id>/<номер> и тянет снимки лениво.
        */
        photoCount: sql<number>`COALESCE(JSON_LENGTH(${visitReports.photos}), 0)`,
        checklist: visitReports.checklist,
        competitorNotes: visitReports.competitorNotes,
        createdAt: visitReports.createdAt,
        userName: users.name,
        shopName: shops.name,
      })
        .from(visitReports)
        .leftJoin(shops, and(eq(visitReports.shopId, shops.id), eq(shops.tenantId, tenantId)))
        .leftJoin(users, and(eq(visitReports.userId, users.id), eq(users.tenantId, tenantId)))
        .where(and(...conditions))
        .orderBy(desc(visitReports.createdAt))
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(visitReports).where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async getReportById(db: Db, tenantId: number, reportId: number) {
    const [report] = await db.select({
      id: visitReports.id,
      shopId: visitReports.shopId,
      userId: visitReports.userId,
      planId: visitReports.planId,
      // И здесь тоже число: пять снимков по мегабайту — это десять мегабайт
      // на открытие одной карточки, причём каждый раз заново. По ссылкам они
      // грузятся по одному и остаются в кэше браузера.
      photoCount: sql<number>`COALESCE(JSON_LENGTH(${visitReports.photos}), 0)`,
      checklist: visitReports.checklist,
      competitorNotes: visitReports.competitorNotes,
      createdAt: visitReports.createdAt,
      userName: users.name,
      shopName: shops.name,
      shopAddress: shops.address,
    })
      .from(visitReports)
      .leftJoin(shops, and(eq(visitReports.shopId, shops.id), eq(shops.tenantId, tenantId)))
      .leftJoin(users, and(eq(visitReports.userId, users.id), eq(users.tenantId, tenantId)))
      .where(and(eq(visitReports.id, reportId), eq(visitReports.tenantId, tenantId)))
      .limit(1);

    return report ?? null;
  },
};

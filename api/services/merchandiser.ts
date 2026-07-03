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

    await db.update(dailyPlans)
      .set({ status: "visited" })
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
        photos: visitReports.photos,
        checklist: visitReports.checklist,
        competitorNotes: visitReports.competitorNotes,
        createdAt: visitReports.createdAt,
        userName: users.name,
        shopName: shops.name,
      })
        .from(visitReports)
        .leftJoin(shops, eq(visitReports.shopId, shops.id))
        .leftJoin(users, eq(visitReports.userId, users.id))
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
      sql`${visitReports.createdAt} <= ${dateTo} 23:59:59`,
    ];

    const [data, countResult] = await Promise.all([
      db.select({
        id: visitReports.id,
        shopId: visitReports.shopId,
        userId: visitReports.userId,
        planId: visitReports.planId,
        photos: visitReports.photos,
        checklist: visitReports.checklist,
        competitorNotes: visitReports.competitorNotes,
        createdAt: visitReports.createdAt,
        userName: users.name,
        shopName: shops.name,
      })
        .from(visitReports)
        .leftJoin(shops, eq(visitReports.shopId, shops.id))
        .leftJoin(users, eq(visitReports.userId, users.id))
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
      photos: visitReports.photos,
      checklist: visitReports.checklist,
      competitorNotes: visitReports.competitorNotes,
      createdAt: visitReports.createdAt,
      userName: users.name,
      shopName: shops.name,
      shopAddress: shops.address,
    })
      .from(visitReports)
      .leftJoin(shops, eq(visitReports.shopId, shops.id))
      .leftJoin(users, eq(visitReports.userId, users.id))
      .where(and(eq(visitReports.id, reportId), eq(visitReports.tenantId, tenantId)))
      .limit(1);

    return report ?? null;
  },
};

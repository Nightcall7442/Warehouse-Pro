import { z } from "zod";
import { createRouter, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { visitSchedules, dailyPlans, shops, users } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const scheduleRouter = createRouter({
  /** List schedules, optionally filtered by agent or shop */
  list: supervisorQuery
    .input(z.object({
      agentId: z.number().optional(),
      shopId: z.number().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(visitSchedules.tenantId, ctx.tenant.id)];
      if (input?.agentId) conditions.push(eq(visitSchedules.agentId, input.agentId));
      if (input?.shopId) conditions.push(eq(visitSchedules.shopId, input.shopId));

      return getDb().select({
        id: visitSchedules.id,
        agentId: visitSchedules.agentId,
        agentName: users.name,
        shopId: visitSchedules.shopId,
        shopName: shops.name,
        dayOfWeek: visitSchedules.dayOfWeek,
        active: visitSchedules.active,
      })
        .from(visitSchedules)
        .leftJoin(users, eq(visitSchedules.agentId, users.id))
        .leftJoin(shops, eq(visitSchedules.shopId, shops.id))
        .where(and(...conditions))
        .orderBy(visitSchedules.agentId, visitSchedules.dayOfWeek);
    }),

  /** Create a recurring schedule entry */
  create: supervisorQuery
    .input(z.object({
      agentId: z.number().int().positive(),
      shopId: z.number().int().positive(),
      dayOfWeek: z.number().min(0).max(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await getDb().insert(visitSchedules).values({
        tenantId: ctx.tenant.id,
        agentId: input.agentId,
        shopId: input.shopId,
        dayOfWeek: input.dayOfWeek,
        createdBy: ctx.user.id,
      });
      return { id: Number(result.insertId) };
    }),

  /** Delete a schedule entry */
  delete: supervisorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().delete(visitSchedules)
        .where(and(eq(visitSchedules.id, input.id), eq(visitSchedules.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Generate daily plans from schedules for a date range */
  generatePlans: supervisorQuery
    .input(z.object({
      startDate: z.string(), // YYYY-MM-DD
      endDate: z.string(),
      agentId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const conditions = [eq(visitSchedules.tenantId, tenantId), eq(visitSchedules.active, true)];
      if (input.agentId) conditions.push(eq(visitSchedules.agentId, input.agentId));

      const schedules = await db.select().from(visitSchedules).where(and(...conditions));
      if (schedules.length === 0) return { created: 0, skipped: 0 };

      const start = new Date(input.startDate + "T00:00:00");
      const end = new Date(input.endDate + "T00:00:00");
      const days: Date[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
      }

      // Limit to 90 days to prevent abuse
      if (days.length > 90) return { created: 0, skipped: 0, error: "Максимальный диапазон — 90 дней" };

      let created = 0;
      let skipped = 0;

      for (const day of days) {
        const dow = day.getDay(); // 0=Sunday

        const matchingSchedules = schedules.filter(s => s.dayOfWeek === dow);

        for (const sched of matchingSchedules) {
          // Check if plan already exists
          const [existing] = await db.select({ id: dailyPlans.id })
            .from(dailyPlans)
            .where(and(
              eq(dailyPlans.tenantId, tenantId),
              eq(dailyPlans.agentId, sched.agentId),
              eq(dailyPlans.shopId, sched.shopId),
              eq(dailyPlans.planDate, day),
            ))
            .limit(1);

          if (existing) { skipped++; continue; }

          await db.insert(dailyPlans).values({
            tenantId,
            agentId: sched.agentId,
            shopId: sched.shopId,
            planDate: day,
            status: "planned",
            createdBy: ctx.user.id,
          });
          created++;
        }
      }

      return { created, skipped };
    }),
});

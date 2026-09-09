import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { visitSchedules, dailyPlans, shops, users } from "@db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { affectedRows } from "./lib/db-rows";
import {
  createVisitPlans, daysBetween, daysOnWeekdays, monthBounds, weekdayOf,
  type PlanPair,
} from "./services/visit-planning";

/** Месяц как «ГГГГ-ММ» — вид, в котором его присылают все экраны планирования. */
const monthInput = z.string().regex(/^\d{4}-\d{2}$/, "Месяц задаётся как ГГГГ-ММ");

/** Дни недели: 0 — воскресенье, как в колонке day_of_week. */
const weekdaysInput = z.array(z.number().int().min(0).max(6)).min(1).max(7);

/** Агент существует и он из этой организации. */
async function requireAgent(db: ReturnType<typeof getDb>, tenantId: number, agentId: number) {
  const [agent] = await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId))).limit(1);
  if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });
  return agent;
}

/** Из присланных id магазинов оставить только свои. Чужие молча отбрасываются. */
async function ownShopIds(db: ReturnType<typeof getDb>, tenantId: number, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({ id: shops.id }).from(shops)
    .where(and(inArray(shops.id, [...new Set(ids)]), eq(shops.tenantId, tenantId)));
  return rows.map(r => r.id);
}

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
        .leftJoin(users, and(eq(visitSchedules.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .leftJoin(shops, and(eq(visitSchedules.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
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
      const db = getDb();
      // Расписание пишет tenant_id из ключа вызывающего, а сотрудника и магазин
      // брало из входа как есть: чужой id заводил строку, которая на всех
      // экранах показывалась пустым именем и разворачивалась в планы на чужую
      // точку. Проверка тут же, где и у остальных процедур планирования.
      await requireAgent(db, ctx.tenant.id, input.agentId);
      const [shop] = await ownShopIds(db, ctx.tenant.id, [input.shopId]);
      if (!shop) throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден в вашей организации" });

      const [result] = await db.insert(visitSchedules).values({
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

      const days = daysBetween(input.startDate, input.endDate);
      if (days.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Пустой промежуток: конец раньше начала" });
      if (days.length > 90) throw new TRPCError({ code: "BAD_REQUEST", message: "Максимальный промежуток — 90 дней" });

      const conditions = [eq(visitSchedules.tenantId, tenantId), eq(visitSchedules.active, true)];
      if (input.agentId) conditions.push(eq(visitSchedules.agentId, input.agentId));

      const schedules = await db.select().from(visitSchedules).where(and(...conditions));
      if (schedules.length === 0) return { created: 0, skipped: 0 };

      /*
        Каждый день промежутка ставится своим набором пар — тем, что расписан
        на этот день недели. Раньше здесь на КАЖДУЮ пару шёл отдельный SELECT
        «нет ли уже» и отдельный INSERT: месяц на сорок точек — это почти две
        тысячи запросов подряд, и до конца цикл не доходил.
      */
      let created = 0;
      let skipped = 0;
      for (const dow of new Set(schedules.map(s => s.dayOfWeek))) {
        const dowDays = days.filter(d => weekdayOf(d) === dow);
        if (dowDays.length === 0) continue;
        const pairs: PlanPair[] = schedules
          .filter(s => s.dayOfWeek === dow)
          .map(s => ({ agentId: s.agentId, shopId: s.shopId }));
        const r = await createVisitPlans(db, {
          tenantId, createdBy: ctx.user.id, pairs, days: dowDays,
        });
        created += r.created;
        skipped += r.skipped;
      }

      return { created, skipped };
    }),

  /* ═══════════════════════════════════════════════════════════════════════
     МЕСЯЦ РАЗОМ

     Директор и супервайзер планируют не день, а месяц: «Ахмад — Чиланзар,
     вторник и пятница, весь октябрь». До этого такое собиралось из двадцати
     шести открытий формы «новый план визита», каждое на одну дату.

     Три процедуры на весь месяц: посмотреть (monthOverview), расставить
     (planMonth), убрать ошибочное (clearMonth).
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Месяц целиком: по агенту и по дню — сколько запланировано, посещено,
   * пропущено. Плюс сами агенты, включая тех, у кого на месяц нет ничего:
   * незанятый агент виден именно пустой строкой, а не отсутствием строки.
   */
  monthOverview: supervisorQuery
    .input(z.object({ month: monthInput }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const { start, end, days } = monthBounds(input.month);

      const [agents, grouped, templates] = await Promise.all([
        db.select({ id: users.id, name: users.name }).from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active")))
          .orderBy(users.name)
          .limit(500),
        /*
          Свод, а не строки. Тридцать точек на тридцать дней — это девятьсот
          планов; экрану нужны числа по клеткам, и складывать их должна база.
        */
        db.select({
          agentId: dailyPlans.agentId,
          day:     sql<string>`DATE_FORMAT(${dailyPlans.planDate}, '%Y-%m-%d')`,
          total:   sql<number>`COUNT(*)`,
          visited: sql<number>`SUM(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 ELSE 0 END)`,
          skipped: sql<number>`SUM(CASE WHEN ${dailyPlans.status} = 'skipped' THEN 1 ELSE 0 END)`,
        }).from(dailyPlans)
          .where(and(
            eq(dailyPlans.tenantId, tenantId),
            sql`${dailyPlans.planDate} BETWEEN ${start} AND ${end}`,
          ))
          .groupBy(dailyPlans.agentId, dailyPlans.planDate),
        // Сколько точек стоит в расписании агента — этим экран отличает «месяц
        // не расставлен» от «расставлять нечем, расписания нет».
        db.select({
          agentId: visitSchedules.agentId,
          shops:   sql<number>`COUNT(DISTINCT ${visitSchedules.shopId})`,
        }).from(visitSchedules)
          .where(and(eq(visitSchedules.tenantId, tenantId), eq(visitSchedules.active, true)))
          .groupBy(visitSchedules.agentId),
      ]);

      const templateByAgent = new Map(templates.map(t => [t.agentId, Number(t.shops)]));
      const byAgent = new Map<number, { planned: number; visited: number; skipped: number; byDay: Record<string, { planned: number; visited: number; skipped: number }> }>();
      for (const row of grouped) {
        const total = Number(row.total);
        const visited = Number(row.visited);
        const skipped = Number(row.skipped);
        let entry = byAgent.get(row.agentId);
        if (!entry) { entry = { planned: 0, visited: 0, skipped: 0, byDay: {} }; byAgent.set(row.agentId, entry); }
        entry.planned += total;
        entry.visited += visited;
        entry.skipped += skipped;
        entry.byDay[row.day] = { planned: total, visited, skipped };
      }

      const rows = agents.map(a => {
        const e = byAgent.get(a.id);
        return {
          agentId: a.id,
          agentName: a.name,
          templateShops: templateByAgent.get(a.id) ?? 0,
          planned: e?.planned ?? 0,
          visited: e?.visited ?? 0,
          skipped: e?.skipped ?? 0,
          byDay: e?.byDay ?? {},
        };
      });

      /*
        Планы сотрудника, которого уже нет в списке агентов (уволен, сменил
        роль), иначе исчезли бы из свода вместе с ним, и месяц не сходился бы
        с дневным экраном. Он показывается отдельной строкой без имени.
      */
      for (const [agentId, e] of byAgent) {
        if (rows.some(r => r.agentId === agentId)) continue;
        rows.push({ agentId, agentName: "—", templateShops: 0, ...e });
      }

      return {
        month: input.month,
        days,
        rows,
        totals: rows.reduce(
          (acc, r) => ({ planned: acc.planned + r.planned, visited: acc.visited + r.visited, skipped: acc.skipped + r.skipped }),
          { planned: 0, visited: 0, skipped: 0 },
        ),
      };
    }),

  /**
   * Расставить визиты на весь месяц.
   *
   * Два способа, и они отличаются тем, откуда берутся дни:
   *
   * 1. Магазины заданы (территорией или списком) — каждый из них ставится на
   *    каждый выбранный день недели. Обычный случай: «эта территория — по
   *    вторникам и пятницам».
   * 2. Магазины не заданы — разворачивается уже настроенное расписание агента,
   *    где у каждой точки свои дни. Тогда weekdays не нужны и не смотрятся.
   *
   * Повторный запуск безопасен: то, что уже стоит на этот день, считается
   * пропущенным, а посещённое не переписывается.
   */
  planMonth: supervisorQuery
    .input(z.object({
      agentId: z.number().int().positive(),
      month: monthInput,
      weekdays: weekdaysInput.optional(),
      territoryId: z.number().int().positive().optional(),
      shopIds: z.array(z.number().int().positive()).max(500).optional(),
      /** Запомнить выбор расписанием агента, чтобы следующий месяц ставился одной кнопкой. */
      saveTemplate: z.boolean().default(true),
      /** С какого числа месяца начинать — чтобы не заполнять прошедшие дни. */
      fromDay: z.number().int().min(1).max(31).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const agent = await requireAgent(db, tenantId, input.agentId);
      const { days } = monthBounds(input.month);
      const monthDays = input.fromDay ? days.slice(input.fromDay - 1) : days;
      if (monthDays.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "В месяце не осталось дней после выбранного числа" });
      }

      // ── Какие магазины ────────────────────────────────────────────────────
      let shopIds: number[] = [];
      if (input.territoryId) {
        const rows = await db.select({ id: shops.id }).from(shops)
          .where(and(
            eq(shops.territoryId, input.territoryId),
            eq(shops.tenantId, tenantId),
            eq(shops.status, "active"),
          ));
        shopIds = rows.map(r => r.id);
        if (shopIds.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "На этой территории нет действующих магазинов" });
        }
      } else if (input.shopIds?.length) {
        shopIds = await ownShopIds(db, tenantId, input.shopIds);
        if (shopIds.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ни один из выбранных магазинов не найден в вашей организации" });
        }
      }

      // ── Способ 2: разворачиваем расписание агента ─────────────────────────
      if (shopIds.length === 0) {
        const template = await db.select({ shopId: visitSchedules.shopId, dayOfWeek: visitSchedules.dayOfWeek })
          .from(visitSchedules)
          .where(and(
            eq(visitSchedules.tenantId, tenantId),
            eq(visitSchedules.agentId, input.agentId),
            eq(visitSchedules.active, true),
          ));
        if (template.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "У сотрудника нет расписания. Выберите территорию или магазины и дни недели.",
          });
        }
        let created = 0;
        let skipped = 0;
        const usedDays = new Set<string>();
        const byDow = new Map<number, number[]>();
        for (const t of template) {
          const list = byDow.get(t.dayOfWeek) ?? [];
          list.push(t.shopId);
          byDow.set(t.dayOfWeek, list);
        }
        for (const [dow, dowShops] of byDow) {
          const dowDays = monthDays.filter(d => weekdayOf(d) === dow);
          if (dowDays.length === 0) continue;
          dowDays.forEach(d => usedDays.add(d));
          const r = await createVisitPlans(db, {
            tenantId, createdBy: ctx.user.id,
            pairs: dowShops.map(shopId => ({ agentId: input.agentId, shopId })),
            days: dowDays,
          });
          created += r.created;
          skipped += r.skipped;
        }
        return {
          created, skipped,
          agentName: agent.name,
          shops: new Set(template.map(t => t.shopId)).size,
          days: usedDays.size,
          fromTemplate: true,
        };
      }

      // ── Способ 1: магазины × выбранные дни недели ─────────────────────────
      if (!input.weekdays?.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Выберите хотя бы один день недели" });
      }
      const workDays = daysOnWeekdays(monthDays, input.weekdays);
      if (workDays.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "В этом месяце таких дней нет" });
      }

      if (input.saveTemplate) {
        /*
          Расписание пишется ДО расстановки и повтором не портится: ключ
          (агент, магазин, день недели) уникален, и повторная установка лишь
          возвращает строке active. Иначе второй запуск того же месяца ронял
          бы всю операцию ошибкой дубликата — уже после того, как часть
          визитов встала.
        */
        const template = shopIds.flatMap(shopId => input.weekdays!.map(dayOfWeek => ({
          tenantId, agentId: input.agentId, shopId, dayOfWeek, createdBy: ctx.user.id,
        })));
        for (let i = 0; i < template.length; i += 500) {
          await db.insert(visitSchedules).values(template.slice(i, i + 500))
            .onDuplicateKeyUpdate({ set: { active: true } });
        }
      }

      const result = await createVisitPlans(db, {
        tenantId, createdBy: ctx.user.id,
        pairs: shopIds.map(shopId => ({ agentId: input.agentId, shopId })),
        days: workDays,
      });

      return {
        ...result,
        agentName: agent.name,
        shops: shopIds.length,
        days: workDays.length,
        fromTemplate: false,
      };
    }),

  /**
   * Убрать из месяца незакрытые визиты.
   *
   * Только status = 'planned'. Посещённые и отказы — это уже история работы, и
   * стирать её кнопкой «очистить месяц» нельзя ни при какой ошибке в плане.
   * Ответ говорит, сколько строк осталось нетронутыми, чтобы «удалено 40 из
   * 300» не читалось как поломка.
   */
  clearMonth: supervisorQuery
    .input(z.object({ month: monthInput, agentId: z.number().int().positive().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const { start, end } = monthBounds(input.month);

      const where = [
        eq(dailyPlans.tenantId, tenantId),
        eq(dailyPlans.status, "planned"),
        sql`${dailyPlans.planDate} BETWEEN ${start} AND ${end}`,
      ];
      if (input.agentId) where.push(eq(dailyPlans.agentId, input.agentId));

      const [kept] = await db.select({ n: sql<number>`COUNT(*)` }).from(dailyPlans)
        .where(and(
          eq(dailyPlans.tenantId, tenantId),
          sql`${dailyPlans.status} <> 'planned'`,
          sql`${dailyPlans.planDate} BETWEEN ${start} AND ${end}`,
          ...(input.agentId ? [eq(dailyPlans.agentId, input.agentId)] : []),
        ));

      const result = await db.delete(dailyPlans).where(and(...where));
      return { deleted: affectedRows(result) ?? 0, kept: Number(kept?.n ?? 0) };
    }),
});

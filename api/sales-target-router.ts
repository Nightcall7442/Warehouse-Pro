import { z } from "zod";
import { createRouter, operatorQuery, authedQuery, supervisorQuery, managementQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { salesTargets, users } from "@db/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { cache, CacheKeys } from "./lib/cache";
import { suggestQuotas } from "./services/quota-suggest";
import { actualsForTargets } from "./services/sales-target-actuals";

/**
 * Норму ставят только своему сотруднику.
 *
 * tenant_id строки берётся из ключа вызывающего, а user_id — из входа как
 * есть. Чужой id заводил норму-призрак: она считалась в своде организации, но
 * имя в ней было пустым, потому что соединение с users закрыто по организации.
 * Утечки данных тут нет, а вот числа в сводке портились молча.
 */
async function requireOwnUsers(db: ReturnType<typeof getDb>, tenantId: number, userIds: number[]) {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return;
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, wanted), eq(users.tenantId, tenantId)));
  if (rows.length !== wanted.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });
  }
}

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

      const rows = await db.select({
        id: salesTargets.id,
        userId: salesTargets.userId,
        userName: users.name,
        shopId: salesTargets.shopId,
        territoryId: salesTargets.territoryId,
        periodType: salesTargets.periodType,
        periodStart: salesTargets.periodStart,
        periodEnd: salesTargets.periodEnd,
        targetAmount: salesTargets.targetAmount,
        orderCountTarget: salesTargets.orderCountTarget,
        visitTarget: salesTargets.visitTarget,
        notes: salesTargets.notes,
      }).from(salesTargets)
        .leftJoin(users, and(eq(salesTargets.userId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .where(and(...conditions))
        .orderBy(desc(salesTargets.periodStart));

      /*
        Выполнение считается сейчас, а не читается из колонок actual_*.

        Их заполняет только recalculateActuals, а зовёт её ровно никто: ручка
        есть, кнопки нет ни в вебе, ни в мобильном. То есть в колонках стояли
        умолчания — нули. Агент у себя видел «выполнено на 80 %» (myQuota
        считает вживую), начальник в тот же час видел ноль, и ни один экран не
        сообщал, что числа разной свежести.

        Имена полей прежние: мобильное приложение читает их по именам.
      */
      const actuals = await actualsForTargets(db, ctx.tenant.id, rows.map(r => r.id));

      return rows.map(r => {
        const a = actuals.get(r.id);
        return {
          ...r,
          actualAmount: (a?.revenue ?? 0).toFixed(2),
          actualOrderCount: a?.orderCount ?? 0,
          actualVisitPct: (a?.visitPct ?? 0).toFixed(2),
        };
      });
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
      await requireOwnUsers(db, ctx.tenant.id, [input.userId]);

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
      await requireOwnUsers(db, ctx.tenant.id, input.targets.map(t => t.userId));
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

      /*
        Тот же счёт, что и у экранов, — и это главное здесь.

        Раньше эта ручка считала по-своему: два запроса на каждый план, свои
        границы периода, свой разбор визитов. Экраны читали её колонки, а агент
        видел третье число, посчитанное в myQuota. Расхождение между тремя
        расчётами одного и того же нельзя ни объяснить, ни проверить.

        Снимок в колонках больше никем не читается: list и summary считают
        вживую. Он остаётся как след «на какой момент сходилось» и обновляется
        одним и тем же счётом — иначе рано или поздно его кто-нибудь прочтёт и
        получит своё, четвёртое число.
      */
      const actuals = await actualsForTargets(db, ctx.tenant.id, targets.map(t => t.id));

      for (const target of targets) {
        const a = actuals.get(target.id);
        await db.update(salesTargets)
          .set({
            actualAmount: (a?.revenue ?? 0).toFixed(2),
            actualOrderCount: a?.orderCount ?? 0,
            actualVisitPct: (a?.visitPct ?? 0).toFixed(2),
          })
          .where(eq(salesTargets.id, target.id));
      }

      return { success: true, updated: targets.length };
    }),

  /*
    Подсказка норм по трёхмесячной истории.

    Была уровня оператора — то есть директору и оператору, но НЕ супервайзеру.
    Нормы при этом ставит именно супервайзер (upsert и bulkUpsert открыты ему),
    и на его экране кнопка «подсказать» отвечала бы отказом. Здесь читается
    только сводная история агентов, которую он и так видит в KPI.
  */
  autoSuggest: managementQuery
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

      const [target] = await db.select({
        id: salesTargets.id,
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

      /*
        Выполнение считается тем же счётом, что и на экранах начальника.

        Здесь стоял свой расчёт: свои границы периода, свой разбор визитов,
        свои два запроса. Начальник читал колонки actual_*, которые никто не
        заполняет, — и видел ноль там, где агент видел восемьдесят процентов.
        Пока расчёта было два, спорить об этом можно было бесконечно.

        Границы периода берутся из самой строки плана — так же, как в общем
        счёте. Прежний запасной вариант «periodEnd ?? конец месяца» был мёртв:
        колонка period_end объявлена NOT NULL.
      */
      const actuals = await actualsForTargets(db, ctx.tenant.id, [target.id]);
      const a = actuals.get(target.id);

      const revenueTarget = Number(target.targetAmount);
      const revenueActual = a?.revenue ?? 0;
      const orderTarget = target.orderCountTarget ?? 0;
      const orderActual = a?.orderCount ?? 0;
      const visitTgt = target.visitTarget ? Number(target.visitTarget) : 0;
      const visitAct = a?.visitPct ?? 0;

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
        id: salesTargets.id,
        userId: salesTargets.userId,
        userName: users.name,
        targetAmount: salesTargets.targetAmount,
        orderCountTarget: salesTargets.orderCountTarget,
        visitTarget: salesTargets.visitTarget,
      }).from(salesTargets)
        .leftJoin(users, and(eq(salesTargets.userId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.periodType, "monthly"),
          sql`${salesTargets.periodStart} >= ${monthStart}`,
          sql`${salesTargets.periodEnd} <= ${monthEnd}`,
        ));

      // Те же живые числа, что и в list, и по той же причине — см. там.
      const actuals = await actualsForTargets(db, ctx.tenant.id, targets.map(t => t.id));

      return targets.map(t => {
        const a = actuals.get(t.id);
        const actualAmount = (a?.revenue ?? 0).toFixed(2);
        const actualOrderCount = a?.orderCount ?? 0;
        const actualVisitPct = (a?.visitPct ?? 0).toFixed(2);
        return {
          ...t,
          actualAmount,
          actualOrderCount,
          actualVisitPct,
          revenueCompletion: Number(t.targetAmount) > 0
            ? Math.round((Number(actualAmount) / Number(t.targetAmount)) * 100)
            : 0,
          orderCompletion: t.orderCountTarget && Number(t.orderCountTarget) > 0
            ? Math.round((actualOrderCount / Number(t.orderCountTarget)) * 100)
            : null,
          visitCompletion: t.visitTarget && Number(t.visitTarget) > 0
            ? Number(actualVisitPct)
            : null,
        };
      });
    }),
});

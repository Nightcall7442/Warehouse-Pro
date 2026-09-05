import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, fieldSalesQuery, supervisorQuery, selfKpiQuery, managementQuery, financeQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { getPeriod } from "./lib/period";
import { onDate } from "./lib/date-range";
import { calculateAgentKpi, calculateAllAgentsKpi, calculateSalary, getAgentList } from "./services/kpi";
import { withCache, CacheTTL, cache, CacheKeys } from "./lib/cache";
import { recordAudit } from "./services/audit-log";
import { getClientIp } from "./lib/rate-limit";
import { commissions, salaryPayouts, salesTargets, shops, users } from "@db/schema";
import { alias } from "drizzle-orm/mysql-core";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";

export const kpiRouter = createRouter({
  /*
    selfKpiQuery, а не fieldSalesQuery: сюда добавлен курьер.

    Запрос отдаёт только собственные числа вызывающего — ctx.user.id ниже, —
    поэтому расширение никому не открывает чужого. Курьеру считаются его
    доставки (orders.courier_id) и собранные им деньги (payments.created_by);
    визиты и заказы у него выходят нулями, и страница их ему не показывает.
  */
  agentKpi: selfKpiQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);
      const cacheKey = `kpi:agent:${ctx.tenant.id}:${ctx.user.id}:${period}`;

      return withCache(cacheKey, CacheTTL.kpis, () =>
        calculateAgentKpi(db, ctx.user.id, ctx.tenant.id, periodStart, periodEnd));
    }),

  supervisorKpi: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);
      const cacheKey = `kpi:supervisor:${ctx.tenant.id}:${period}`;

      return withCache(cacheKey, CacheTTL.kpis, () =>
        calculateAllAgentsKpi(db, ctx.tenant.id, periodStart, periodEnd));
    }),

  /*
    managementQuery, а не supervisorQuery: сюда добавлен оператор.

    Решение владельца: оператора считать наравне с директором. И раньше
    страница KPI уже считала его начальником — запрашивала список агентов и
    их разбор, — а сервер эти запросы отклонял. Пункт «KPI» в его нижней
    панели всегда вёл в «не удалось загрузить», и «Повторить» повторяло тот
    же отказ: заявка отклонена не сбоем, а правами.
  */
  agentList: managementQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      return getAgentList(db, ctx.tenant.id, periodStart, periodEnd);
    }),

  // Тот же набор ролей, что и у списка выше.
  agentDetail: managementQuery
    .input(z.object({
      agentId: z.number().int().positive(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input.period);

      return calculateAgentKpi(db, input.agentId, ctx.tenant.id, periodStart, periodEnd);
    }),

  // Тот же набор ролей, что и у списка выше.
  territoryKpi: managementQuery
    .input(z.object({
      territoryId: z.number().int().positive(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input.period);

      // Get unique agents in this territory
      const territoryAgentRows = await db.select({ agentId: shops.agentId })
        .from(shops)
        .where(and(
          eq(shops.tenantId, ctx.tenant.id),
          eq(shops.territoryId, input.territoryId),
          eq(shops.status, "active"),
          sql`${shops.agentId} IS NOT NULL`,
        ))
        .groupBy(shops.agentId);

      const agentIds = territoryAgentRows.map(r => r.agentId).filter(Boolean) as number[];

      if (agentIds.length === 0) {
        return {
          territoryId: input.territoryId,
          agentCount: 0,
          avgScore: 0,
          totalRevenue: 0,
          totalOrders: 0,
          totalVisits: 0,
          agents: [],
        };
      }

      const allKpi = await Promise.all(
        agentIds.map(id => calculateAgentKpi(db, id, ctx.tenant.id, periodStart, periodEnd))
      );

      const totalRevenue = allKpi.reduce((s, k) => s + k.revenue, 0);
      const totalOrders = allKpi.reduce((s, k) => s + k.orderCount, 0);
      const totalVisits = allKpi.reduce((s, k) => s + k.visitedPlans, 0);
      const avgScore = allKpi.length > 0 ? Math.round(allKpi.reduce((s, k) => s + k.kpiScore, 0) / allKpi.length) : 0;

      return {
        territoryId: input.territoryId,
        agentCount: allKpi.length,
        avgScore,
        totalRevenue,
        totalOrders,
        totalVisits,
        agents: allKpi.sort((a, b) => b.kpiScore - a.kpiScore),
      };
    }),

  salary: fieldSalesQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      // Only the "month" view is allowed to write back to the agent's one
      // canonical monthly commission record — a "week"/"quarter" view still
      // computes and shows live numbers, just doesn't persist them over it.
      return calculateSalary(db, ctx.user.id, ctx.tenant.id, periodStart, periodEnd, undefined, period === "month");
    }),

  salaryReport: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
      // Сколько периодов назад: 0 — текущий, 1 — прошлый. Двух лет назад
      // хватает; дальше это уже не зарплата, а архив.
      offset: z.number().int().min(0).max(36).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period, input?.offset ?? 0);

      /*
        Все, кому платят, а не только агенты.

        Здесь стояло role = "agent", и отчёт по зарплатам показывал лишь их.
        Директору платить приходится всей команде: у оператора и супервайзера
        зарплата выходит фиксированной сама собой (комиссия считается
        процентом от заказов, которые человек ОФОРМИЛ, а они их не
        оформляют), у курьера — так же. Не показывать их означало бы, что
        фонд оплаты на экране не сходится с тем, что уходит из кассы.

        Суперадминистратор исключён: он сотрудник платформы, а не этой
        организации, и в её фонде ему делать нечего.
      */
      const agentsList = await db.select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(
          eq(users.tenantId, ctx.tenant.id),
          eq(users.status, "active"),
          sql`${users.role} <> 'superadmin'`,
        ))
        .orderBy(users.name);

      const kpis = await calculateAllAgentsKpi(db, ctx.tenant.id, periodStart, periodEnd);

      const kpiMap = new Map(kpis.map(k => [k.agentId, k]));

      const salaries = await Promise.all(
        agentsList.map(agent =>
          calculateSalary(db, agent.id, ctx.tenant.id, periodStart, periodEnd, kpiMap.get(agent.id), period === "month")
            // Роль нужна экрану: она объясняет, почему у одного вся выплата —
            // оклад, а у другого больше половины набежало комиссией.
            .then(salary => ({ ...salary, agentName: agent.name, role: agent.role }))
        )
      );

      return salaries;
    }),

  /*
    Выплаты: кому и когда деньги отдали.

    salaryReport выше считает НАЧИСЛЕННОЕ — сколько человеку причитается за
    период. Отданное на руки он не знает и знать не может: это отдельное
    событие, которого в системе не было вовсе. Учёт вёлся на стороне, и спор
    «мне за март не платили» разрешать было нечем.

    Аванс от выплаты отличается только тем, что выдан до конца периода;
    остаток к выдаче он уменьшает так же, поэтому это вид записи, а не
    отдельная сущность.

    Только руководителю: это деньги всей команды.
  */
  payouts: financeQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
      offset: z.number().int().min(0).max(36).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input?.period ?? "month", input?.offset ?? 0);
      // Второе имя той же таблицы: получатель и выдавший — оба сотрудники.
      const payer = alias(users, "payer");

      return db.select({
        id:         salaryPayouts.id,
        userId:     salaryPayouts.userId,
        userName:   users.name,
        kind:       salaryPayouts.kind,
        amount:     salaryPayouts.amount,
        paidAt:     salaryPayouts.paidAt,
        note:       salaryPayouts.note,
        paidByName: payer.name,
      })
        .from(salaryPayouts)
        .innerJoin(users, eq(salaryPayouts.userId, users.id))
        .leftJoin(payer, eq(salaryPayouts.createdBy, payer.id))
        .where(and(
          eq(salaryPayouts.tenantId, ctx.tenant.id),
          gte(salaryPayouts.paidAt, periodStart),
          lte(salaryPayouts.paidAt, periodEnd),
        ))
        .orderBy(desc(salaryPayouts.paidAt));
    }),

  /*
    Записать выдачу. Запись только добавляется: ни изменения, ни удаления
    здесь нет намеренно — на этом держится ценность журнала. Ошибочную
    выдачу гасят встречной записью с отрицательной суммой и пояснением, а не
    подчисткой задним числом.
  */
  recordPayout: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      // Строкой, как и остальные деньги в проекте: число с плавающей точкой
      // по дороге теряет копейки, а decimal(14,2) их хранит.
      amount: z.string().refine(v => Number.isFinite(Number(v)) && Number(v) !== 0, "Сумма должна быть числом"),
      kind: z.enum(["payout", "advance"]).default("payout"),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      /*
        Получатель — сотрудник ЭТОЙ организации. Внешний ключ этого не
        проверяет: таблица users общая на все организации, и без проверки
        руководитель одной мог бы записать выдачу человеку из другой.
      */
      const [person] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(
          eq(users.id, input.userId),
          eq(users.tenantId, ctx.tenant.id),
          sql`${users.role} <> 'superadmin'`,
        ))
        .limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });

      const [result] = await db.insert(salaryPayouts).values({
        tenantId:  ctx.tenant.id,
        userId:    person.id,
        kind:      input.kind,
        amount:    input.amount,
        note:      input.note?.trim() || null,
        createdBy: ctx.user.id,
      });

      // След на случай спора: кто выдал, кому, сколько и когда.
      await recordAudit(db, {
        tenantId:   ctx.tenant.id,
        actorId:    ctx.user.id,
        actorName:  ctx.user.name,
        action:     input.kind === "advance" ? "salary.advance" : "salary.payout",
        targetType: "user",
        targetId:   person.id,
        meta:       { amount: input.amount, userName: person.name, note: input.note ?? null },
        ip:         getClientIp(ctx.req) ?? undefined,
      });

      return { id: Number(result.insertId) };
    }),

  /*
    Задать оклад и ставку комиссии.

    Оклад лежит в salesTargets, ставка — в commissions, и задать их можно
    было только на других экранах: на зарплатах человек с пустым окладом
    показывался строкой «оклад не задан», а куда идти дальше, экран не
    говорил. Здесь обе величины ставятся там же, где их видно.

    Обе — с ТЕКУЩЕГО месяца, даже если открыт прошлый: задним числом
    менять закрытый период значит переписывать то, по чему уже заплатили.
  */
  setSalary: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      baseSalary: z.number().min(0).max(1e12),
      commissionRate: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [person] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(
          eq(users.id, input.userId),
          eq(users.tenantId, ctx.tenant.id),
          sql`${users.role} <> 'superadmin'`,
        ))
        .limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });

      const now = new Date();
      // Колонки period_start/period_end — DATE. Драйверу отдаём строку:
      // Date он развернул бы в часовом поясе сервера и мог сдвинуть день.
      const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEnd   = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const [existingTarget] = await db.select({ id: salesTargets.id })
        .from(salesTargets)
        .where(and(
          eq(salesTargets.tenantId, ctx.tenant.id),
          eq(salesTargets.userId, person.id),
          eq(salesTargets.periodType, "monthly"),
          onDate(salesTargets.periodStart, monthStart),
        ))
        .limit(1);

      if (existingTarget) {
        await db.update(salesTargets)
          .set({ targetAmount: input.baseSalary.toFixed(2) })
          .where(eq(salesTargets.id, existingTarget.id));
      } else {
        await db.insert(salesTargets).values({
          tenantId:     ctx.tenant.id,
          userId:       person.id,
          periodType:   "monthly",
          periodStart:  sql`${monthStart}`,
          periodEnd:    sql`${monthEnd}`,
          targetAmount: input.baseSalary.toFixed(2),
        });
      }

      if (input.commissionRate != null) {
        const [existingRate] = await db.select({ id: commissions.id })
          .from(commissions)
          .where(and(
            eq(commissions.tenantId, ctx.tenant.id),
            eq(commissions.userId, person.id),
            eq(commissions.periodType, "monthly"),
            onDate(commissions.periodStart, monthStart),
          ))
          .limit(1);

        if (existingRate) {
          await db.update(commissions)
            .set({ commissionRate: input.commissionRate.toFixed(2) })
            .where(eq(commissions.id, existingRate.id));
        } else {
          await db.insert(commissions).values({
            tenantId:       ctx.tenant.id,
            userId:         person.id,
            commissionRate: input.commissionRate.toFixed(2),
            periodType:     "monthly",
            periodStart:    sql`${monthStart}`,
            periodEnd:      sql`${monthEnd}`,
            salesAmount:      "0.00",
            commissionAmount: "0.00",
          });
        }
      }

      cache.invalidate(CacheKeys.salesTargets(ctx.tenant.id));
      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));

      await recordAudit(db, {
        tenantId:   ctx.tenant.id,
        actorId:    ctx.user.id,
        actorName:  ctx.user.name,
        action:     "salary.rate_set",
        targetType: "user",
        targetId:   person.id,
        meta:       { baseSalary: input.baseSalary, commissionRate: input.commissionRate ?? null, userName: person.name },
        ip:         getClientIp(ctx.req) ?? undefined,
      });

      return { success: true };
    }),
});

/** Дата в виде YYYY-MM-DD по местному времени — как её хранят DATE-колонки. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


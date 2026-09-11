import { z } from "zod";
import { monthRange } from "./lib/period";
import { TRPCError } from "@trpc/server";
import { createRouter, supervisorQuery, selfKpiQuery, managementQuery, financeQuery, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { getPeriod } from "./lib/period";
import { onDate } from "./lib/date-range";
import { calculateAgentKpi, calculateAllAgentsKpi, calculateCourierStats, calculateSalary, getAgentList, getCourierList, getCourierDaily } from "./services/kpi";
import { withCache, CacheTTL, cache, CacheKeys } from "./lib/cache";
import { recordAudit } from "./services/audit-log";
import { getClientIp } from "./lib/rate-limit";
import { commissions, salaryPayouts, shops, users } from "@db/schema";
import { NotificationService } from "./services/NotificationService";
import { sendPushToUser } from "./services/push-service";
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

  /**
   * Показатели курьера.
   *
   * Отдельно от agentKpi, потому что меряется другое: агентский расчёт считает
   * визиты, планы и оформленные заказы, а у курьера нет ни одного из них.
   * Прогони его через агентский — получишь ноль по всем строкам и оценку «F»,
   * причём не за плохую работу, а за то, что меряли не тем.
   */
  courierKpi: selfKpiQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
      /* Директор смотрит чужие показатели, курьер — только свои. */
      courierId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      const canSeeOthers = ctx.user.role === "ceo" || ctx.user.role === "operator" || ctx.user.role === "supervisor";
      const courierId = canSeeOthers && input?.courierId ? input.courierId : ctx.user.id;

      const cacheKey = `kpi:courier:${ctx.tenant.id}:${courierId}:${period}`;
      return withCache(cacheKey, CacheTTL.kpis, () =>
        calculateCourierStats(db, courierId, ctx.tenant.id, periodStart, periodEnd));
    }),

  /*
    Свод KPI по всем агентам жил здесь второй ручкой и не вызывался ниоткуда.

    Отвечает на него agentList, и отвечает ЛУЧШЕ: он собирает показатели
    групповыми запросами, а этот звал расчёт по каждому агенту отдельно —
    на два десятка человек это два десятка наборов запросов вместо шести.

    Хуже того, два пути к одному числу — это две формулы, которые уже
    расходились: балл в списке считался без штрафа за фрод, пока это не
    свели в kpiScoreOf.
  */

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

  /*
    Список курьеров — тем же, кому открыт список агентов.

    Отдельной ручкой, а не полем в agentList: у курьера другие показатели, и
    подмешать его в агентский список значило бы отдать экрану строку с
    четырьмя нулями и оценкой «F» на человеке, который весь месяц возил.
  */
  courierList: managementQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input?.period ?? "month");
      return getCourierList(db, ctx.tenant.id, periodStart, periodEnd);
    }),

  /**
   * Разбор по одному курьеру — то же, что agentDetail у агента.
   *
   * Одной ручкой, а не тремя: карточке нужны показатели, оплата и ход по дням
   * сразу, и три отдельных запроса на один клик — три ожидания вместо одного.
   *
   * Расчёт зарплаты здесь НЕ записывается (persist = false): руководитель
   * смотрит чужую карточку, и просмотр не должен ничего менять в чужих
   * строках. Курьеру она и так не пишется, но полагаться на это молча нельзя.
   */
  courierDetail: managementQuery
    .input(z.object({
      courierId: z.number().int().positive(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input.period);

      const [who] = await db.select({ id: users.id, role: users.role })
        .from(users)
        .where(and(
          eq(users.id, input.courierId),
          eq(users.tenantId, ctx.tenant.id),
        ))
        .limit(1);

      // Чужой сотрудник и просто «не курьер» — оба случая отвечают отказом, а
      // не пустой карточкой: пустая читается как «ничего не возил».
      if (!who || who.role !== "courier") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Курьер не найден в вашей организации" });
      }

      const [stats, salary, daily] = await Promise.all([
        calculateCourierStats(db, input.courierId, ctx.tenant.id, periodStart, periodEnd),
        calculateSalary(db, input.courierId, ctx.tenant.id, periodStart, periodEnd, undefined, false),
        getCourierDaily(db, input.courierId, ctx.tenant.id, periodStart, periodEnd),
      ]);

      return { stats, salary, daily };
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

  /*
    selfKpiQuery, а не fieldSalesQuery: в этом списке НЕ БЫЛО КУРЬЕРА.

    Экран показателей запрашивает зарплату у всех, кроме начальства, — то есть
    и у курьера, — а сервер отвечал ему отказом по правам. Блок «Зарплата за
    период» в CourierKpiView рисуется по `salary &&`, поэтому отказ выглядел
    не ошибкой, а отсутствием блока: курьер просто не видел своей зарплаты и
    считал, что её не показывают.

    Вместе с ней он не видел и обеда с дорожными — то есть настройки, ради
    которой всё и затевалось, для того человека, о котором она.

    Расширение никому не открывает чужого: запрос считает СТРОГО ctx.user.id.
    Тот же вид процедуры стоит у agentKpi и courierKpi рядом, и по той же
    причине.
  */
  salary: selfKpiQuery
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
        confirmedAt: salaryPayouts.confirmedAt,
        paidByName: payer.name,
      })
        .from(salaryPayouts)
        .innerJoin(users, and(eq(salaryPayouts.userId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .leftJoin(payer, and(eq(salaryPayouts.createdBy, payer.id), eq(payer.tenantId, ctx.tenant.id)))
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

      /*
        Сказать человеку, что деньги выданы.

        Без этого выплата была событием в одну сторону: руководитель записал,
        а сотрудник об этом не узнал — и подтверждать ему было нечего. Здесь
        начинается вторая половина, которую просил арендатор: «сотрудник
        получает уведомление и подтверждение о получении».

        Ссылка ведёт на его собственный экран показателей: там же лежит расчёт
        зарплаты, и подтверждать выдачу человек будет рядом с суммой, из
        которой она сложилась.

        Отправка не в транзакции и падать не должна: запись выплаты уже
        сделана, и потерять её из-за недоступного уведомления нельзя. Внутри
        NotificationService ошибки и так гасятся.
      */
      const title = input.kind === "advance" ? "Выдан аванс" : "Выдана зарплата";

      await NotificationService.create(db, {
        tenantId: ctx.tenant.id,
        userId:   person.id,
        type:     "payment",
        title,
        message:  `${input.amount} — подтвердите получение`,
        link:     "/agent-kpi",
      });

      /*
        И на телефон тоже.

        NotificationService кладёт строку в базу и толкает её в SSE — этого
        хватает вебу, но не приложению: экрана уведомлений в нём нет, SSE оно
        не слушает, и строка до человека просто не доходит. А зарплату
        получают как раз агенты и курьеры, то есть те, у кого веба нет вовсе.

        Толчок ничего не требует от приложения: токен оно регистрирует само
        (user.registerPushToken), а текст приходит с сервера — пересобирать
        ради этого нечего.

        Ошибки гасятся: деньги уже выданы и запись сделана, и потерять её
        из-за недоступного Expo нельзя. Нет токена — sendPushToUser молча
        выходит.
      */
      sendPushToUser(person.id, {
        title,
        body: `${input.amount} — подтвердите получение`,
        data: { type: "salary.paid", kind: input.kind },
      }).catch(() => {});

      return { id: Number(result.insertId) };
    }),

  /*
    Мои выплаты — то, что человек видит про СЕБЯ.

    kpi.payouts выше отдаёт выплаты всей команды и открыт только руководителю:
    сколько получает сосед, сотруднику знать незачем. А своё он должен видеть
    обязательно — иначе подтверждать нечего.

    authedQuery, а не роль: зарплату получают все, включая кладовщика и
    оператора, а список жёстко сужен до ctx.user.id.
  */
  myPayouts: authedQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
      offset: z.number().int().min(0).max(36).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input?.period ?? "month", input?.offset ?? 0);

      return db.select({
        id:          salaryPayouts.id,
        kind:        salaryPayouts.kind,
        amount:      salaryPayouts.amount,
        paidAt:      salaryPayouts.paidAt,
        note:        salaryPayouts.note,
        confirmedAt: salaryPayouts.confirmedAt,
      })
        .from(salaryPayouts)
        .where(and(
          eq(salaryPayouts.tenantId, ctx.tenant.id),
          eq(salaryPayouts.userId, ctx.user.id),
          gte(salaryPayouts.paidAt, periodStart),
          lte(salaryPayouts.paidAt, periodEnd),
        ))
        .orderBy(desc(salaryPayouts.paidAt));
    }),

  /*
    «Деньги получил» — от самого сотрудника.

    Единственное изменение записи выплаты, которое вообще разрешено, и оно
    ничего не меняет в деньгах: ни суммы, ни вида, ни даты. Поэтому оно не
    ломает правило «записи только добавляются» — журнал остаётся неизменяемым
    в той части, ради которой заведён.

    Условие по user_id обязательно: без него любой сотрудник подтверждал бы
    чужие выплаты, и подпись переставала бы что-либо значить.

    Подтверждать повторно нечего — условие `confirmed_at IS NULL` не даёт
    переписать время первого подтверждения вторым нажатием. Именно оно, а не
    сам факт, отвечает на вопрос «когда он подтвердил».
  */
  confirmPayout: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(salaryPayouts)
        .set({ confirmedAt: sql`NOW()` })
        .where(and(
          eq(salaryPayouts.id, input.id),
          eq(salaryPayouts.tenantId, ctx.tenant.id),
          eq(salaryPayouts.userId, ctx.user.id),
          sql`${salaryPayouts.confirmedAt} IS NULL`,
        ));
      return { success: true };
    }),

  /*
    Задать оклад и ставку комиссии.

    Оклад и ставка лежат в одной строке commissions (оклад раньше жил в
    salesTargets и смешивался с планом продаж), и задать их можно
    было только на других экранах: на зарплатах человек с пустым окладом
    показывался строкой «оклад не задан», а куда идти дальше, экран не
    говорил. Здесь обе величины ставятся там же, где их видно.

    Обе — с ТЕКУЩЕГО месяца, даже если открыт прошлый: задним числом
    менять закрытый период значит переписывать то, по чему уже заплатили.
  */
  /*
    Утвердить (или снять) вычет за подозрительные визиты за месяц.

    Сумма пишется в строку условий оплаты за этот месяц; расчёт вычитает
    только её. Утверждённый или оплаченный период менять нельзя — по нему
    уже заплатили.
  */
  setFraudDeduction: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      // Сколько месяцев назад: 0 — текущий, 1 — прошлый.
      offset: z.number().int().min(0).max(36).default(0),
      // null — снять вычет.
      amount: z.number().min(0).max(1e12).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [person] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.tenantId, ctx.tenant.id), sql`${users.role} <> 'superadmin'`))
        .limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });

      const now = new Date();
      const { start: monthStart, end: monthEnd } = monthRange(new Date(now.getFullYear(), now.getMonth() - input.offset, 1));
      const [terms] = await db.select({ id: commissions.id, status: commissions.status })
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.userId, person.id),
          eq(commissions.periodType, "monthly"),
          onDate(commissions.periodStart, monthStart),
        ))
        .limit(1);
      if (terms && terms.status !== "pending") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Период уже закрыт — по нему заплатили" });
      }
      const value = input.amount == null ? null : input.amount.toFixed(2);
      if (terms) {
        await db.update(commissions).set({ fraudDeduction: value }).where(eq(commissions.id, terms.id));
      } else if (value != null) {
        await db.insert(commissions).values({
          tenantId: ctx.tenant.id, userId: person.id, periodType: "monthly",
          periodStart: sql`${monthStart}`, periodEnd: sql`${monthEnd}`,
          fraudDeduction: value,
        });
      }
      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));
      await recordAudit(db, {
        tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name,
        action: "salary.fraud_deduction", targetType: "user", targetId: person.id,
        meta: { userName: person.name, month: monthStart, amount: input.amount },
      });
      return { success: true };
    }),

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

      // Колонки period_start/period_end — DATE. Драйверу отдаём строку:
      // Date он развернул бы в часовом поясе сервера и мог сдвинуть день.
      // Считал это место правильно, но своей копией арифметики; теперь ключ
      // общий со всеми, кто пишет и читает те же строки.
      const { start: monthStart, end: monthEnd } = monthRange();

      // Оклад и ставка — одна строка условий оплаты на месяц. Строка
      // заводится, если её нет; ставка меняется только когда передана.
      const [existingTerms] = await db.select({ id: commissions.id })
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.userId, person.id),
          eq(commissions.periodType, "monthly"),
          onDate(commissions.periodStart, monthStart),
        ))
        .limit(1);

      if (existingTerms) {
        await db.update(commissions)
          .set({
            baseSalary: input.baseSalary.toFixed(2),
            ...(input.commissionRate != null ? { commissionRate: input.commissionRate.toFixed(2) } : {}),
          })
          .where(eq(commissions.id, existingTerms.id));
      } else {
        await db.insert(commissions).values({
          tenantId:       ctx.tenant.id,
          userId:         person.id,
          baseSalary:     input.baseSalary.toFixed(2),
          commissionRate: (input.commissionRate ?? 0).toFixed(2),
          periodType:     "monthly",
          periodStart:    sql`${monthStart}`,
          periodEnd:      sql`${monthEnd}`,
          salesAmount:      "0.00",
          commissionAmount: "0.00",
        });
      }

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

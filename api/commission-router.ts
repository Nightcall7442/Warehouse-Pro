import { z } from "zod";
import { monthRange, dayKey } from "./lib/period";
import { TRPCError } from "@trpc/server";
import { createRouter, operatorQuery, authedQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { commissions, users, products, commissionProductRates } from "@db/schema";
import { eq, and, gte, lte, desc, isNull , inArray, sql } from "drizzle-orm";
import { onDate } from "./lib/date-range";
import { REVENUE_ORDER_STATUSES } from "./lib/order-status";
import { returnsInPeriod, returnedByAgent, returnedOf } from "./services/revenue-returns";
import { cache, CacheKeys } from "./lib/cache";
import { rateRows } from "./services/commission-base";

/**
 * Проверить, что сотрудник, которому назначают ставку, из этой организации.
 *
 * userId приходит от клиента, а таблица users общая для всей платформы. Раньше
 * он записывался как есть: оператор организации A перебором звал setRate для
 * чужих идентификаторов, строки ложились с его же tenant_id — и list, который
 * соединялся с users без условия по организации, возвращал имена владельцев
 * чужих аккаунтов, включая суперадминов платформы. Побочно calculate начинал
 * считать выручку по этим чужим id и засорял ведомость.
 *
 * Это половина защиты. Вторая стоит на чтении, в соединении list с users: в
 * базе уже лежат строки, записанные до этой правки, и молча им доверять
 * нельзя.
 *
 * Имени чужого сотрудника в тексте ошибки нет намеренно — иначе само
 * сообщение стало бы тем каналом утечки, который мы закрываем.
 */
async function assertUserBelongsToTenant(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  userId: number,
): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Сотрудник не найден в вашей организации" });
  }
}

export const commissionRouter = createRouter({
  // List commissions for a period
  list: authedQuery
    .input(z.object({
      periodType: z.enum(["monthly", "quarterly"]).optional(),
      userId: z.number().optional(),
      status: z.enum(["pending", "approved", "paid"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(commissions.tenantId, ctx.tenant.id)];

      // What somebody earns is their own business and their manager's. This
      // runs under authedQuery and the KPI page that calls it is open to
      // agents, couriers and merchandisers — so without this an agent could
      // read every colleague's commission, and pass userId to pick one.
      // Narrowed rather than forbidden: their own row is exactly what that
      // page is for.
      const seesEveryone = ["ceo", "operator", "supervisor"].includes(ctx.user.role);
      if (!seesEveryone) conditions.push(eq(commissions.userId, ctx.user.id));

      if (input?.periodType) conditions.push(eq(commissions.periodType, input.periodType));
      if (input?.userId && seesEveryone) conditions.push(eq(commissions.userId, input.userId));
      if (input?.status) conditions.push(eq(commissions.status, input.status));

      return db.select({
        id: commissions.id,
        userId: commissions.userId,
        userName: users.name,
        commissionRate: commissions.commissionRate,
        // Без неё экран настроек не знал бы, что у курьера уже стоит, и
        // показывал бы ноль поверх заведённой ставки.
        deliveryRate: commissions.deliveryRate,
        courierPayMode: commissions.courierPayMode,
        mealAllowance: commissions.mealAllowance,
        travelAllowance: commissions.travelAllowance,
        periodType: commissions.periodType,
        periodStart: commissions.periodStart,
        periodEnd: commissions.periodEnd,
        salesAmount: commissions.salesAmount,
        commissionAmount: commissions.commissionAmount,
        status: commissions.status,
      }).from(commissions)
        // Условие по организации во втором аргументе соединения, а не в WHERE:
        // соединение левое, и перенос условия в WHERE отбросил бы строки с
        // чужим user_id целиком вместо того, чтобы показать их без имени.
        // Без этого условия имя бралось из users по всей платформе: строка,
        // записанная до появления проверки в setRate, отдавала имя владельца
        // чужого аккаунта.
        .leftJoin(users, and(eq(commissions.userId, users.id), eq(users.tenantId, ctx.tenant.id)))
        .where(and(...conditions))
        .orderBy(desc(commissions.periodStart));
    }),

  // Set commission rate for a user
  setRate: operatorQuery.use(can("commission.manage"))
    .input(z.object({
      userId: z.number(),
      commissionRate: z.number().min(0).max(100),
      /*
        Сумма за одну доставку, в сумах. У курьера процент бессмыслен: сумму
        заказа он не назначает и на неё не влияет, а везёт одинаково — что
        коробку на сто тысяч, что на миллион.
      */
      deliveryRate: z.number().min(0).max(100_000_000).optional(),
      /*
        Чем платить курьеру. Не передали — способ не меняем: экран ставок
        агента ничего про него не знает и обнулять чужую настройку не должен.
      */
      courierPayMode: z.enum(["per_delivery", "percent"]).optional(),
      /*
        Обед и дорожные — суммы ЗА ОДИН РАБОЧИЙ ДЕНЬ, в сумах.

        Не передали — не трогаем, тем же правилом, что и остальные ставки:
        экран, который про них не знает, не должен их обнулять.
      */
      mealAllowance: z.number().min(0).max(100_000_000).optional(),
      travelAllowance: z.number().min(0).max(100_000_000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      await assertUserBelongsToTenant(db, ctx.tenant.id, input.userId);

      // Update or create monthly commission record for current period.
      // Ключ месяца — общий с расчётом зарплаты (api/services/kpi.ts): две
      // строки за один месяц означали бы две оплаченные комиссии.
      const { start: monthStart, end: monthEnd } = monthRange();

      const [existing] = await db.select()
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.userId, input.userId),
          eq(commissions.periodType, "monthly"),
          onDate(commissions.periodStart, monthStart),
        )).limit(1);

      if (existing) {
        await db.update(commissions)
          .set({
            commissionRate: input.commissionRate.toFixed(2),
            // Не передали — не трогаем: экран ставок агента не должен обнулять
            // курьерскую ставку только потому, что ничего про неё не знает.
            ...(input.deliveryRate === undefined ? {} : { deliveryRate: input.deliveryRate.toFixed(2) }),
            ...(input.courierPayMode === undefined ? {} : { courierPayMode: input.courierPayMode }),
            ...(input.mealAllowance === undefined ? {} : { mealAllowance: input.mealAllowance.toFixed(2) }),
            ...(input.travelAllowance === undefined ? {} : { travelAllowance: input.travelAllowance.toFixed(2) }),
          })
          .where(eq(commissions.id, existing.id));
      } else {
        await db.insert(commissions).values({
          tenantId: ctx.tenant.id,
          userId: input.userId,
          commissionRate: input.commissionRate.toFixed(2),
          deliveryRate: (input.deliveryRate ?? 0).toFixed(2),
          courierPayMode: input.courierPayMode ?? "per_delivery",
          mealAllowance: (input.mealAllowance ?? 0).toFixed(2),
          travelAllowance: (input.travelAllowance ?? 0).toFixed(2),
          periodType: "monthly",
          // These are `date` columns, so drizzle types them as Date, but the
          // period is keyed by the "YYYY-MM-DD" string the lookup above uses —
          // handing the driver a Date instead would shift the stored day by the
          // server's UTC offset and stop the two ever matching.
          periodStart: sql`${monthStart}`,
          periodEnd: sql`${monthEnd}`,
          salesAmount: "0.00",
          commissionAmount: "0.00",
        });
      }

      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));
      return { success: true };
    }),

  // Calculate commissions for a period
  calculate: operatorQuery
    .input(z.object({
      periodType: z.enum(["monthly", "quarterly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Пересчитываются только строки со статусом pending.
      //
      // Раньше условия по статусу здесь не было. Январская комиссия считалась,
      // утверждалась, выплачивалась — а в феврале завершался возврат по
      // январскому заказу, оператор жал «Рассчитать» с диапазоном за год, и
      // январская строка молча переписывалась на меньшую сумму, оставаясь в
      // статусе paid. Ведомость расходилась с фактически выданными деньгами, а
      // прежнее значение нигде не сохранялось.
      //
      // Утверждённая и выплаченная комиссия — уже принятое финансовое решение;
      // если возврат пришёл после выплаты, его место в следующем периоде, а не
      // задним числом в закрытом. Тот же приём уже стоит в services/kpi.ts.
      const agentCommissions = await db.select()
        .from(commissions)
        .where(and(
          eq(commissions.tenantId, ctx.tenant.id),
          eq(commissions.periodType, input.periodType),
          eq(commissions.status, "pending"),
          sql`${commissions.periodStart} >= ${input.periodStart}`,
          sql`${commissions.periodEnd} <= ${input.periodEnd}`,
        ));

      const { orders } = await import("@db/schema");
      const { sql: sqlFn } = await import("drizzle-orm");

      const results = await Promise.all(
        agentCommissions.map(async (agent) => {
          // Each row's own period, not the outer request range: `calculate`
          // can select several rows spanning different sub-periods (e.g. every
          // monthly row within a requested year), and bounding every one of
          // them by the same, later `input.periodEnd` pulled each later
          // period's sales into every earlier one — January's commission was
          // computed over Jan 1 through Dec 31.
          // periodEnd comes back from a `date` column as a Date at midnight, so
          // it has to be pushed to the end of that day or the last day's orders
          // fall outside the range.
          const agentPeriodEndDate = new Date(agent.periodEnd);
          agentPeriodEndDate.setHours(23, 59, 59, 999);
          const [orderResult] = await db.select({
            total: sqlFn<string>`COALESCE(SUM(${orders.total}), 0)`,
          }).from(orders).where(and(
            eq(orders.tenantId, ctx.tenant.id),
            eq(orders.agentId, agent.userId),
            inArray(orders.status, REVENUE_ORDER_STATUSES),
            isNull(orders.deletedAt),
            gte(orders.createdAt, agent.periodStart),
            lte(orders.createdAt, agentPeriodEndDate),
          ));

          /*
            Возвраты — общим правилом (services/revenue-returns.ts).

            Здесь стоял свой запрос, и он ошибался дважды.

            Во-первых, брал возвраты по дате ЗАКАЗА, а прибыль на соседней
            странице — по дате проведения возврата. Один и тот же возврат
            уменьшал разные месяцы в двух отчётах.

            Во-вторых, и это дороже, у него не было отбора по статусу заказа
            вовсе — только `deleted_at IS NULL`. Заказ, отменённый после
            проведения возврата, выпадал из суммы продаж целиком (статус
            фильтруется выше) и продолжал вычитаться возвратом: те же деньги
            уходили из базы комиссии дважды. У агента с одной отменой месяц
            обнулялся на ровном месте, и Math.max(0, …) это прятал.
          */
          const returned = returnedOf(
            returnedByAgent(await returnsInPeriod(
              db, ctx.tenant.id, dayKey(new Date(agent.periodStart)), dayKey(agentPeriodEndDate),
            )),
            agent.userId,
          );

          const salesAmount = Math.max(0, Number(orderResult.total) - returned.amount);
          const commissionAmount = salesAmount * (Number(agent.commissionRate) / 100);

          // Статус в условии UPDATE повторно, а не только в выборке выше:
          // между SELECT и этим UPDATE проходят десятки запросов к orders и
          // returns, и за это время другой оператор успевает утвердить строку.
          // Без условия здесь расчёт всё равно перезаписал бы уже утверждённую
          // сумму. tenant_id — там же, чтобы условие оставалось верным и после
          // копирования этого запроса в соседний обработчик.
          await db.update(commissions)
            .set({
              salesAmount: salesAmount.toFixed(2),
              commissionAmount: commissionAmount.toFixed(2),
            })
            .where(and(
              eq(commissions.id, agent.id),
              eq(commissions.tenantId, ctx.tenant.id),
              eq(commissions.status, "pending"),
            ));

          return agent.id;
        })
      );

      return { success: true, updated: results.length };
    }),

  /*
    ── Проценты по ТОВАРАМ ───────────────────────────────────────────────────

    Жалоба арендатора: «система процентов для агентов неправильная, потому что
    он поставил разные проценты для разных товаров». Процент был один на
    человека и на всё, что тот продал, — а торгуют товарами с разной наценкой.

    Ставка привязана к товару, а не к паре «человек + товар»: у товара своя
    наценка независимо от того, кто его продал, а пара означала бы для
    организации с десятью агентами и пятью особыми товарами полсотни строк,
    заводимых руками. Товара нет в списке — действует процент человека, то
    есть пустой список считает ровно как до появления этого раздела.
  */
  productRates: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return rateRows(db, ctx.tenant.id);
  }),

  setProductRate: operatorQuery.use(can("commission.manage"))
    .input(z.object({
      productId: z.number().int().positive(),
      rate: z.number().min(0).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      /*
        Товар — из ЭТОЙ организации. Внешний ключ этого не проверяет: таблица
        товаров общая на всю платформу, и без проверки оператор одной
        организации перебором завёл бы ставки на чужие товары. Считаться они
        бы не считались (продаж по ним у него нет), но список ставок отдаёт
        название товара — и стал бы каналом для чтения чужого справочника.
      */
      const [product] = await db.select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Товар не найден в вашей организации" });

      const [existing] = await db.select({ id: commissionProductRates.id })
        .from(commissionProductRates)
        .where(and(
          eq(commissionProductRates.tenantId, ctx.tenant.id),
          eq(commissionProductRates.productId, input.productId),
        ))
        .limit(1);

      if (existing) {
        await db.update(commissionProductRates)
          .set({ rate: input.rate.toFixed(2) })
          .where(and(
            eq(commissionProductRates.id, existing.id),
            eq(commissionProductRates.tenantId, ctx.tenant.id),
          ));
      } else {
        await db.insert(commissionProductRates).values({
          tenantId: ctx.tenant.id,
          productId: input.productId,
          rate: input.rate.toFixed(2),
        });
      }

      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));
      return { success: true };
    }),

  /*
    Убрать ставку у товара — вернуть его под процент человека.

    Это не то же самое, что поставить ноль: ноль означает «с этого товара
    комиссии нет», и такой выбор арендатор тоже делает осознанно.
  */
  deleteProductRate: operatorQuery.use(can("commission.manage"))
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(commissionProductRates)
        .where(and(
          eq(commissionProductRates.tenantId, ctx.tenant.id),
          eq(commissionProductRates.productId, input.productId),
        ));
      cache.invalidate(CacheKeys.commissions(ctx.tenant.id));
      return { success: true };
    }),

  // Approve/paid commission
  updateStatus: operatorQuery.use(can("commission.manage"))
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "approved", "paid"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(commissions)
        .set({ status: input.status })
        .where(and(eq(commissions.id, input.id), eq(commissions.tenantId, ctx.tenant.id)));
      return { success: true };
    }),
});

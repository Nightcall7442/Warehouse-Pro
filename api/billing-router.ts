import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, orders, products } from "@db/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PLANS, PLAN_PRICES_UZS, EXTRA_PRICES_UZS, type PlanKey } from "../contracts/constants";
import { recordLead } from "./services/leads";

/** Тарифный предел плюс докупленное. Безлимитному прибавлять нечего. */
const withExtra = (base: number | null, extra: number | null) =>
  base === null ? null : base + Math.max(0, Number(extra ?? 0));

/**
 * Куда перезвонить по заявке.
 *
 * Телефон организации заполняет только суперадмин; у организации,
 * зарегистрированной с сайта, и телефона, и почты владельца нет вовсе — и
 * заявка приходила с «📞 не указан». Тогда — телефон или почта самого
 * директора, который нажал кнопку: он в таблице людей есть всегда.
 * `||`, а не `??`: пустая строка — тоже «не указан».
 */
function callbackContact(ctx: {
  tenant: { ownerPhone?: string | null; ownerEmail?: string | null };
  user: { phone?: string | null; email: string };
}): string {
  return ctx.tenant.ownerPhone || ctx.user.phone || ctx.tenant.ownerEmail || ctx.user.email || "не указан";
}

export const billingRouter = createRouter({
  /** Current tenant subscription status */
  status: authedQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;

    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

    const planKey = tenant.plan as PlanKey;
    const plan      = PLANS[planKey] ?? PLANS.basic;
    const now       = new Date();
    const trialEnds = tenant.trialEndsAt;
    const planEnds  = tenant.planExpiresAt;

    const planActive   = planEnds  && planEnds  > now;
    // Оплаченный срок главнее остатка пробного: trial_ends_at после перехода
    // на платный остаётся, и перешедший досрочно видел «Пробный период,
    // осталось 4 дн.» вместо оплаченного месяца — как будто оплата не прошла.
    const trialActive  = !planActive && trialEnds && trialEnds > now;
    const isExpired    = !trialActive && !planActive;

    // Current usage
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [userCount, productCount, orderCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, startOfMonth))),
    ]);

    return {
      plan:          tenant.plan,
      planName:      plan.name,
      planNameUz:    plan.nameUz,
      price:         PLAN_PRICES_UZS[tenant.plan as PlanKey],
      trialEndsAt:   trialEnds,
      planExpiresAt: planEnds,
      trialActive,
      planActive,
      isExpired,
      daysLeft:      trialActive
        ? Math.ceil((trialEnds!.getTime() - now.getTime()) / 86_400_000)
        : planActive
          ? Math.ceil((planEnds!.getTime() - now.getTime()) / 86_400_000)
          : 0,
      /*
        Предел, который действует на самом деле: тарифный плюс докупленное.

        Показывать голый тарифный нельзя: у арендатора, докупившего двадцать
        позиций, полоса упёрлась бы в пятьдесят и кричала «предел исчерпан»,
        когда на деле свободно ещё двадцать.
      */
      limits: {
        maxUsers:       withExtra(plan.maxUsers, tenant.extraUsers),
        maxProducts:    withExtra(plan.maxProducts, tenant.extraProducts),
        maxOrdersMonth: plan.maxOrdersMonth,
      },
      extra: {
        users:    Number(tenant.extraUsers ?? 0),
        products: Number(tenant.extraProducts ?? 0),
        // Доплата в месяц — чтобы к сумме тарифа не приходилось считать в уме.
        priceMonthly:
          Number(tenant.extraUsers ?? 0) * EXTRA_PRICES_UZS.user +
          Number(tenant.extraProducts ?? 0) * EXTRA_PRICES_UZS.product,
      },
      usage: {
        users:   Number(userCount[0]?.c ?? 0),
        products:Number(productCount[0]?.c ?? 0),
        orders:  Number(orderCount[0]?.c ?? 0),
      },
      plans: (Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][])
        .filter(([key]) => key !== "trial")
        .map(([key, p]) => ({
        key,
        name:      p.name,
        nameUz:    p.nameUz,
        price:     PLAN_PRICES_UZS[key as PlanKey],
        maxUsers:  p.maxUsers,
        maxProducts: p.maxProducts,
        maxOrdersMonth: p.maxOrdersMonth,
      })),
    };
  }),

  /* ═════════════════════════════════════════════════════════════════════════
     Докупить места или позиции сверх тарифа.

     ── Чего не хватало ──────────────────────────────────────────────────────

     Возможность была со всех сторон, кроме той, где стоит человек:

       • лендинг называл цену надбавки («место 35 000, товар 5 000 сум/мес»);
       • отказ при упоре в предел прямо советовал «или докупите позиции»;
       • подписка показывала, сколько уже докуплено, и брала за это деньги;
       • суперадмин умел выставить надбавку (tenant.setExtraLimits).

     И только САМ арендатор попросить не мог ничем. Директор упирался в
     предел, читал «докупите», шёл в раздел «Подписка» — и не находил там
     ничего. Дальше он либо звонил (если догадался), либо переходил на
     старший тариф, который ему не нужен, либо уходил.

     ── Почему заявка, а не мгновенная выдача ────────────────────────────────

     Оплата к продукту не подключена: апгрейд тарифа тоже оформляется
     заявкой, а не кнопкой «оплатить». Выдать места сразу значило бы отдать
     их бесплатно. Поэтому здесь то же, что и у тарифа: заявка + звонок.

     Ложится она в общий разбор заявок, а не только в телеграм: бот отключат,
     а человек, которому обещали перезвонить, останется ждать. Порядок
     «запись → уведомление → отметка» — общий, в services/leads.ts.
     ═════════════════════════════════════════════════════════════════════════ */
  requestExtra: adminQuery
    .input(z.object({
      /* Потолок тот же, что у выставления надбавки суперадмином: тысяча.
         Он не про щедрость, а про промах по клавиатуре — «5000» вместо
         «500» это двадцать пять миллионов сум в месяц. */
      users:    z.number().int().min(0).max(1000).default(0),
      products: z.number().int().min(0).max(1000).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.users === 0 && input.products === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Укажите, сколько мест или позиций докупить.",
        });
      }

      /*
        Цена считается ЗДЕСЬ и из того же источника, что и списание
        (EXTRA_PRICES_UZS). Прислать её с экрана нельзя: тогда сумма в заявке
        была бы той, которую назвал браузер, а не та, по которой выставят
        счёт.
      */
      const priceMonthly =
        input.users * EXTRA_PRICES_UZS.user +
        input.products * EXTRA_PRICES_UZS.product;

      const parts = [
        input.users    ? `${input.users} мест`      : null,
        input.products ? `${input.products} позиций` : null,
      ].filter(Boolean).join(" и ");

      const { notified } = await recordLead(ctx.db, {
        name:    ctx.user.name,
        company: ctx.tenant.name,
        // Телефон организации, а не входящего: перезванивают владельцу.
        phone:   callbackContact(ctx),
        comment:
          `Докупить сверх тарифа: ${parts}. ` +
          `Доплата ${priceMonthly.toLocaleString("ru-RU")} сум/мес. ` +
          `Тариф сейчас: ${PLANS[ctx.tenant.plan as PlanKey]?.name ?? ctx.tenant.plan}.`,
        source:  "подписка: сверх тарифа",
      }, "Запрос на надбавку сверх тарифа");

      return {
        success: true,
        priceMonthly,
        /*
          Ответ честен про то, что произошло. Раньше в этом файле похожая
          ручка отвечала «оператор свяжется в течение 30 минут» независимо от
          того, ушло уведомление или нет.
        */
        message: notified
          ? `Заявка отправлена: ${parts}, доплата ${priceMonthly.toLocaleString("ru-RU")} сум/мес. Оператор свяжется с вами.`
          : `Заявка записана: ${parts}, доплата ${priceMonthly.toLocaleString("ru-RU")} сум/мес. Если не перезвонят в течение дня — позвоните сами.`,
      };
    }),

  /* ═════════════════════════════════════════════════════════════════════════
     Заявка на тариф или продление — единственный путь «купить».

     Платёжной системы в сумах нет: заявку разбирает владелец платформы и
     включает тариф руками (tenant.updatePlan). Поэтому потерянная заявка —
     это потерянный платёж.

     А терялась она молча: ручка только слала сообщение в телеграм, и
     notifyAdmin при сбое не бросает, а возвращает false — `.catch` не
     срабатывал никогда. Бот не настроен, телеграм лежит, бота заблокировали —
     намерение заплатить исчезало, а человеку всё равно отвечали «оператор
     свяжется в течение 30 минут».

     Теперь — как у надбавки: запись в разбор заявок, потом уведомление, и
     ответ честен про то, ушло ли оно. Тот же тариф, что уже стоит, — это
     продление, и в заявке оно названо продлением.
     ═════════════════════════════════════════════════════════════════════════ */
  requestUpgrade: adminQuery
    .input(z.object({ plan: z.enum(["basic", "pro", "exclusive"]) }))
    .mutation(async ({ input, ctx }) => {
      const plan  = PLANS[input.plan];
      const price = PLAN_PRICES_UZS[input.plan];
      const renew = ctx.tenant.plan === input.plan;
      const now   = PLANS[ctx.tenant.plan as PlanKey]?.name ?? ctx.tenant.plan;

      const { notified } = await recordLead(ctx.db, {
        name:    ctx.user.name,
        company: ctx.tenant.name,
        phone:   callbackContact(ctx),
        comment: renew
          ? `Продлить тариф ${plan.name}: ${price.toLocaleString("ru-RU")} сум/мес.`
          : `Тариф ${plan.name}: ${price.toLocaleString("ru-RU")} сум/мес. Тариф сейчас: ${now}.`,
        source:  renew ? "подписка: продление" : "подписка: тариф",
      }, renew ? "Запрос на продление тарифа" : "Запрос на тариф");

      return {
        success: true,
        notified,
        message: notified
          ? `Заявка на тариф «${plan.name}» отправлена. Оператор свяжется с вами.`
          : `Заявка на тариф «${plan.name}» записана. Если не перезвонят в течение дня — позвоните сами.`,
        price,
        plan:    input.plan,
      };
    }),
});

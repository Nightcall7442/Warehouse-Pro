import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, orders, products } from "@db/schema";
import { eq, and, sql, gte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PLANS, type PlanKey } from "../contracts/constants";
import {
  FIELD_PRICE_UZS, FIELD_ROLES, LEGACY_EXTRA_PRICES_UZS, LEGACY_PRICES_UZS, GRANDFATHER_UNTIL,
  amountForPeriod, annualPrice, formatDay, formatSum, isGrandfathered, isLegacyPlan,
  monthlyPrice, priceForTenant, type FieldRole,
} from "../contracts/pricing";
import { recordLead } from "./services/leads";
import { countFieldUsersOf } from "./lib/field-users";

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

    const now       = new Date();
    const planKey   = tenant.plan as PlanKey;
    const plan      = PLANS[planKey] ?? PLANS.standard;
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
    const [userCount, productCount, orderCount, fieldPeople] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, startOfMonth))),
      /*
        Полевые — те, за кого платят: активные агенты, курьеры, мерчендайзеры
        (contracts/pricing.ts). Отключённый не считается. Строками, а не
        числом: экран раскладывает их по ролям — «5 агентов · 2 курьера».
      */
      db.select({ role: users.role }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.role, [...FIELD_ROLES]))),
    ]);

    const byRole = Object.fromEntries(FIELD_ROLES.map(r => [r, 0])) as Record<FieldRole, number>;
    for (const p of fieldPeople) if (p.role in byRole) byRole[p.role as FieldRole]++;
    const fieldUsers = fieldPeople.length;
    const pricing = priceForTenant(tenant.plan, fieldUsers, now);
    const eff = PLANS[pricing.plan] ?? PLANS.standard;
    const grandfathered = pricing.model === "legacy";

    /*
      Надбавки — только у прежних тарифов и только пока они действуют: в новой
      модели пределов нет, и докупленное ничего не прибавляет.
    */
    const extraUsers    = grandfathered ? Number(tenant.extraUsers ?? 0) : 0;
    const extraProducts = grandfathered ? Number(tenant.extraProducts ?? 0) : 0;

    return {
      plan:          tenant.plan,
      /** Тариф на сегодня: прежний после GRANDFATHER_UNTIL — уже «standard». */
      effectivePlan: pricing.plan,
      planName:      plan.name,
      planNameUz:    plan.nameUz,
      planNameRu:    plan.nameRu,
      price:         pricing.monthly,
      pricing,
      fieldUsers,
      fieldByRole:   byRole,
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
        У «Стандарта» и пробного — null везде: пределов нет.
      */
      limits: {
        maxUsers:       withExtra(eff.maxUsers, extraUsers),
        maxProducts:    withExtra(eff.maxProducts, extraProducts),
        maxOrdersMonth: eff.maxOrdersMonth,
      },
      extra: {
        users:    extraUsers,
        products: extraProducts,
        // Доплата в месяц — чтобы к сумме тарифа не приходилось считать в уме.
        priceMonthly: extraUsers * LEGACY_EXTRA_PRICES_UZS.user + extraProducts * LEGACY_EXTRA_PRICES_UZS.product,
      },
      usage: {
        users:   Number(userCount[0]?.c ?? 0),
        products:Number(productCount[0]?.c ?? 0),
        orders:  Number(orderCount[0]?.c ?? 0),
      },
      /*
        Что можно заказать. Новым и пробным — только «Стандарт»; прежнему
        тарифу до GRANDFATHER_UNTIL ещё и продление по прежней цене.
      */
      plans: [
        ...(grandfathered && isLegacyPlan(tenant.plan)
          ? [{ key: tenant.plan as PlanKey, name: plan.name, nameUz: plan.nameUz, price: LEGACY_PRICES_UZS[tenant.plan], annual: null as number | null, legacy: true }]
          : []),
        { key: "standard" as PlanKey, name: PLANS.standard.name, nameUz: PLANS.standard.nameUz, price: monthlyPrice(fieldUsers), annual: annualPrice(fieldUsers) as number | null, legacy: false },
      ],
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
      /*
        Надбавка есть только у прежних тарифов, пока они действуют: у
        «Стандарта» и пробного пределов нет — докупать нечего, а заявка
        с ценой надбавки обещала бы списать деньги ни за что.
      */
      if (!isGrandfathered(ctx.tenant.plan, new Date())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Пределов по местам и товарам больше нет — докупать нечего.",
        });
      }
      if (input.users === 0 && input.products === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Укажите, сколько мест или позиций докупить.",
        });
      }

      /*
        Цена считается ЗДЕСЬ и из того же источника, что и списание
        (LEGACY_EXTRA_PRICES_UZS). Прислать её с экрана нельзя: тогда сумма в
        заявке была бы той, которую назвал браузер, а не та, по которой
        выставят счёт.
      */
      const priceMonthly =
        input.users * LEGACY_EXTRA_PRICES_UZS.user +
        input.products * LEGACY_EXTRA_PRICES_UZS.product;

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
     включает тариф руками (оплата в консоли). Поэтому потерянная заявка —
     это потерянный платёж: запись в разбор заявок, потом уведомление, и
     ответ честен про то, ушло ли оно.

     ── Цена за полевого сотрудника (05.10.2026) ─────────────────────────────

     Продаётся один тариф — «Стандарт»: 119 000 сум за агента, курьера или
     мерчендайзера в месяц, минимум трое, год предоплатой −15 %. Сумму
     считает сервер по своим людям (contracts/pricing.ts) — экран её не
     присылает. Прежний тариф можно только ПРОДЛИТЬ, и только пока он
     действует (до GRANDFATHER_UNTIL): подключить Basic заново нельзя.
     ═════════════════════════════════════════════════════════════════════════ */
  requestUpgrade: adminQuery
    .input(z.object({
      plan:   z.enum(["standard", "basic", "pro", "exclusive"]),
      period: z.enum(["month", "year"]).default("month"),
    }))
    .mutation(async ({ input, ctx }) => {
      const now   = new Date();
      const renew = ctx.tenant.plan === input.plan;
      if (isLegacyPlan(input.plan) && !(renew && isGrandfathered(input.plan, now))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Тариф ${PLANS[input.plan].name} больше не подключается. Доступен «Стандарт» — ${formatSum(FIELD_PRICE_UZS)} сум за полевого сотрудника.`,
        });
      }

      const fieldUsers = await countFieldUsersOf(getDb(), ctx.tenant.id);
      const months = input.period === "year" ? 12 : 1;
      const amount = amountForPeriod(input.plan, fieldUsers, months, now);
      const plan   = PLANS[input.plan];
      const was    = PLANS[ctx.tenant.plan as PlanKey]?.name ?? ctx.tenant.plan;
      const what   = input.plan === "standard"
        ? `${plan.name}: ${fieldUsers} полевых (к оплате ${priceForTenant("standard", fieldUsers, now).billedFieldUsers})`
        : `${plan.name} по прежней цене до ${formatDay(GRANDFATHER_UNTIL)}`;
      const sum = input.period === "year"
        ? `год предоплатой ${formatSum(amount)} сум`
        : `${formatSum(amount)} сум/мес`;

      const { notified } = await recordLead(ctx.db, {
        name:    ctx.user.name,
        company: ctx.tenant.name,
        phone:   callbackContact(ctx),
        comment: renew
          ? `Продлить тариф ${what}, ${sum}.`
          : `Тариф ${what}, ${sum}. Тариф сейчас: ${was}.`,
        source:  renew ? "подписка: продление" : "подписка: тариф",
      }, renew ? "Запрос на продление тарифа" : "Запрос на тариф");

      return {
        success: true,
        notified,
        message: notified
          ? `Заявка на тариф «${plan.name}» отправлена. Оператор свяжется с вами.`
          : `Заявка на тариф «${plan.name}» записана. Если не перезвонят в течение дня — позвоните сами.`,
        price:   amount,
        period:  input.period,
        plan:    input.plan,
      };
    }),
});

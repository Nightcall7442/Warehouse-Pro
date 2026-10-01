import { randomUUID } from "crypto";
import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { subscriptionPayments, subscriptions, tenants } from "@db/schema";
import { monthShare, paymentPeriod, tashkentMonth, type PaidPlan, type PaymentMethod } from "@contracts/subscription-payment";
import { invalidateSubscriptionAccess } from "../lib/feature-gating";
import { recordPlatformAudit } from "./platform-audit";
import { invalidateOrgHealth } from "./org-health";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Оплаты подписок.

   ── Что было ────────────────────────────────────────────────────────────────

   Деньги платформы не записывались нигде. Клиент платил наличными или
   переводом, суперадмин нажимал «Изменить тариф» на 30 дней — и всё: сколько
   заплатили, когда, каким способом, за какой период — в голове и в Telegram.
   «MRR» на обзоре считался по прайсу: без скидок, без пропущенных оплат.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Одна форма «Записать оплату» делает два дела в одной транзакции: пишет
   оплату и продлевает подписку на её период. Раздельные шаги «записал» и
   «продлил» однажды разошлись бы — забытое продление запирает клиента,
   который заплатил. Период — от конца оплаченного (то же правило, что у
   «Изменить тариф», contracts/subscription-payment.paidUntilBase).
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RecordPaymentInput {
  tenantId: number;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  plan: PaidPlan;
  months: number;
  note?: string | null;
}

export class PaymentTenantMissing extends Error {
  constructor() { super("Организация не найдена"); }
}

/**
 * Записать оплату и продлить подписку — одной транзакцией вместе со следом
 * в журнале владельца: оплата без следа или без продления хуже отказа.
 */
export async function recordSubscriptionPayment(db: Db, input: RecordPaymentInput, actor: { id: number; name: string }, ip: string | null, now = new Date()) {
  const result = await db.transaction(async (tx) => {
    const [t] = await tx.select({ id: tenants.id, name: tenants.name, plan: tenants.plan })
      .from(tenants).where(eq(tenants.id, input.tenantId)).for("update").limit(1);
    if (!t) throw new PaymentTenantMissing();
    // Подписка под замком: две оплаты разом не должны продлить от одного и того же конца.
    const [sub] = await tx.select({ id: subscriptions.id, plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnds: subscriptions.currentPeriodEnds })
      .from(subscriptions).where(eq(subscriptions.tenantId, input.tenantId)).for("update").limit(1);

    const period = paymentPeriod(sub ?? null, input.months, now);
    const [ins] = await tx.insert(subscriptionPayments).values({
      tenantId: t.id, tenantName: t.name, amount: input.amount, paidAt: input.paidAt, method: input.method,
      plan: input.plan, months: input.months, periodFrom: period.fromDay, periodTo: period.toDay,
      note: input.note?.trim() || null, recordedById: actor.id, recordedByName: actor.name,
    });

    await tx.update(tenants).set({ plan: input.plan, planExpiresAt: period.to, updatedAt: now }).where(eq(tenants.id, t.id));
    if (sub) {
      await tx.update(subscriptions).set({ plan: input.plan, status: "active", currentPeriodEnds: period.to, updatedAt: now })
        .where(eq(subscriptions.tenantId, t.id));
    } else {
      // Организация без строки подписки (заведена до неё) — пускает калитка по подписке, завести.
      await tx.insert(subscriptions).values({ id: randomUUID(), tenantId: t.id, plan: input.plan, status: "active", currentPeriodEnds: period.to });
    }

    await recordPlatformAudit(tx, {
      actor, action: "payment.recorded", tenantId: t.id, tenantName: t.name,
      targetType: "payment", targetId: Number(ins.insertId),
      before: { plan: sub?.plan ?? t.plan, periodEnds: sub?.currentPeriodEnds ?? null },
      after: { plan: input.plan, periodEnds: period.to },
      meta: { amount: input.amount, method: input.method, months: input.months, paidAt: input.paidAt, periodFrom: period.fromDay, periodTo: period.toDay, note: input.note?.trim() || undefined },
      ip,
    }, { strict: true });

    return { id: Number(ins.insertId), periodFrom: period.fromDay, periodTo: period.toDay, currentPeriodEnds: period.to };
  });
  // Заплатившего пускаем сразу, а не через минуту кеша доступа.
  invalidateSubscriptionAccess(input.tenantId);
  invalidateOrgHealth();
  return result;
}

/** Оплаты одной организации — новые сверху. Живут и после её удаления. */
export async function listPayments(db: Db, tenantId: number) {
  return db.select().from(subscriptionPayments)
    .where(eq(subscriptionPayments.tenantId, tenantId))
    .orderBy(desc(subscriptionPayments.paidAt), desc(subscriptionPayments.id))
    .limit(200);
}

/**
 * Деньги месяца для обзора.
 *
 *   · «Поступило» — оплаты с датой оплаты в текущем месяце (по Ташкенту);
 *   · «MRR по оплатам» — оплаты, разложенные по дням своих периодов: доля,
 *     что приходится на текущий месяц (contracts/subscription-payment.monthShare).
 *     В отличие от «MRR по цене тарифа» это деньги, которые реально
 *     заплатили, со скидками и пропусками.
 */
export async function paymentsSummary(db: Db, now = new Date()) {
  const month = tashkentMonth(now);
  const [received] = await db.select({ sum: sql<string>`COALESCE(SUM(${subscriptionPayments.amount}), 0)`, n: sql<string>`COUNT(*)` })
    .from(subscriptionPayments)
    .where(and(gte(subscriptionPayments.paidAt, month.first), lte(subscriptionPayments.paidAt, month.last)));
  // Периоды, задевающие месяц: [from, to) пересекается с [first, last].
  const covering = await db.select({ amount: subscriptionPayments.amount, periodFrom: subscriptionPayments.periodFrom, periodTo: subscriptionPayments.periodTo })
    .from(subscriptionPayments)
    .where(and(gt(subscriptionPayments.periodTo, month.first), lte(subscriptionPayments.periodFrom, month.last)));
  const mrr = covering.reduce((s, p) => s + monthShare({ amount: Number(p.amount), periodFrom: p.periodFrom, periodTo: p.periodTo }, month), 0);
  return {
    month: month.first.slice(0, 7),
    received: Math.round(Number(received?.sum ?? 0)),
    receivedCount: Number(received?.n ?? 0),
    mrrByPayments: Math.round(mrr),
    payers: covering.length,
  };
}

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";
import type { OrgRow } from "./orgs";

export type Detail = inferRouterOutputs<AppRouter>["tenant"]["getDetail"];

/** Подписка — массивом из ручки (select … limit 1); здесь — одна строка или null. */
export const subOf = (d: Detail) => (Array.isArray(d.subscription) ? d.subscription[0] : d.subscription) ?? null;

/** Строка «к org из списка» — для прежних правил срока и статуса, когда списка в кеше нет. */
export function rowFromDetail(d: Detail): OrgRow {
  const s = subOf(d);
  return {
    ...d.tenant, isSandbox: false, signupSource: null,
    userCount: d.users.length, orderCount: d.stats.orders, orderTotal: d.stats.revenue,
    subscription: s ? { status: s.status, plan: s.plan, trialEndsAt: s.trialEndsAt, currentPeriodEnds: s.currentPeriodEnds } : null,
    orders30: 0, revenue30: 0, lastOrderAt: null, lastLoginAt: null, lastActivityAt: d.tenant.createdAt,
    segment: { client: true, paying: false, trial: s?.status === "trialing", trialLive: false, renewalDays: null, silentDays: null, active7: false, price: 0 },
    contactPhone: d.tenant.ownerPhone, contactEmail: d.tenant.ownerEmail, inn: null,
  } as unknown as OrgRow;
}

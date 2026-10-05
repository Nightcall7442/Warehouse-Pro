import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tenants } from "@db/schema";
import type { getDb } from "../queries/connection";
import { FIELD_PRICE_UZS, GRANDFATHER_UNTIL, formatDay, formatSum, planSellable } from "../../contracts/pricing";

type Db = ReturnType<typeof getDb>;

/**
 * Прежний тариф (Basic / Pro / Exclusive) можно только ПРОДЛИТЬ — той же
 * организации, что на нём сидит, и пока он действует (до GRANDFATHER_UNTIL).
 * Правило — planSellable в contracts/pricing.ts; здесь оно для «Изменить
 * тариф» в консоли («Записать оплату» проверяет его внутри своей транзакции,
 * services/subscription-payments — PaymentPlanClosed, те же слова).
 */
export async function assertPlanSellable(db: Db, tenantId: number, plan: string, now: Date): Promise<void> {
  const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const current = t?.plan ?? "";
  if (planSellable(current, plan, now)) return;
  if (current === plan) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Прежний тариф действовал до ${formatDay(GRANDFATHER_UNTIL)}. Теперь — «Стандарт», ${formatSum(FIELD_PRICE_UZS)} сум за полевого сотрудника.` });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: `Прежние тарифы больше не подключаются — только продление своего до ${formatDay(GRANDFATHER_UNTIL)}. Выберите «Стандарт».` });
}

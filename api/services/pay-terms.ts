import { and, desc, eq, sql } from "drizzle-orm";
import { commissions } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Условия оплаты переходят из месяца в месяц.

   Строка commissions за месяц хранит и условия (оклад, ставку комиссии,
   ставку доставки, способ оплаты курьера, обед и дорожные), и суммы месяца.
   Зарплата берёт условия из последней строки до конца периода
   (services/kpi.ts, calculateSalary), то есть условия живут, пока их не
   изменят.

   ── Что было (аудит 19.10.2026) ─────────────────────────────────────────────

   Новая строка месяца заводилась только с тем полем, которое в эту минуту
   меняли: расчёт зарплаты — со ставкой комиссии, «Вычет» — с вычетом,
   «Оклад» — с окладом и нулевой ставкой, «Ставка» — без оклада. Остальное
   брало значения по умолчанию, то есть ноль, и с этой строки зарплата
   считалась уже по нулям: первого числа «ИТОГО К ВЫПЛАТЕ» у агента падало на
   весь оклад, пока директор не вводил его заново.

   Теперь новая строка начинается с условий прошлого месяца, а поверх
   ложится только то, что меняют. Проверка —
   api/__tests__/real-db/pay-terms-carry-over.test.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Условия оплаты строки месяца — то, что переносится, а не суммы месяца и не вычет. */
export const PAY_TERMS = {
  commissionRate:  commissions.commissionRate,
  baseSalary:      commissions.baseSalary,
  deliveryRate:    commissions.deliveryRate,
  courierPayMode:  commissions.courierPayMode,
  mealAllowance:   commissions.mealAllowance,
  travelAllowance: commissions.travelAllowance,
};

export type PayTerms = {
  commissionRate: string;
  baseSalary: string;
  deliveryRate: string;
  courierPayMode: "per_delivery" | "percent";
  mealAllowance: string;
  travelAllowance: string;
};

/**
 * Условия последнего месяца ДО `monthStart` («ГГГГ-ММ-ДД») — с них начинается
 * новая строка месяца. Строк раньше нет — пусто, и действуют значения
 * колонок по умолчанию.
 */
export async function carriedPayTerms(
  db: Db, tenantId: number, userId: number, monthStart: string,
): Promise<Partial<PayTerms>> {
  const [row] = await db.select(PAY_TERMS)
    .from(commissions)
    .where(and(
      eq(commissions.tenantId, tenantId),
      eq(commissions.userId, userId),
      eq(commissions.periodType, "monthly"),
      sql`${commissions.periodStart} < ${monthStart}`,
    ))
    .orderBy(desc(commissions.periodStart))
    .limit(1);
  return row ?? {};
}

/**
 * Прогноз выполнения месячного плана — по агентам и по компании.
 *
 * ── Факт ────────────────────────────────────────────────────────────────────
 *
 * Выручка с первого числа по сегодня по правилу выручки: доставленные
 * неудалённые заказы минус возвраты, проведённые в этом месяце
 * (services/revenue-returns.ts), агент — из заказа. Это то же число, что KPI
 * показывает в кольце «Цель» (services/kpi.ts), — прогноз рядом с ним не
 * должен спорить о том, сколько уже продано.
 *
 * Компания — вся выручка месяца (с заказами офиса, у которых плана нет), план
 * компании — сумма планов людей в списке.
 *
 * ── План ────────────────────────────────────────────────────────────────────
 *
 * Правило KPI и оклада: последний МЕСЯЧНЫЙ план человека, начавшийся не
 * позже конца месяца. Если на этот месяц план не заводили, действует
 * прошлый — так же, как в «Цели» на экране KPI; planStart говорит экрану,
 * с какого месяца этот план.
 *
 * Формула и цвета — contracts/plan-forecast.ts.
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { orders, salesTargets, users } from "@db/schema";
import { revenuePeriodConditions } from "../lib/order-status";
import { dayKey, dateColumnDay, monthRange } from "../lib/period";
import { returnsInPeriod, returnedByAgent, totalReturned } from "./revenue-returns";
import { FORECAST_RULES, forecastLine, workDaysOf, type ForecastLine, type WorkDays } from "@contracts/plan-forecast";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface AgentForecast extends ForecastLine {
  userId: number;
  name: string;
  /** С какого числа действует план; не этот месяц — план перенесён с прошлого. */
  planStart: string | null;
}

export interface PlanForecast {
  /** «ГГГГ-ММ». */
  month: string;
  /** «ГГГГ-ММ-ДД» по календарю сервера. */
  today: string;
  days: WorkDays;
  /** Первые рабочие дни месяца — «рано судить». */
  early: boolean;
  company: ForecastLine;
  agents: AgentForecast[];
}

const TONE_ORDER = { red: 0, yellow: 1, early: 2, green: 3, none: 4 } as const;

export async function planForecast(db: Db, tenantId: number, now: Date = new Date()): Promise<PlanForecast> {
  const today = dayKey(now);
  const { start, end } = monthRange(now);
  const days = workDaysOf(today);

  const [factRows, returnRows, planRows] = await Promise.all([
    db.select({ agentId: orders.agentId, revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
      .from(orders)
      .where(and(...revenuePeriodConditions(tenantId, start, today)))
      .groupBy(orders.agentId),
    returnsInPeriod(db, tenantId, start, today),
    db.select({ userId: salesTargets.userId, target: salesTargets.targetAmount, periodStart: salesTargets.periodStart })
      .from(salesTargets)
      .where(and(
        eq(salesTargets.tenantId, tenantId),
        eq(salesTargets.periodType, "monthly"),
        lte(salesTargets.periodStart, sql`${end}`),
      ))
      .orderBy(desc(salesTargets.periodStart), desc(salesTargets.id)),
  ]);

  const plan = new Map<number, { amount: number; start: string }>();
  for (const p of planRows) {
    const uid = Number(p.userId);
    if (!plan.has(uid)) plan.set(uid, { amount: Number(p.target) || 0, start: dateColumnDay(p.periodStart as Date | string) });
  }
  const gross = new Map(factRows.map(r => [Number(r.agentId), Number(r.revenue) || 0]));
  const returned = returnedByAgent(returnRows);

  const candidateIds = [...new Set([...plan.keys(), ...gross.keys()])];
  const people = await db.select({ id: users.id, name: users.name, role: users.role, status: users.status })
    .from(users)
    .where(and(
      eq(users.tenantId, tenantId),
      candidateIds.length
        ? sql`(${users.role} = 'agent' AND ${users.status} = 'active' OR ${inArray(users.id, candidateIds)})`
        : sql`${users.role} = 'agent' AND ${users.status} = 'active'`,
    ));

  const agents: AgentForecast[] = [];
  for (const u of people) {
    const id = Number(u.id);
    const p = plan.get(id);
    const isAgent = u.role === "agent";
    const active = u.status === "active";
    // Офис, оформивший заказ, — не агент с планом: его выручка — в компании.
    if (!(isAgent && active) && !(p && active) && !(isAgent && gross.has(id))) continue;
    const fact = (gross.get(id) ?? 0) - (returned.get(id)?.amount ?? 0);
    agents.push({ ...forecastLine(fact, p?.amount ?? null, days), userId: id, name: u.name ?? `#${id}`, planStart: p?.start ?? null });
  }
  agents.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]
    || (a.forecastPct ?? Infinity) - (b.forecastPct ?? Infinity)
    || a.name.localeCompare(b.name, "ru"));

  const companyFact = [...gross.values()].reduce((s, v) => s + v, 0) - totalReturned(returnRows).amount;
  const companyPlan = agents.reduce((s, a) => s + (a.plan ?? 0), 0);

  return {
    month: start.slice(0, 7), today, days,
    early: days.passed <= FORECAST_RULES.EARLY_WORKDAYS,
    company: forecastLine(companyFact, companyPlan > 0 ? companyPlan : null, days),
    agents,
  };
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { dailyPlans } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Расстановка визитов на месяц.

   ── Что было ────────────────────────────────────────────────────────────────

   План визита ставился на ОДИН день. Чтобы занять агента на месяц, форму
   открывали двадцать шесть раз подряд. Расписание (магазин × день недели)
   умело разворачиваться в планы, но его разворачивание шло по одному плану за
   раз: SELECT «нет ли уже такого» плюс INSERT на каждый магазин каждого дня.
   Сорок точек на месяц — это тысяча семьсот запросов в цикле, и до конца оно
   не доходило: обрыв по времени на середине оставлял половину месяца
   расставленной, а половину нет, без всякого следа о том, где граница.

   Здесь тот же счёт делается тремя запросами: разом читаем, что уже стоит,
   разом вставляем недостающее пачками.

   ── Про даты ────────────────────────────────────────────────────────────────

   День — строка «ГГГГ-ММ-ДД», и вся арифметика идёт в UTC. Сервер живёт в UTC,
   организация в Ташкенте (+5); возьми мы местное время сервера, «первое
   октября» у нас и у них разошлось бы на день, и месяц начинался бы тридцатого
   сентября. Колонка plan_date — DATE, времени в ней нет вовсе, поэтому сравнить
   и сохранить надо ровно ту строку, которую видит человек.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Потолок на одну расстановку.
 *
 * Двести магазинов на все дни месяца — это шесть тысяч строк, и это уже не
 * «спланировал», а «залил базу по ошибке». Отказ с числом в тексте объясняет,
 * что именно уменьшить; молчаливая обрезка оставила бы половину месяца пустой.
 */
export const MAX_PLANS_PER_RUN = 5000;

/** Сколько строк уходит в базу одной вставкой. */
const INSERT_CHUNK = 500;

export interface MonthBounds {
  /** Первое число месяца, «ГГГГ-ММ-ДД». */
  start: string;
  /** Последнее число месяца. */
  end: string;
  /** Все дни месяца по порядку. */
  days: string[];
}

/** Разобрать «ГГГГ-ММ» в границы месяца и список его дней. */
export function monthBounds(month: string): MonthBounds {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "Месяц задаётся как ГГГГ-ММ" });
  const year = Number(m[1]);
  const mon  = Number(m[2]);
  if (mon < 1 || mon > 12) throw new TRPCError({ code: "BAD_REQUEST", message: "Месяц бывает от 01 до 12" });
  // Нулевой день следующего месяца — последний день этого; високосный февраль
  // считается сам, без таблицы длин.
  const total = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  return { start: days[0], end: days[total - 1], days };
}

/** День недели дня «ГГГГ-ММ-ДД»: 0 — воскресенье, как в visit_schedules. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Дни промежутка, попадающие на выбранные дни недели. */
export function daysOnWeekdays(days: string[], weekdays: number[]): string[] {
  const wanted = new Set(weekdays);
  return days.filter(d => wanted.has(weekdayOf(d)));
}

/** Все дни от start до end включительно, «ГГГГ-ММ-ДД». */
export function daysBetween(start: string, end: string): string[] {
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to   = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return [];
  const out: string[] = [];
  for (let t = from; t <= to; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export interface PlanPair {
  agentId: number;
  shopId: number;
}

export interface PlanResult {
  created: number;
  /** Сколько визитов уже стояло — их не трогаем и не удваиваем. */
  skipped: number;
}

/**
 * Поставить визиты: каждая пара «агент — магазин» на каждый из дней.
 *
 * Повтор безвреден: то, что уже стоит на этот день, считается пропущенным.
 * Состояние существующего плана не меняется — посещённый визит не станет
 * запланированным заново.
 */
export async function createVisitPlans(
  db: Db,
  opts: { tenantId: number; createdBy: number; pairs: PlanPair[]; days: string[]; notes?: string | null },
): Promise<PlanResult> {
  const { tenantId, createdBy, pairs, days } = opts;
  if (pairs.length === 0 || days.length === 0) return { created: 0, skipped: 0 };

  const wanted = pairs.length * days.length;
  if (wanted > MAX_PLANS_PER_RUN) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Слишком много визитов за раз: ${wanted}. Больше ${MAX_PLANS_PER_RUN} за одну расстановку не ставим — уменьшите число магазинов или дней.`,
    });
  }

  const agentIds = [...new Set(pairs.map(p => p.agentId))];
  const first = days[0];
  const last  = days[days.length - 1];

  /*
    Что уже стоит — одним запросом на весь промежуток.

    Дата приводится к строке в самой базе: драйвер отдаёт DATE то объектом, то
    строкой в зависимости от настроек соединения, а ключ сравнения должен
    совпадать с тем, что мы собираемся вставить.
  */
  const existing = await db.select({
    agentId: dailyPlans.agentId,
    shopId:  dailyPlans.shopId,
    day:     sql<string>`DATE_FORMAT(${dailyPlans.planDate}, '%Y-%m-%d')`,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      inArray(dailyPlans.agentId, agentIds),
      sql`${dailyPlans.planDate} BETWEEN ${first} AND ${last}`,
    ));

  const taken = new Set(existing.map(e => `${e.agentId}|${e.shopId}|${e.day}`));

  const rows: Array<typeof dailyPlans.$inferInsert> = [];
  let skipped = 0;
  for (const day of days) {
    const planDate = new Date(`${day}T00:00:00Z`);
    for (const pair of pairs) {
      if (taken.has(`${pair.agentId}|${pair.shopId}|${day}`)) { skipped++; continue; }
      rows.push({
        tenantId,
        agentId: pair.agentId,
        shopId:  pair.shopId,
        planDate,
        status:  "planned",
        notes:   opts.notes ?? null,
        createdBy,
      });
    }
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(dailyPlans).values(rows.slice(i, i + INSERT_CHUNK));
  }

  return { created: rows.length, skipped };
}

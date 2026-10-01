/* ═══════════════════════════════════════════════════════════════════════════
   Фоновые задачи словами для консоли платформы (раздел «Система»).

   Расписание (api/cron/scheduler.ts, jobsSnapshot) плюс журнал cron_runs —
   в одну строку на задачу: когда удалась, когда упала и с какой ошибкой,
   каков итог. Чистая функция с «сейчас» доводом: правило итога проверяется
   на любой момент суток, а не только на тот, когда шёл прогон.

   ── Итог ────────────────────────────────────────────────────────────────────

   «failed» — последняя ошибка позже последней удачи (текст ошибки отдаётся
   только тогда: старая, уже исправленная ошибка на экране — шум).
   «never» — удачи не было ни разу.
   «overdue» — у ежедневной: назначенный момент прошёл больше часа назад
   (догон пробует раз в час), а удачи после него нет; у частой — удачи нет
   дольше трёх её периодов.
   «ok» — всё остальное.

   Строки журнала без задачи в расписании (её убрали из кода) идут в конце с
   inSchedule: false — молча терять их нельзя, но и судить их не по чему.
   ═══════════════════════════════════════════════════════════════════════════ */

export type JobOutcome = "ok" | "failed" | "overdue" | "never";

type Snapshot = {
  name: string; everyMinutes: number | null;
  daily: { hour: number; minute: number; weekday: number | null } | null;
  lastDueAt: Date | null; lastDurationMs: number | null;
};
type Run = { job: string; lastSuccessAt: Date | null; lastErrorAt: Date | null; lastError: string | null };

const HOUR = 3_600_000;

export function describeJobs(snapshot: Snapshot[], runs: Run[], now: Date) {
  const byName = new Map(runs.map(r => [r.job, r]));
  const failedOf = (r: Run | undefined) =>
    Boolean(r?.lastErrorAt && (!r.lastSuccessAt || r.lastErrorAt > r.lastSuccessAt));

  const planned = snapshot.map(j => {
    const run = byName.get(j.name);
    byName.delete(j.name);
    const lastSuccessAt = run?.lastSuccessAt ?? null;
    const failed = failedOf(run);
    const overdue = j.everyMinutes
      ? !lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > 3 * j.everyMinutes * 60_000
      : Boolean(j.lastDueAt && now.getTime() - j.lastDueAt.getTime() > HOUR
          && (!lastSuccessAt || lastSuccessAt < j.lastDueAt));
    const outcome: JobOutcome = failed ? "failed" : !lastSuccessAt ? "never" : overdue ? "overdue" : "ok";
    return {
      name: j.name, inSchedule: true, everyMinutes: j.everyMinutes, daily: j.daily,
      lastSuccessAt, lastErrorAt: run?.lastErrorAt ?? null, lastError: failed ? run?.lastError ?? null : null,
      lastDurationMs: j.lastDurationMs, outcome,
    };
  });

  const orphans = [...byName.values()].map(r => ({
    name: r.job, inSchedule: false, everyMinutes: null, daily: null,
    lastSuccessAt: r.lastSuccessAt ?? null, lastErrorAt: r.lastErrorAt ?? null,
    lastError: failedOf(r) ? r.lastError ?? null : null,
    lastDurationMs: null, outcome: (failedOf(r) ? "failed" : r.lastSuccessAt ? "ok" : "never") as JobOutcome,
  }));
  return [...planned, ...orphans];
}

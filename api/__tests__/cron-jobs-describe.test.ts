import { describe, it, expect } from "vitest";
import { describeJobs } from "../services/cron-jobs";
import { jobsSnapshot, _internals } from "../cron/scheduler";

/**
 * Фоновые задачи словами — итог каждой задачи для раздела «Система».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Журнал cron_runs писался, а посмотреть его было негде: идёт ли ночная
 * копия, упала ли рассылка напоминаний — узнавали по тревоге через 26 часов
 * или из логов. Новой ручке system.jobs нужно правило итога, которое не
 * врёт ни в какой час суток.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На закреплённом «сейчас»: ежедневная, удачная после своего часа, — «ok»;
 * та же через 59 минут после назначенного без удачи — ещё «ok» (догон впереди),
 * через 61 — «просрочена»; ошибка позже удачи — «упала» с текстом, ошибка
 * раньше удачи — «ok» без текста; частая — просрочена после трёх периодов;
 * ни одной удачи — «не запускалась»; строка журнала без задачи в расписании —
 * в конце, inSchedule: false. Последний назначенный момент — тот же расчёт,
 * что у догона планировщика (lastDue), для ежедневной и для еженедельной.
 *
 * Нарочная поломка (проверено): убрать «> HOUR» из правила — падает «59
 * минут»; сравнивать ошибку с удачей наоборот — «упала»; потерять сирот —
 * «без расписания».
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
// 2026-10-01 05:00 UTC = 10:00 по Ташкенту.
const NOW = new Date("2026-10-01T05:00:00Z");

const daily = (name: string, lastDueAt: Date) => ({ name, everyMinutes: null, daily: { hour: 3, minute: 0, weekday: null }, lastDueAt, lastDurationMs: null });
const every = (name: string, m: number) => ({ name, everyMinutes: m, daily: null, lastDueAt: null, lastDurationMs: 1200 });
const run = (job: string, ok: Date | null, err: Date | null = null, msg: string | null = null) => ({ job, lastSuccessAt: ok, lastErrorAt: err, lastError: msg });
const by = (rows: ReturnType<typeof describeJobs>) => Object.fromEntries(rows.map(r => [r.name, r]));

describe("итог задачи", () => {
  const due = new Date(NOW.getTime() - 7 * HOUR); // 03:00 по Ташкенту

  it("удача после назначенного — ok; без удачи больше часа — просрочена, меньше — ещё нет", () => {
    const rows = by(describeJobs(
      [daily("a", due), daily("b", due), daily("c", new Date(NOW.getTime() - 59 * MIN)), daily("d", new Date(NOW.getTime() - 61 * MIN))],
      [run("a", new Date(due.getTime() + 4 * MIN)), run("b", new Date(due.getTime() - 20 * HOUR)),
        run("c", new Date(NOW.getTime() - 2 * 86_400_000)), run("d", new Date(NOW.getTime() - 2 * 86_400_000))],
      NOW,
    ));
    expect(rows.a.outcome).toBe("ok");
    expect(rows.b.outcome).toBe("overdue");
    expect(rows.c.outcome).toBe("ok");
    expect(rows.d.outcome).toBe("overdue");
  });

  it("ошибка позже удачи — упала, с текстом; раньше удачи — ok и без старого текста", () => {
    const rows = by(describeJobs(
      [daily("a", due), daily("b", due)],
      [run("a", new Date(due.getTime() + MIN), new Date(due.getTime() + 20 * MIN), "SMTP: connect ECONNREFUSED"),
        run("b", new Date(due.getTime() + 30 * MIN), new Date(due.getTime() + 10 * MIN), "старая ошибка")],
      NOW,
    ));
    expect(rows.a).toMatchObject({ outcome: "failed", lastError: "SMTP: connect ECONNREFUSED" });
    expect(rows.b).toMatchObject({ outcome: "ok", lastError: null });
  });

  it("частая — просрочена после трёх периодов; ни одной удачи — не запускалась", () => {
    const rows = by(describeJobs(
      [every("fresh", 5), every("late", 5), every("never", 30)],
      [run("fresh", new Date(NOW.getTime() - 14 * MIN)), run("late", new Date(NOW.getTime() - 16 * MIN))],
      NOW,
    ));
    expect(rows.fresh).toMatchObject({ outcome: "ok", lastDurationMs: 1200 });
    expect(rows.late.outcome).toBe("overdue");
    expect(rows.never.outcome).toBe("never");
  });

  it("строка журнала без задачи в расписании — в конце, не теряется", () => {
    const rows = describeJobs([every("x", 5)], [run("x", NOW), run("legacy", null, new Date(NOW.getTime() - HOUR), "gone")], NOW);
    expect(rows.map(r => r.name)).toEqual(["x", "legacy"]);
    expect(rows[1]).toMatchObject({ inSchedule: false, outcome: "failed", lastError: "gone" });
  });
});

describe("расписание для консоли", () => {
  it("все задачи планировщика, назначенный момент — тот же, что у догона", () => {
    const snap = jobsSnapshot(NOW);
    expect(snap.map(s => s.name)).toEqual(_internals.JOBS.map(j => j.name));
    const backup = snap.find(s => s.name === "backup")!;
    expect(backup.daily).toEqual({ hour: 3, minute: 0, weekday: null });
    expect(backup.lastDueAt?.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    const drill = snap.find(s => s.name === "restore-drill")!;
    // Воскресенье 05:00 по Ташкенту — 27.09.2026 00:00 UTC.
    expect(drill.lastDueAt?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(snap.find(s => s.name === "telegram-outbox")).toMatchObject({ everyMinutes: 5, lastDueAt: null });
  });
});

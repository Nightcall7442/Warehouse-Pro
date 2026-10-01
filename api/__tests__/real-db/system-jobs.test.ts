import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";

/**
 * Фоновые задачи в консоли платформы (system.jobs) — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Планировщик пишет в cron_runs, когда задача удалась и когда упала, — а
 * прочитать журнал было нечем: о пропущенной ночной копии узнавали по
 * тревоге через 26 часов, об упавшей рассылке — никак.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящая ручка system.jobs против настоящей таблицы cron_runs:
 *   · все задачи расписания в ответе, у каждой — расписание и итог;
 *   · удачная — «ok», ошибка позже удачи — «failed» с текстом, нет строки —
 *     «never», частая без удачи дольше трёх периодов — «overdue»;
 *   · строка журнала без задачи в расписании не теряется (inSchedule: false);
 *   · ручка только читает: строки журнала после вызова те же;
 *   · только суперадмину — директору и оператору отказ.
 * Правило итога на любой час суток — api/__tests__/cron-jobs-describe.test.ts.
 *
 * Нарочная поломка (проверено): объявить ручку на authedQuery — падает
 * «только суперадмину»; не читать cron_runs (пустой список строк) — падает
 * «итоги»; выбрасывать сирот — «без расписания».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());

const MIN = 60_000;
const wholeSec = (t: number) => new Date(Math.floor(t / 1000) * 1000);
const ago = (ms: number) => wholeSec(Date.now() - ms);

describe.skipIf(!hasRealDb)("фоновые задачи на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    await d().execute(sql`DELETE FROM cron_runs`);
    await d().insert(schema.cronRuns).values([
      { job: "backup", lastSuccessAt: ago(MIN) },
      { job: "debt-reminders", lastSuccessAt: ago(120 * MIN), lastErrorAt: ago(60 * MIN), lastError: "SMTP: connect ECONNREFUSED" },
      { job: "telegram-outbox", lastSuccessAt: ago(60 * MIN) },
      { job: "admin-digest", lastSuccessAt: ago(MIN), lastErrorAt: ago(3 * 86_400_000), lastError: "давно прошло" },
      { job: "legacy-export", lastSuccessAt: ago(30 * 86_400_000) },
    ]);
  });

  const jobs = async (role = "superadmin") => {
    const { systemRouter } = await import("../../system-router");
    return systemRouter.createCaller(ctxFor(db, 1, 1, role)).jobs();
  };

  it("итоги: удачно, упала с текстом, не запускалась, просрочена", async () => {
    const { jobs: rows } = await jobs();
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    expect(by.backup).toMatchObject({ outcome: "ok", inSchedule: true, daily: { hour: 3, minute: 0, weekday: null }, lastError: null });
    expect(by["debt-reminders"]).toMatchObject({ outcome: "failed", lastError: "SMTP: connect ECONNREFUSED" });
    expect(by["admin-digest"], "старая ошибка до удачи — не «упала»").toMatchObject({ outcome: "ok", lastError: null });
    expect(by["telegram-outbox"]).toMatchObject({ outcome: "overdue", everyMinutes: 5 });
    expect(by["restore-drill"]).toMatchObject({ outcome: "never", lastSuccessAt: null, daily: { weekday: 0 } });
  });

  it("все задачи расписания в ответе; сирота из журнала — в конце", async () => {
    const { _internals } = await import("../../cron/scheduler");
    const { jobs: rows } = await jobs();
    expect(rows.filter(r => r.inSchedule).map(r => r.name)).toEqual(_internals.JOBS.map(j => j.name));
    expect(rows.at(-1)).toMatchObject({ name: "legacy-export", inSchedule: false, outcome: "ok" });
  });

  it("только читает: журнал после вызова тот же", async () => {
    const before = await d().select().from(schema.cronRuns);
    await jobs();
    const after = await d().select().from(schema.cronRuns);
    expect(after).toEqual(before);
  });

  it("только суперадмину", async () => {
    for (const role of ["ceo", "operator"]) {
      await expect(jobs(role)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

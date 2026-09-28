/**
 * Расписание при остановке процесса.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * stopScheduler был написан и не вызывался ниоткуда. По SIGTERM процесс
 * закрывал пул и выходил, не глядя на идущую работу: ночную копию базы, перенос
 * фото, учебное восстановление — пул закрывался прямо под ними. А тик догона,
 * закончив копию, брал следующую работу — уже во время остановки.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * runningJobs() видит идущую работу, пока она не закончилась, — по нему
 * остановка её дожидается; после stopScheduler() идущий тик доделывает
 * начатое, но следующую работу не берёт.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const conn = {
  query: vi.fn(async () => [[{ ok: 1 }]]),
  release: vi.fn(),
};
vi.mock("../queries/connection", () => ({
  getPool: () => ({ getConnection: async () => conn }),
  getDb: vi.fn(() => { throw new Error("в этой проверке база — подменённый store"); }),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/telegram", () => ({ notifyAdmin: vi.fn(async () => {}), tgMessages: { cronFailed: () => "" } }));

const { _internals, stopScheduler, runningJobs } = await import("../cron/scheduler");
const { store, tick, JOBS } = _internals;
const job = (name: string) => JOBS.find(j => j.name === name)!;

/** Час и минута по Ташкенту (UTC+5), сентябрь 2026. */
const TK = 5 * 3600_000;
const tk = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, day, h, m) - TK);

function gate(): { p: Promise<void>; open: () => void } {
  let open!: () => void;
  const p = new Promise<void>(r => { open = r; });
  return { p, open };
}

let loaded: Array<{ job: string; lastSuccessAt: Date | null }> = [];

beforeEach(() => {
  _internals.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(tk(8, 6, 0));
  for (const j of JOBS) vi.spyOn(j, "run").mockResolvedValue(undefined);
  vi.spyOn(store, "load").mockImplementation(async () => loaded);
  vi.spyOn(store, "lastSuccess").mockImplementation(async j => loaded.find(r => r.job === j)?.lastSuccessAt ?? null);
  vi.spyOn(store, "saveSuccess").mockResolvedValue();
  vi.spyOn(store, "saveFailure").mockResolvedValue();
  // Копия и уборка не снимались этой ночью — догон возьмёт обе, по очереди.
  loaded = [
    { job: "backup", lastSuccessAt: tk(7, 3, 4) },
    { job: "support-cleanup", lastSuccessAt: tk(7, 3, 31) },
  ];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("расписание при остановке процесса", () => {
  it("идущая работа видна остановке, пока не закончится", async () => {
    const backup = gate();
    vi.spyOn(job("backup"), "run").mockImplementation(async () => { await backup.p; });

    expect(runningJobs()).toBe(0);
    const ticking = tick(tk(8, 6, 0));
    await vi.waitFor(() => expect(runningJobs()).toBe(1));

    backup.open();
    await ticking;
    expect(runningJobs()).toBe(0);
  });

  it("после остановки идущий тик доделывает копию, но уборку уже не берёт", async () => {
    const order: string[] = [];
    const backup = gate();
    vi.spyOn(job("backup"), "run").mockImplementation(async () => { await backup.p; order.push("backup"); });
    vi.spyOn(job("support-cleanup"), "run").mockImplementation(async () => { order.push("support-cleanup"); });

    const ticking = tick(tk(8, 6, 0));
    await vi.waitFor(() => expect(runningJobs()).toBe(1));
    stopScheduler();

    backup.open();
    await ticking;
    expect(order).toEqual(["backup"]);
    expect(runningJobs()).toBe(0);
  });

  it("без остановки тот же тик берёт уборку следом — проверка выше не пустая", async () => {
    const order: string[] = [];
    vi.spyOn(job("backup"), "run").mockImplementation(async () => { order.push("backup"); });
    vi.spyOn(job("support-cleanup"), "run").mockImplementation(async () => { order.push("support-cleanup"); });
    await tick(tk(8, 6, 0));
    expect(order).toEqual(["backup", "support-cleanup"]);
  });
});

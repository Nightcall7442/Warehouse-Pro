/**
 * Пропущенная ежедневная работа догоняется, а не ждёт завтрашней минуты.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ежедневная работа срабатывала ровно в свою минуту — и только в неё. Перезапуск
 * в 02:59 с подъёмом в 03:02 — и копии за ночь нет. Хранилище ответило
 * «повторите позже» (так и было 13.09: «A timeout occurred while trying to lock
 * a resource») — копии нет до завтра. Узнать можно было только по тревоге
 * через 26 часов.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Пропущенное выполняется при первой возможности и ровно один раз; провал
 * повторяется раз в час и сообщается один раз; напоминания не догоняются, когда
 * их время прошло; работа без единой удачи идёт как прежде; отметки, которых
 * не удалось прочитать, не превращаются в повторную рассылку; уборки при
 * догоне по-прежнему идут ПОСЛЕ копии.
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
const notifyAdmin = vi.fn(async (_text: string) => {});
vi.mock("../lib/telegram", () => ({
  notifyAdmin,
  tgMessages: { cronFailed: (job: string, error: string, retry?: boolean) => `${job}|${error}|${retry}` },
}));

const { _internals } = await import("../cron/scheduler");
const { store, tick, JOBS } = _internals;
const job = (name: string) => JOBS.find(j => j.name === name)!;

/** Час и минута по Ташкенту (UTC+5) в сентябре 2026: 8-е — вторник, 13-е — воскресенье. */
const TK = 5 * 3600_000;
const tk = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, day, h, m) - TK);

/** Тик «в такой-то момент»: часы процесса переводятся туда же, чтобы отметка удачи легла в то же время. */
async function at(when: Date): Promise<void> {
  vi.setSystemTime(when);
  await tick(when);
}

let loaded: Array<{ job: string; lastSuccessAt: Date | null }> = [];

beforeEach(() => {
  _internals.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  loaded = [];
  // Остальные работы в этой проверке — пустышки: настоящие полезли бы в базу.
  for (const j of JOBS) vi.spyOn(j, "run").mockResolvedValue(undefined);
  vi.spyOn(store, "load").mockImplementation(async () => loaded);
  vi.spyOn(store, "lastSuccess").mockImplementation(async j => loaded.find(r => r.job === j)?.lastSuccessAt ?? null);
  vi.spyOn(store, "saveSuccess").mockResolvedValue();
  vi.spyOn(store, "saveFailure").mockResolvedValue();
  notifyAdmin.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("догон пропущенной ежедневной работы", () => {
  it("копия, не снятая в 03:00, снимается при первом же тике — и только раз", async () => {
    loaded = [{ job: "backup", lastSuccessAt: tk(7, 3, 4) }];
    const run = vi.spyOn(job("backup"), "run").mockResolvedValue("ok");

    await at(tk(8, 6, 0)); // процесс поднялся в шесть утра
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.saveSuccess).toHaveBeenCalledWith("backup", expect.any(Date));

    await at(tk(8, 6, 1));
    await at(tk(8, 12, 0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("сделанная сегодня — не повторяется", async () => {
    loaded = [{ job: "backup", lastSuccessAt: tk(8, 3, 5) }];
    const run = vi.spyOn(job("backup"), "run").mockResolvedValue("ok");
    await at(tk(8, 6, 0));
    expect(run).not.toHaveBeenCalled();
  });

  it("провал повторяется раз в час, суперадмину — одно сообщение, до удачи", async () => {
    loaded = [{ job: "backup", lastSuccessAt: tk(7, 3, 4) }];
    const run = vi.spyOn(job("backup"), "run").mockRejectedValue(new Error("SlowDown"));

    await at(tk(8, 3, 0));
    expect(run).toHaveBeenCalledTimes(1);
    expect(notifyAdmin).toHaveBeenCalledTimes(1);
    expect(notifyAdmin).toHaveBeenCalledWith("backup|SlowDown|true");

    await at(tk(8, 3, 30));
    expect(run).toHaveBeenCalledTimes(1); // час не прошёл

    await at(tk(8, 4, 1));
    expect(run).toHaveBeenCalledTimes(2);
    expect(notifyAdmin).toHaveBeenCalledTimes(1); // о том же провале — молчим
    expect(store.saveFailure).toHaveBeenCalledTimes(2);

    run.mockResolvedValue("ok");
    await at(tk(8, 5, 2));
    expect(run).toHaveBeenCalledTimes(3);
    await at(tk(8, 6, 3));
    expect(run).toHaveBeenCalledTimes(3); // удача записана — больше не пробуем
  });

  it("напоминание о долгах догоняется в течение трёх часов…", async () => {
    loaded = [{ job: "debt-reminders", lastSuccessAt: tk(7, 9, 1) }];
    const run = vi.spyOn(job("debt-reminders"), "run").mockResolvedValue(undefined);
    await at(tk(8, 11, 0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("…а позже — нет: напоминание в полночь никому не нужно", async () => {
    loaded = [{ job: "debt-reminders", lastSuccessAt: tk(7, 9, 1) }];
    const run = vi.spyOn(job("debt-reminders"), "run").mockResolvedValue(undefined);
    await at(tk(8, 12, 1));
    expect(run).not.toHaveBeenCalled();
  });

  it("работа без единой удачи идёт как прежде — ровно в свою минуту", async () => {
    /*
      Без отметки планировщик не знает, делалась ли работа сегодня старым
      процессом. Догонять «на всякий случай» — это после каждой выкладки слать
      напоминания второй раз.
    */
    const run = vi.spyOn(job("backup"), "run").mockResolvedValue("ok");
    await at(tk(8, 6, 0));
    expect(run).not.toHaveBeenCalled();
    await at(tk(9, 3, 0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("отметки не прочитались (база лежала на старте) — догона нет, минута работает", async () => {
    vi.spyOn(store, "load").mockRejectedValue(new Error("connect ECONNREFUSED"));
    const run = vi.spyOn(job("backup"), "run").mockResolvedValue("ok");
    await at(tk(8, 6, 0));
    expect(run).not.toHaveBeenCalled();
    await at(tk(9, 3, 0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("при догоне уборка идёт ПОСЛЕ копии, даже если копия долгая", async () => {
    /*
      Уборка стирает безвозвратно; в копии, снятой до неё, стёртое ещё есть.
      Догоняя обе разом, нельзя пустить их вперемешку.
    */
    loaded = [
      { job: "backup", lastSuccessAt: tk(7, 3, 4) },
      { job: "support-cleanup", lastSuccessAt: tk(7, 3, 31) },
    ];
    const order: string[] = [];
    vi.spyOn(job("backup"), "run").mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push("backup");
    });
    vi.spyOn(job("support-cleanup"), "run").mockImplementation(async () => { order.push("support-cleanup"); });
    await at(tk(8, 6, 0));
    expect(order).toEqual(["backup", "support-cleanup"]);
  });

  it("вторая реплика не догоняет то, что первая уже сделала", async () => {
    /*
      Отметки читаются при старте. Первая реплика сняла копию в 03:00, вторая
      в тот момент не взяла замок — и через час, по своей вчерашней отметке,
      пошла бы снимать вторую. Для напоминаний это дубли у всех получателей.
    */
    loaded = [{ job: "debt-reminders", lastSuccessAt: tk(7, 9, 1) }];
    const run = vi.spyOn(job("debt-reminders"), "run").mockResolvedValue(undefined);
    conn.query.mockResolvedValueOnce([[{ ok: 0 }]]); // замок у соседа
    await at(tk(8, 9, 1)); // в 09:00 замок спросила бы ещё и частая очередь
    expect(run).not.toHaveBeenCalled();

    loaded = [{ job: "debt-reminders", lastSuccessAt: tk(8, 9, 2) }]; // сосед записал удачу
    await at(tk(8, 10, 1));
    expect(run).not.toHaveBeenCalled();
  });

  it("частая работа догона не знает и не ждёт ежедневных", async () => {
    loaded = [{ job: "backup", lastSuccessAt: tk(7, 3, 4) }];
    vi.spyOn(job("backup"), "run").mockImplementation(() => new Promise(r => setTimeout(r, 30)));
    const outbox = vi.spyOn(job("telegram-outbox"), "run").mockResolvedValue(undefined);
    const t = at(tk(8, 6, 0));
    await vi.waitFor(() => expect(outbox).toHaveBeenCalledTimes(1));
    await t;
  });
});

describe("назначенный момент", () => {
  const { lastDue, dueSlot } = _internals;

  it("до своего часа — вчерашний, после — сегодняшний", () => {
    expect(lastDue(job("backup"), tk(8, 2, 0))).toEqual(tk(7, 3, 0));
    expect(lastDue(job("backup"), tk(8, 3, 0))).toEqual(tk(8, 3, 0));
    expect(lastDue(job("backup"), tk(8, 23, 59))).toEqual(tk(8, 3, 0));
  });

  it("еженедельная — в свой день недели, догоняется сутки", () => {
    // 13.09.2026 — воскресенье, репетиция в 05:00.
    expect(lastDue(job("restore-drill"), tk(14, 6, 0))).toEqual(tk(13, 5, 0));
    expect(lastDue(job("restore-drill"), tk(12, 6, 0))).toEqual(tk(6, 5, 0));
    expect(dueSlot(job("restore-drill"), tk(13, 6, 0))).toEqual(tk(13, 5, 0));
    expect(dueSlot(job("restore-drill"), tk(14, 6, 0))).toBeNull(); // окно суток прошло
  });
});

/**
 * Отказ базы в минуту тика не роняет процесс.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * runExclusively брал соединение из пула ДО try/catch, а тик запускал работу
 * через `void runExclusively(job)` — без единого catch на всём пути. Когда
 * MySQL перезапускалась или сеть моргала ровно в ту минуту, getConnection
 * отклонял промис, ловить отказ было некому, и Node 22 завершал процесс
 * целиком. Работа telegram-outbox идёт каждые пять минут, так что любой сбой
 * базы дольше пяти минут почти наверняка попадал на тик — и кратковременная
 * недоступность базы превращалась в падение всего приложения для всех
 * организаций, а после десяти перезапусков Railway — в простой до ручного
 * вмешательства.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. runExclusively при отказе getConnection ЗАВЕРШАЕТСЯ, а не отклоняется:
 *    именно отклонение и было смертельным.
 * 2. Отказ не молчит: пишется в журнал с именем работы.
 * 3. В boot.ts стоят обработчики unhandledRejection и uncaughtException —
 *    последняя линия защиты от следующего забытого `void`.
 *
 * Нарочная поломка: верни `const conn = await pool.getConnection()` наружу
 * из try — первая проверка падает с «promise rejected».
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getConnection = vi.fn();
vi.mock("../queries/connection", () => ({
  getPool: () => ({ getConnection }),
  getDb: vi.fn(),
}));

const logged = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock("../lib/logger", () => ({ logger: logged }));

const { _internals } = await import("../cron/scheduler");

describe("тик планировщика при недоступной базе", () => {
  it("runExclusively завершается, а не отклоняется", async () => {
    getConnection.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:3306"));
    const job = _internals.JOBS.find(j => j.name === "telegram-outbox")!;
    const run = vi.spyOn(job, "run");

    await expect(_internals.runExclusively(job)).resolves.toBeUndefined();

    // Работа не запускалась: без соединения замок взять нельзя.
    expect(run).not.toHaveBeenCalled();
  });

  it("отказ записан в журнал с именем работы", () => {
    const call = logged.error.mock.calls.find(([msg]) => String(msg).includes("database unavailable"));
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ job: "telegram-outbox", error: expect.stringContaining("ECONNREFUSED") });
  });

  it("boot.ts держит обработчики unhandledRejection и uncaughtException", () => {
    const src = readFileSync(resolve(__dirname, "../boot.ts"), "utf-8");
    expect(src).toMatch(/process\.on\("unhandledRejection"/);
    expect(src).toMatch(/process\.on\("uncaughtException"/);
    // Исключение вне промиса — выход с ненулевым кодом, чтобы Railway перезапустил.
    expect(src).toMatch(/uncaughtException[\s\S]{0,400}process\.exit\(1\)/);
  });
});

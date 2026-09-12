import { describe, it, expect, vi } from "vitest";

/**
 * Ночная копия упала с «A timeout occurred while trying to lock a resource,
 * please reduce your request rate» — MinIO на одном узле держал блокировку
 * несколько секунд. Такое хранилище просит подождать, а не отказывает.
 *
 * Нарочная поломка: в withStorageRetry поставь `RETRY_ATTEMPTS = 1` — первая
 * проверка увидит отказ после одной попытки.
 */
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { withStorageRetry } = await import("../cron/backup");
const noSleep = async () => {};

describe("копия переживает «не сейчас» от хранилища", () => {
  it("SlowDown дважды подряд — третья попытка проходит, работа удачна", async () => {
    let calls = 0;
    const result = await withStorageRetry("primary", async () => {
      calls++;
      if (calls < 3) throw new Error("A timeout occurred while trying to lock a resource, please reduce your request rate");
      return "ok";
    }, noSleep);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("временная ошибка каждый раз — сдаёмся после пятой попытки с той же ошибкой", async () => {
    let calls = 0;
    await expect(withStorageRetry("offsite", async () => { calls++; throw new Error("connect ECONNRESET"); }, noSleep))
      .rejects.toThrow("ECONNRESET");
    expect(calls).toBe(5);
  });

  it("«нет доступа» не повторяется — это не временно", async () => {
    let calls = 0;
    await expect(withStorageRetry("primary", async () => { calls++; throw new Error("AccessDenied: no permission"); }, noSleep))
      .rejects.toThrow("AccessDenied");
    expect(calls).toBe(1);
  });

  it("пауза растёт: 2, 4, 8, 16 секунд", async () => {
    delete process.env.BACKUP_RETRY_BASE_MS;
    const waits: number[] = [];
    let calls = 0;
    await expect(withStorageRetry("primary", async () => { calls++; throw new Error("SlowDown"); }, async ms => { waits.push(ms); }))
      .rejects.toThrow("SlowDown");
    expect(waits).toEqual([2000, 4000, 8000, 16000]);
  });
});

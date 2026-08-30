import { describe, it, expect, vi } from "vitest";
import { withMigrationLock } from "../lib/migration-lock";

/**
 * Замок на время миграций.
 *
 * Пока реплика одна, он ничего не меняет. Со второй начинается гонка: при
 * выкладке обе стартуют разом, обе читают одно состояние журнала миграций и
 * обе принимаются за один и тот же DDL. Проигравшая получает «Table already
 * exists» и выходит из процесса — из-за соседа, а не из-за поломки.
 *
 * Проверяется не «работает ли GET_LOCK» (это забота MySQL), а то, что мы
 * пользуемся им правильно: берём до работы, отпускаем всегда, не начинаем
 * работу, если не дождались, и держим замок на одном соединении — с другого
 * его не отпустить.
 */

type Call = { sql: string; values?: unknown[] };

function fakePool(getLockResult: number | null) {
  const calls: Call[] = [];
  let released = 0;
  const connections: object[] = [];

  const pool = {
    getConnection: async () => {
      const conn = {
        query: async (sql: string, values?: unknown[]) => {
          calls.push({ sql, values });
          if (sql.includes("GET_LOCK")) return [[{ ok: getLockResult }]];
          return [[{ ok: 1 }]];
        },
        release: () => { released++; },
      };
      connections.push(conn);
      return conn;
    },
  };

  return { pool, calls, connections, releasedCount: () => released };
}

describe("Замок на миграции", () => {
  it("берёт замок, делает работу, отпускает — в этом порядке", async () => {
    const { pool, calls, releasedCount } = fakePool(1);
    const order: string[] = [];

    const result = await withMigrationLock(pool, async () => {
      order.push("миграции");
      return "готово";
    });

    expect(result).toBe("готово");
    expect(calls[0].sql).toContain("GET_LOCK");
    expect(order).toEqual(["миграции"]);
    expect(calls[1].sql).toContain("RELEASE_LOCK");
    // Соединение возвращается в пул, иначе пул иссякнет.
    expect(releasedCount()).toBe(1);
  });

  it("замок берётся и отпускается на ОДНОМ соединении", async () => {
    // GET_LOCK привязан к соединению: отпустить его с другого нельзя, и такой
    // замок провисел бы до конца жизни процесса.
    const { pool, connections } = fakePool(1);
    await withMigrationLock(pool, async () => undefined);
    expect(connections).toHaveLength(1);
  });

  it("не начинает миграции, если не дождался очереди", async () => {
    // GET_LOCK вернул 0 — истекло время ожидания, замок держит сосед.
    const { pool } = fakePool(0);
    const run = vi.fn();

    await expect(withMigrationLock(pool, run)).rejects.toThrow(/не дождались очереди/);
    // Главное: работа НЕ выполнена. Иначе весь замок бессмыслен.
    expect(run).not.toHaveBeenCalled();
  });

  it("не начинает миграции, если база не смогла выдать замок", async () => {
    const { pool } = fakePool(null);
    const run = vi.fn();

    await expect(withMigrationLock(pool, run)).rejects.toThrow(/не смогла выдать замок/);
    expect(run).not.toHaveBeenCalled();
  });

  it("отпускает замок, даже если миграция упала", async () => {
    // Иначе соседние реплики будут ждать полные пять минут вместо того, чтобы
    // сразу получить свой отказ, — а выкладка тем временем встанет.
    const { pool, calls, releasedCount } = fakePool(1);

    await expect(
      withMigrationLock(pool, async () => { throw new Error("Duplicate column name"); }),
    ).rejects.toThrow("Duplicate column name");

    expect(calls.some(c => c.sql.includes("RELEASE_LOCK"))).toBe(true);
    expect(releasedCount()).toBe(1);
  });

  it("время ожидания задано и конечно", async () => {
    // Без него реплика висела бы молча и без объяснений.
    const { pool, calls } = fakePool(1);
    await withMigrationLock(pool, async () => undefined);

    const [name, timeout] = calls[0].values as [string, number];
    expect(name).toBe("warehouse_pro:migrate");
    expect(timeout).toBeGreaterThan(0);
    expect(Number.isFinite(timeout)).toBe(true);
  });
});

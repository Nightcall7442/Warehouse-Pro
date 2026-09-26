import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSeedTarget, allTables } from "../../db/seed-reset";

// clear.ts запускается здесь по-настоящему: адрес базы — подменный, getDb — шпион.
const h = vi.hoisted(() => ({ databaseUrl: "", getDb: vi.fn() }));
vi.mock("../../api/lib/env", () => ({ env: { get databaseUrl() { return h.databaseUrl; } } }));
vi.mock("../../api/queries/connection", async (orig) => ({ ...(await orig<typeof import("../../api/queries/connection")>()), getDb: h.getDb }));

/**
 * Засев: на боевой базе — отказ; на локальной — чистит всё.
 *
 * Засев стирает данные всех организаций. До 25.09.2026 он не проверял, куда
 * смотрит DATABASE_URL, а его уборка знала 24 таблицы из 58 связанных
 * ключами — повторный засев падал на «delete from users».
 *
 * Нарочная поломка: в assertSeedTarget убери проверку isRemoteHost —
 * падает «боевая база — отказ»; верни в seed.ts список db.delete вместо
 * wipeAll — падает «засев чистит через wipeAll».
 */
describe("засев и боевая база", () => {
  it("боевая база — отказ", () => {
    for (const url of [
      "mysql://root:secret@roundhouse.proxy.rlwy.net:41234/railway",
      "mysql://root:secret@mysql.railway.internal:3306/railway",
      "mysql://u:p@db.example.com/wp",
    ]) expect(() => assertSeedTarget(url, false), url).toThrow(/не локальная/);
  });

  it("неразобранный адрес — тоже отказ, а не «видимо, локальный»", () => {
    expect(() => assertSeedTarget("не адрес", false)).toThrow(/Отказ/);
  });

  it("локальная база — можно; удалённая — только явным SEED_ALLOW_REMOTE", () => {
    expect(() => assertSeedTarget("mysql://root@127.0.0.1:3307/wp", false)).not.toThrow();
    expect(() => assertSeedTarget("mysql://root@localhost/wp", false)).not.toThrow();
    expect(() => assertSeedTarget("mysql://u:p@db.example.com/wp", true)).not.toThrow();
  });
});

describe("нормы в засеве", () => {
  /*
    «Показатели» супервайзера в мобилке и нормы в вебе на демо были пустыми:
    засев не создавал sales_targets вовсе. Нормы месячные, в текущем месяце
    (так их ищет salesTarget.summary), план — от факта того же
    actualsForTargets, что у сервера.
    Нарочная поломка: убери вставку salesTargets — падает этот тест.
  */
  it("засев ставит месячные нормы от факта сервера", () => {
    const seed = readFileSync(join(process.cwd(), "db/seed.ts"), "utf-8");
    expect(seed).toMatch(/db\.insert\(schema\.salesTargets\)\.values\(\{[\s\S]*?periodType: "monthly"/);
    expect(seed).toMatch(/const month = monthRange\(new Date\(\)\)/);
    expect(seed).toMatch(/await actualsForTargets\(db, tenantId,/);
  });
});

describe("уборка засева", () => {
  it("чистит каждую таблицу схемы", () => {
    const declared = (readFileSync(join(process.cwd(), "db/schema.ts"), "utf-8").match(/=\s*mysqlTable\(/g) ?? []).length;
    expect(declared).toBeGreaterThan(40);
    expect(allTables().length).toBe(declared);
  });

  it("засев чистит через wipeAll, а проверка базы — до первого запроса", () => {
    const seed = readFileSync(join(process.cwd(), "db/seed.ts"), "utf-8");
    // Очистка таблицы целиком (без where) — только через wipeAll; точечное
    // удаление строки с условием засеву не запрещено.
    expect(seed).not.toMatch(/await db\.delete\(schema\.\w+\);/);
    expect(seed).toMatch(/await wipeAll\(db\)/);
    expect(seed).toMatch(/async function seed\(\) \{\s*assertSeedTarget\(env\.databaseUrl\);\s*const db = getDb\(\);/);
  });
});

/*
  npm run db:reset начинается с clear.ts, а проверка базы стояла только в
  засеве — третьем шаге. clear.ts стирал данные всех организаций, куда бы ни
  смотрел DATABASE_URL, и засев отказывался уже над пустой базой (26.09.2026).
  Нарочная поломка: убери assertSeedTarget из clear.ts или поставь его после
  getDb() — падает «удалённая база»; верни ручной список db.delete вместо
  wipeAll — падает «локальная база».
*/
describe("db:reset: clear.ts", () => {
  async function runClear(url: string) {
    const deleted: unknown[] = [];
    h.databaseUrl = url;
    h.getDb.mockReset().mockReturnValue({
      transaction: async (cb: (tx: unknown) => Promise<void>) => cb({ execute: async () => undefined, delete: async (t: unknown) => { deleted.push(t); } }),
    });
    const allow = process.env.SEED_ALLOW_REMOTE;
    process.env.SEED_ALLOW_REMOTE = "0";
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    try {
      vi.resetModules();
      await import("../../db/clear");
      await vi.waitFor(() => { if (exit.mock.calls.length === 0) throw new Error("clear.ts не завершился"); });
      return { code: exit.mock.calls[0][0], dbTouched: h.getDb.mock.calls.length > 0, deleted: deleted.length };
    } finally {
      exit.mockRestore();
      quiet.forEach(s => s.mockRestore());
      if (allow === undefined) delete process.env.SEED_ALLOW_REMOTE; else process.env.SEED_ALLOW_REMOTE = allow;
    }
  }

  it("удалённая база — отказ до первого запроса", async () => {
    const r = await runClear("mysql://root:secret@roundhouse.proxy.rlwy.net:41234/railway");
    expect(r).toEqual({ code: 1, dbTouched: false, deleted: 0 });
  });

  it("локальная база — чистит каждую таблицу схемы (wipeAll)", async () => {
    const r = await runClear("mysql://root@127.0.0.1:3307/wp");
    expect(r).toEqual({ code: 0, dbTouched: true, deleted: allTables().length });
  });
});

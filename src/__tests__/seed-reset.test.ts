import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSeedTarget, allTables } from "../../db/seed-reset";

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

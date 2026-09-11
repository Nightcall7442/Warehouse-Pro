import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, TEST_DATABASE_URL, type ServiceDb } from "./harness";

/**
 * Репетиция восстановления на настоящей базе: снять копию той же службой,
 * что и ночью, развернуть её в черновую базу на том же сервере и сверить
 * числа. Копия, которую никто не разворачивал, — надежда, а не копия.
 *
 * DATABASE_URL подставляется до первого импорта env: и выгрузка, и
 * разворачивание читают адрес оттуда.
 */
describe.skipIf(!hasRealDb)("репетиция восстановления", () => {
  let db: ServiceDb;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await connectRealDb();
    await truncateAll();
    await seed("10.000");
  }, 120_000);
  afterAll(async () => { await closeRealDb(); });

  it("копия снимается, разворачивается в черновую базу и сходится по числам", async () => {
    const { startDump } = await import("../../services/db-dump");
    const { restoreAndVerify, scratchDatabaseName } = await import("../../cron/restore-drill");
    const { parseDatabaseUrl } = await import("../../services/db-dump");

    const { stream } = await startDump();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = gunzipSync(Buffer.concat(chunks)).toString("utf8");
    expect(text).toContain("CREATE TABLE `orders`");

    const counts = {
      tenants: await countOf("tenants"), users: await countOf("users"), products: await countOf("products"),
      shops: await countOf("shops"), warehouse_stock: await countOf("warehouse_stock"),
    };
    expect(counts.products).toBeGreaterThan(0);

    const r = await restoreAndVerify(TEST_DATABASE_URL, text, counts);
    expect(r.restored.products).toBe(counts.products);
    expect(r.restored.warehouse_stock).toBe(counts.warehouse_stock);

    // Черновая база стёрта; боевая (тестовая) не тронута.
    const scratch = scratchDatabaseName(parseDatabaseUrl(TEST_DATABASE_URL).database);
    const [rows] = await db.execute(sql`SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${scratch}`) as unknown as [Array<{ s: string }>];
    expect(rows).toHaveLength(0);
    expect(await countOf("products")).toBe(counts.products);
  }, 120_000);

  it("расхождение чисел — отказ, а не «прошло»", async () => {
    const { startDump } = await import("../../services/db-dump");
    const { restoreAndVerify } = await import("../../cron/restore-drill");
    const { stream } = await startDump();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = gunzipSync(Buffer.concat(chunks)).toString("utf8");
    await expect(restoreAndVerify(TEST_DATABASE_URL, text, { products: 999_999 })).rejects.toThrow(/числа не сходятся/);
  }, 120_000);
});

/**
 * Стирает все таблицы — первый шаг npm run db:reset (дальше push и засев).
 *
 * До 26.09.2026 проверка базы (assertSeedTarget) стояла только в засеве —
 * третьем шаге. clear.ts шёл первым и стирал данные всех организаций, куда
 * бы ни смотрел DATABASE_URL: db:reset с боевым адресом стёр бы клиентов
 * раньше, чем засев успел бы отказаться. Теперь та же проверка — до первого
 * запроса, а уборка — та же wipeAll: ручной список знал 37 таблиц из 63
 * и падал на внешних ключах уже засеянной базы.
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { assertSeedTarget, wipeAll } from "./seed-reset";
import { env } from "../api/lib/env";

async function clear() {
  assertSeedTarget(env.databaseUrl);
  const db = getDb();
  console.log("🗑  Clearing all tables...");
  const wiped = await wipeAll(db);
  console.log(`✓ All tables cleared (${wiped}).`);
  process.exit(0);
}

clear().catch((err) => {
  console.error("Clear failed:", err.message ?? err);
  process.exit(1);
});

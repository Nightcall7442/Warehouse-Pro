/**
 * Срок хранения сырых GPS-точек.
 *
 * agent_locations росла без границ: точка на каждый вызов, ≤ 1 раз в две
 * минуты на движущегося агента, ни одной уборки в планировщике. Оценка —
 * 1–4 млн строк в год на нынешних 13 организациях; при росте это крупнейшая
 * таблица базы, она тянет за собой дамп и снимки, а карта «след за день»
 * читает историю месяцами. Плюс персональные геоданные сотрудников без
 * срока — это отдельный вопрос закона о персональных данных.
 *
 * Девяносто дней сырых точек: антифрод смотрит день, KPI — месяц, спор о
 * визите редко живёт дольше квартала. Дневные сводки, если понадобятся,
 * должны строиться до уборки — здесь их нет нарочно, пока их никто не просил.
 *
 * Пачками: одним DELETE на миллионы строк InnoDB держал бы замки и журнал
 * отката дольше, чем нужно. Пачка 10 000 по индексу created_at — секунды.
 */
import { sql } from "drizzle-orm";
import { agentLocations } from "@db/schema";
import { getDb } from "../queries/connection";
import { affectedRows } from "../lib/db-rows";

export const LOCATION_RETENTION_DAYS = 90;
const BATCH = 10_000;
// ponytail: потолок пачек за один запуск; при 10× росте поднять или чаще запускать.
const MAX_BATCHES = 50;

export async function purgeOldLocations(days = LOCATION_RETENTION_DAYS, now = new Date()): Promise<{ deleted: number; batches: number }> {
  const before = new Date(now.getTime() - days * 86_400_000);
  let deleted = 0;
  let batches = 0;
  for (; batches < MAX_BATCHES; batches++) {
    const r = await getDb().delete(agentLocations)
      .where(sql`${agentLocations.createdAt} < ${before}`)
      .limit(BATCH);
    const n = affectedRows(r) ?? 0;
    deleted += n;
    if (n < BATCH) { batches++; break; }
  }
  return { deleted, batches };
}

import { getDb } from '../queries/connection';
import { syncStatus } from '@db/schema';
import { eq, and, desc } from 'drizzle-orm';

export type SyncEntityType = 'product' | 'order' | 'shop' | 'arrival';
export type SyncDirection = 'to1c' | 'from1c';
export type SyncStatusType = 'pending' | 'processing' | 'completed' | 'failed';

export async function updateSyncStatus(
  tenantId: number,
  entityType: SyncEntityType,
  direction: SyncDirection,
  status: SyncStatusType,
  recordsProcessed?: number,
  error?: string,
) {
  const db = getDb();
  const existing = await db.select({ id: syncStatus.id, errorCount: syncStatus.errorCount })
    .from(syncStatus)
    .where(and(
      eq(syncStatus.tenantId, tenantId),
      eq(syncStatus.entityType, entityType),
      eq(syncStatus.direction, direction),
    ))
    .limit(1);

  /*
    Счёт отказов.

    Здесь стояло `errorCount: status === 'failed' ? undefined : 0`. При отказе
    поле пропускалось — drizzle не пишет undefined, — а при любом другом исходе
    обнулялось. То есть счётчик отказов не увеличивался НИКОГДА и вечно
    показывал ноль; экран настроек по нему рисовал зелёное «Ошибки: 0» ровно
    столько, сколько обмен падал.

    Предыдущее значение уже прочитано выборкой выше, поэтому прибавляем в JS, а
    не выражением `error_count + 1`: служебные заглушки в тестах разбирают
    обычные значения и не исполняют сырой SQL.
  */
  const data = {
    status,
    recordsProcessed: recordsProcessed ?? 0,
    lastSuccessfulSync: status === 'completed' ? new Date() : undefined,
    errorCount: status === 'failed' ? (existing[0]?.errorCount ?? 0) + 1 : 0,
    lastError: error,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db.update(syncStatus).set(data).where(eq(syncStatus.id, existing[0].id));
  } else {
    await db.insert(syncStatus).values({ tenantId, entityType, direction, ...data });
  }
}

export async function getSyncStatus(tenantId: number) {
  const db = getDb();
  return db.select().from(syncStatus)
    .where(eq(syncStatus.tenantId, tenantId))
    .orderBy(desc(syncStatus.updatedAt));
}

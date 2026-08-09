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
  const existing = await db.select({ id: syncStatus.id })
    .from(syncStatus)
    .where(and(
      eq(syncStatus.tenantId, tenantId),
      eq(syncStatus.entityType, entityType),
      eq(syncStatus.direction, direction),
    ))
    .limit(1);

  const data = {
    status,
    recordsProcessed: recordsProcessed ?? 0,
    lastSuccessfulSync: status === 'completed' ? new Date() : undefined,
    errorCount: status === 'failed' ? undefined : 0,
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

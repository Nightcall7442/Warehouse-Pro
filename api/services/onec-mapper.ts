import { eq, and } from "drizzle-orm";
import { idMappings } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export type EntityType = "product" | "order" | "shop" | "arrival";

export const OneCMapper = {
  async getInternalId(db: Db, tenantId: number, entityType: EntityType, externalId: string): Promise<number | null> {
    const result = await db.select({ internalId: idMappings.internalId })
      .from(idMappings)
      .where(and(
        eq(idMappings.tenantId, tenantId),
        eq(idMappings.entityType, entityType),
        eq(idMappings.externalId, externalId),
      ))
      .limit(1);
    return result[0]?.internalId ?? null;
  },

  async getExternalId(db: Db, tenantId: number, entityType: EntityType, internalId: number): Promise<string | null> {
    const result = await db.select({ externalId: idMappings.externalId })
      .from(idMappings)
      .where(and(
        eq(idMappings.tenantId, tenantId),
        eq(idMappings.entityType, entityType),
        eq(idMappings.internalId, internalId),
      ))
      .limit(1);
    return result[0]?.externalId ?? null;
  },

  async upsert(db: Db, tenantId: number, entityType: EntityType, externalId: string, internalId: number): Promise<void> {
    const existing = await this.getInternalId(db, tenantId, entityType, externalId);
    if (existing !== null) {
      await db.update(idMappings)
        .set({ internalId, lastSyncedAt: new Date() })
        .where(and(
          eq(idMappings.tenantId, tenantId),
          eq(idMappings.entityType, entityType),
          eq(idMappings.externalId, externalId),
        ));
    } else {
      await db.insert(idMappings).values({
        tenantId, entityType, externalId, internalId,
      });
    }
  },

  async getAll(db: Db, tenantId: number, entityType: EntityType) {
    return db.select().from(idMappings)
      .where(and(
        eq(idMappings.tenantId, tenantId),
        eq(idMappings.entityType, entityType),
      ));
  },
};
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products, orders, orderItems } from "@db/schema";
import { getBridge } from "../lib/onec-bridge";
import { OneCMapper } from "./onec-mapper";
import { mapProduct1C, mapOrder1C, mapUnit } from "./onec-transform";
import type { Product1C } from "./onec-transform";
import { logger } from "../lib/logger";
import { updateSyncStatus } from "./onec-status";
import { record1CSync } from "../lib/metrics";

export class OneCSyncService {
  async syncProducts(tenantId: number): Promise<{ synced: number; errors: number }> {
    const db = getDb();
    const bridge = getBridge();
    let synced = 0;
    let errors = 0;
    const startTime = Date.now();

    try {
      await updateSyncStatus(tenantId, "product", "from1c", "processing");
      const items = await bridge.odataQuery<Product1C>("Catalog_Номенклатура", {
        $top: "500",
        $select: "Ref_Key,Code,Description,Price,Unit",
      });

      for (const item of items) {
        try {
          const mapped = mapProduct1C(item);
          const internalId = await OneCMapper.getInternalId(db, tenantId, "product", item.Ref_Key);

          if (internalId) {
            await db
              .update(products)
              .set({
                name: mapped.name,
                code: mapped.code,
                unitPrice: mapped.unitPrice,
                unit: mapUnit(mapped.unit),
              })
              .where(eq(products.id, internalId));
          } else {
            const [result] = await db
              .insert(products)
              .values({
                tenantId,
                name: mapped.name,
                code: mapped.code,
                unitPrice: mapped.unitPrice,
                unit: mapUnit(mapped.unit),
                category: mapped.category,
              });

            await OneCMapper.upsert(db, tenantId, "product", item.Ref_Key, Number(result.insertId));
          }
          synced++;
        } catch (e) {
          errors++;
          logger.error(`Failed to sync product ${item.Ref_Key}`, {
            error: String(e),
            externalId: item.Ref_Key,
          });
        }
      }

      logger.info(`Product sync completed: ${synced} synced, ${errors} errors`, {
        tenantId,
      });
      await updateSyncStatus(tenantId, "product", "from1c", "completed", synced);
      record1CSync("product", "from1c", Date.now() - startTime, errors === 0);
    } catch (e) {
      logger.error(`Product sync failed for tenant ${tenantId}`, { error: String(e) });
      await updateSyncStatus(tenantId, "product", "from1c", "failed", synced, String(e));
      record1CSync("product", "from1c", Date.now() - startTime, false);
      throw e;
    }

    return { synced, errors };
  }

  async syncOrderTo1C(tenantId: number, orderId: number): Promise<void> {
    const db = getDb();
    const bridge = getBridge();
    const startTime = Date.now();

    try {
      await updateSyncStatus(tenantId, "order", "to1c", "processing");

      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order[0]) throw new Error(`Order ${orderId} not found`);

      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const shopExternalId = await OneCMapper.getExternalId(db, tenantId, "shop", order[0].shopId);

      if (!shopExternalId) {
        throw new Error(`Shop ${order[0].shopId} not mapped to 1C`);
      }

      const mappedItems = [];
      for (const item of items) {
        const productExternalId = await OneCMapper.getExternalId(db, tenantId, "product", item.productId);
        if (productExternalId) {
          mappedItems.push({
            productExternalId,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
          });
        }
      }

      const doc = mapOrder1C({
        id: order[0].id,
        orderNumber: order[0].orderNumber,
        createdAt: order[0].createdAt,
        shopExternalId,
        items: mappedItems,
      });

      const result = await bridge.createDocument("Document_РеализацияТоваровИУслуг", doc);
      await bridge.postDocument("Document_РеализацияТоваровИУслуг", result.id);

      logger.info(`Order ${orderId} synced to 1C`, {
        tenantId,
        documentId: result.id,
      });
      await updateSyncStatus(tenantId, "order", "to1c", "completed", 1);
      record1CSync("order", "to1c", Date.now() - startTime, true);
    } catch (e) {
      logger.error(`Order sync to 1C failed for tenant ${tenantId}`, { error: String(e) });
      await updateSyncStatus(tenantId, "order", "to1c", "failed", 0, String(e));
      record1CSync("order", "to1c", Date.now() - startTime, false);
      throw e;
    }
  }
}

export const oneCSync = new OneCSyncService();

import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products, orders, orderItems, warehouseStock, warehouses } from "@db/schema";
import { getBridgeForTenant } from "../lib/onec-bridge";
import { OneCMapper } from "./onec-mapper";
import { mapProduct1C, mapOrder1C, mapUnit } from "./onec-transform";
import type { Product1C } from "./onec-transform";
import { logger } from "../lib/logger";
import { updateSyncStatus } from "./onec-status";
import { record1CSync } from "../lib/metrics";

export class OneCSyncService {
  async syncProducts(tenantId: number): Promise<{ synced: number; errors: number }> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    let synced = 0;
    let errors = 0;
    const startTime = Date.now();

    try {
      await updateSyncStatus(tenantId, "product", "from1c", "processing");

      // Paginate through all products (1C OData default limit is 500)
      const allItems: Product1C[] = [];
      const PAGE_SIZE = 500;
      let skip = 0;
      while (true) {
        const page = await bridge.odataQuery<Product1C>("Catalog_Номенклатура", {
          $top: String(PAGE_SIZE),
          $skip: String(skip),
          $select: "Ref_Key,Code,Description,Price,Unit",
        });
        allItems.push(...page);
        if (page.length < PAGE_SIZE) break;
        skip += PAGE_SIZE;
      }
      const items = allItems;

      // Batch-load all existing mappings upfront (avoid N+1 SELECT per item)
      const existingMappings = await OneCMapper.getAll(db, tenantId, "product");
      const externalToInternal = new Map<string, number>();
      for (const m of existingMappings) externalToInternal.set(m.externalId, m.internalId);

      const touchedExternalIds = new Set<string>();

      for (const item of items) {
        try {
          const mapped = mapProduct1C(item);
          const internalId = externalToInternal.get(item.Ref_Key) ?? null;

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

            // Get default warehouse for tenant
            const [defaultWarehouse] = await db.select({ id: warehouses.id })
              .from(warehouses)
              .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
              .limit(1);

            if (defaultWarehouse) {
              await db.insert(warehouseStock).values({
                tenantId,
                warehouseId: defaultWarehouse.id,
                productId: Number(result.insertId),
                currentStock: "0.00", reserved: "0.00", available: "0.00",
              });
            }

            await OneCMapper.upsert(db, tenantId, "product", item.Ref_Key, Number(result.insertId));
          }
          touchedExternalIds.add(item.Ref_Key);
          synced++;
        } catch (e) {
          errors++;
          logger.error(`Failed to sync product ${item.Ref_Key}`, {
            error: String(e),
            externalId: item.Ref_Key,
          });
        }
      }

      // Deactivate products that no longer exist in 1C
      const staleIds: number[] = [];
      for (const [extId, intId] of externalToInternal) {
        if (!touchedExternalIds.has(extId)) {
          staleIds.push(intId);
        }
      }
      if (staleIds.length > 0) {
        await db.update(products)
          .set({ status: "inactive" })
          .where(and(
            eq(products.tenantId, tenantId),
            inArray(products.id, staleIds),
          ));
        logger.info(`Deactivated ${staleIds.length} products removed from 1C`, { tenantId });
      }

      logger.info(`Product sync completed: ${synced} synced, ${errors} errors, ${staleIds.length} deactivated`, {
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
    const bridge = await getBridgeForTenant(tenantId);
    const startTime = Date.now();

    try {
      await updateSyncStatus(tenantId, "order", "to1c", "processing");

      const order = await db.select({ id: orders.id, status: orders.status, total: orders.total, orderNumber: orders.orderNumber, shopId: orders.shopId, createdAt: orders.createdAt }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      if (!order[0]) throw new Error(`Order ${orderId} not found`);

      // Заказ выгружается в 1С ровно один раз.
      //
      // Раньше каждый вызов начинался с createDocument. Достаточно было
      // postDocument упереться в таймаут — документ в 1С уже создан, но наружу
      // летела ошибка и статус "failed", — чтобы директор нажал синхронизацию
      // повторно и в 1С появилась ВТОРАЯ «Реализация товаров и услуг» на тот же
      // заказ. После проведения обеих дважды списывались остатки и дважды
      // считалась выручка, причём со стороны Warehouse Pro всё выглядело
      // нормально: своих следов первый документ здесь не оставлял.
      //
      // Теперь идентификатор документа ищется в id_mappings до создания, и при
      // повторе остаётся только добросить проведение по сохранённому id.
      let documentId = await OneCMapper.getExternalId(db, tenantId, "order", orderId);

      if (documentId) {
        logger.info(`Order ${orderId} already has a 1C document, re-posting instead of creating`, {
          tenantId,
          documentId,
        });
      } else {
        const items = await db.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          unit: products.unit,
          unitWeight: products.unitWeight,
        }).from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .where(and(
            eq(orderItems.orderId, orderId),
            eq(products.tenantId, tenantId),
          ));
        const shopExternalId = await OneCMapper.getExternalId(db, tenantId, "shop", order[0].shopId);

        if (!shopExternalId) {
          throw new Error(`Shop ${order[0].shopId} not mapped to 1C`);
        }

        // Заказ без позиций в 1С не выгружается: пустая «Реализация» проводится
        // без единой строки и выглядит как успешная синхронизация.
        if (items.length === 0) {
          throw new Error(`Заказ ${orderId} не содержит позиций — выгружать в 1С нечего`);
        }

        const mappedItems = [];
        for (const item of items) {
          const productExternalId = await OneCMapper.getExternalId(db, tenantId, "product", item.productId);
          // Несопоставленный товар раньше молча выпадал из накладной: в заказе
          // пять позиций, товар заведён руками в Warehouse Pro и ещё не пришёл
          // из 1С — строки в id_mappings нет, значит и в документе её нет. В 1С
          // уходила Реализация на четыре позиции и меньшую сумму, проводилась, а
          // статус синхронизации был "completed" — расхождение с накладной
          // магазина не всплывало ни у кого. Лучше выгрузка не пройдёт целиком и
          // это увидят, чем пройдёт наполовину и не увидит никто.
          if (!productExternalId) {
            throw new Error(`Товар ${item.productId} не сопоставлен с 1С`);
          }
          mappedItems.push({
            productExternalId,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            unitWeight: Number(item.unitWeight ?? 0),
            unit: item.unit ?? "pcs",
          });
        }

        const doc = mapOrder1C({
          id: order[0].id,
          orderNumber: order[0].orderNumber,
          createdAt: order[0].createdAt,
          shopExternalId,
          items: mappedItems,
        });

        const result = await bridge.createDocument("Document_РеализацияТоваровИУслуг", doc);
        documentId = result.id;
        // Маппинг записывается до проведения, а не после: между созданием и
        // проведением и рвётся связь в том самом сценарии с таймаутом. Если
        // сохранять id после postDocument, повтор снова начнётся с создания.
        await OneCMapper.upsert(db, tenantId, "order", documentId, orderId);
      }

      await bridge.postDocument("Document_РеализацияТоваровИУслуг", documentId);

      logger.info(`Order ${orderId} synced to 1C`, {
        tenantId,
        documentId,
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

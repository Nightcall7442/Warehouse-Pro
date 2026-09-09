import { TRPCError } from "@trpc/server";
import { checkPlanLimits } from "../lib/plan-limits";
import { eq, and, inArray } from "drizzle-orm";
import { isDuplicateOf } from "../lib/db-errors";
import { normalizeCategory } from "../lib/category";
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
  async syncProducts(tenantId: number): Promise<{ synced: number; errors: number; blockedByPlan: number }> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    let synced = 0;
    let errors = 0;
    /*
      Предел тарифа действует и на обмен с 1С.

      Иначе он обходится в один щелчок: номенклатура 1С приезжает целиком, и
      организация на Basic получает три тысячи позиций вместо пятидесяти.
      Уже заведённые товары обмен продолжает ОБНОВЛЯТЬ при любом пределе —
      предел не даёт заводить новые, а не отключает синхронизацию.
    */
    let blockedByPlan = 0;
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

      // Свободное место читается один раз до цикла: спрашивать базу на каждой
      // из трёх тысяч позиций — три тысячи запросов.
      const planRoom = await checkPlanLimits(db, tenantId, "products");
      let room = planRoom.limit === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, planRoom.limit - planRoom.current);

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
                category: normalizeCategory(mapped.category),
              })
              .where(eq(products.id, internalId));
          } else if (room <= 0) {
            /*
              Место кончилось: товар не заводим и связь не портим — на
              следующем обмене, после расширения тарифа, он заведётся.
              touchedExternalIds его не получает, но и в «пропавшие из 1С» он
              не попадёт: туда идут только те, у кого связь уже есть.
            */
            blockedByPlan++;
            continue;
          } else {
            /*
              Товар и его связь с 1С заводятся вместе или не заводятся вовсе.

              Раньше это были три отдельных запроса подряд. Стоило упасть
              любому после первого — оборвалась связь, перезапустился
              процесс, — и в базе оставался товар БЕЗ записи в id_mappings.
              Следующий обмен не находил его по Ref_Key и вставлял заново,
              упираясь в уникальный индекс uq_product_code_tenant. Так
              появлялась цепочка «Duplicate entry 'A61-14'» на каждом
              прогоне, а доля пятисоток поднималась выше порога и будила
              дежурного.

              Транзакция это прекращает: без связи товара не будет.
            */
            const newId = await db.transaction(async (tx) => {
              const [result] = await tx
                .insert(products)
                .values({
                  tenantId,
                  name: mapped.name,
                  code: mapped.code,
                  unitPrice: mapped.unitPrice,
                  unit: mapUnit(mapped.unit),
                  category: normalizeCategory(mapped.category),
                });
              const id = Number(result.insertId);

              // Get default warehouse for tenant
              const [defaultWarehouse] = await tx.select({ id: warehouses.id })
                .from(warehouses)
                .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
                .limit(1);

              if (defaultWarehouse) {
                await tx.insert(warehouseStock).values({
                  tenantId,
                  warehouseId: defaultWarehouse.id,
                  productId: id,
                  currentStock: "0.00", reserved: "0.00", available: "0.00",
                });
              }

              await OneCMapper.upsert(tx as unknown as typeof db, tenantId, "product", item.Ref_Key, id);
              return id;
            }).catch(async (e: unknown) => {
              /*
                Код уже занят — значит товар в базе есть, а связи с 1С у него
                нет: след прежней беды, описанной выше. Заводить второй
                нельзя (индекс не даст) и незачем: нужно привязать тот,
                который уже есть.

                Это чинит и то, что уже накопилось: у арендаторов, где обмен
                падал неделями, первый же прогон после этой правки свяжет
                осиротевшие товары вместо того, чтобы снова упасть.
              */
              if (!isDuplicateOf(e, "uq_product_code_tenant")) throw e;

              const [existing] = await db.select({ id: products.id })
                .from(products)
                .where(and(eq(products.tenantId, tenantId), eq(products.code, mapped.code)))
                .limit(1);
              if (!existing) throw e;

              await OneCMapper.upsert(db, tenantId, "product", item.Ref_Key, existing.id);
              logger.warn(`Товар ${mapped.code} был в базе без связи с 1С — связь восстановлена`, {
                tenantId, externalId: item.Ref_Key, productId: existing.id,
              });
              return existing.id;
            });

            externalToInternal.set(item.Ref_Key, newId);
            room--;
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
        tenantId, blockedByPlan,
      });
      if (blockedByPlan > 0) {
        logger.warn(`Обмен с 1С: ${blockedByPlan} позиций не заведено — предел тарифа ${planRoom.limit}`, { tenantId });
      }
      await updateSyncStatus(tenantId, "product", "from1c", "completed", synced);
      record1CSync("product", "from1c", Date.now() - startTime, errors === 0);
    } catch (e) {
      logger.error(`Product sync failed for tenant ${tenantId}`, { error: String(e) });
      await updateSyncStatus(tenantId, "product", "from1c", "failed", synced, String(e));
      record1CSync("product", "from1c", Date.now() - startTime, false);
      throw e;
    }

    return { synced, errors, blockedByPlan };
  }

  /**
   * Выгрузить заказ в 1С.
   *
   * asNewDocument — прямое решение директора выгрузить заказ ЗАНОВО, отдельным
   * документом. Нужно после возврата заказа из архива в работу: прежний
   * документ описывает первый круг, а тронуть его отсюда нечем — мост умеет
   * только создать и провести. Разбирается тот документ в самой 1С, руками, и
   * этот признак означает «разобрал».
   */
  async syncOrderTo1C(tenantId: number, orderId: number, opts?: { asNewDocument?: boolean }): Promise<void> {
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
      const mapping = await OneCMapper.getMapping(db, tenantId, "order", orderId);
      let documentId = mapping?.externalId ?? null;

      /*
        ── Документ первой жизни не выдаётся за выгрузку второй ────────────────

        Повторный вызов намеренно не создаёт документ заново, а до-проводит
        сохранённый: так закрыт случай с таймаутом, когда «Реализация» в 1С уже
        появилась, а наружу улетела ошибка. Но у этого хода была вторая
        сторона.

        Заказ можно вернуть из архива в работу — он начинает второй круг под
        тем же номером, и состав с суммой у него уже другие. Связь при этом
        оставалась от первого круга, и синхронизация покорно перепроводила
        СТАРЫЙ документ, а потом писала «выполнено». В 1С — первая накладная,
        в Warehouse Pro — вторая, и ни одна сторона об этом не сообщала.

        Признак второго круга — время: order-reopen двигает created_at на день
        возврата в работу, а last_synced_at остался от выгрузки первого круга.
        У обычного заказа порядок обратный: сначала оформили, потом выгрузили.

        Отказ, а не тихая перевыгрузка: прежний документ в 1С проведён, и
        второй такой же удвоит там и выручку, и списание. Решает человек.
      */
      const secondLife = Boolean(
        documentId && mapping?.lastSyncedAt && order[0].createdAt > mapping.lastSyncedAt,
      );

      if (secondLife && !opts?.asNewDocument) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Заказ ${order[0].orderNumber} возвращали в работу после выгрузки в 1С. ` +
            `В 1С лежит документ первого круга — с прежним составом и суммой, ` +
            `и он проведён. Перепровести его заново значит отдать в учёт не то, ` +
            `что повезли. Разберите прежний документ в 1С, затем выгрузите заказ ` +
            `заново отдельным документом.`,
        });
      }

      if (secondLife) {
        // Директор подтвердил, что прежний документ в 1С разобран. Связь
        // забывается, и дальше заказ выгружается как невыгруженный.
        await OneCMapper.forget(db, tenantId, "order", orderId);
        documentId = null;
        logger.info(`Order ${orderId} is being re-exported to 1C as a new document`, { tenantId });
      }

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
          .leftJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
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

import { TRPCError } from "@trpc/server";
import { checkPlanLimits } from "../lib/plan-limits";
import { eq, and, inArray, isNull, gte, ne } from "drizzle-orm";
import { isDuplicateOf } from "../lib/db-errors";
import { getDb } from "../queries/connection";
import { products, orders, orderItems, warehouses, payments, onecConfig, onecJournal, idMappings } from "@db/schema";
import { badRequest } from "../lib/errors";
import { NonCashService, matchReceipts } from "./noncash";
import { getBridgeForTenant, guid, OneCError, type OneCBridge } from "../lib/onec-bridge";
import { OneCMapper } from "./onec-mapper";
import { OnecJournal } from "./onec-journal";
import { syncCounterparties } from "./onec-counterparties";
import { mapUnit, to1CDate, sanitizeText } from "./onec-transform";
import { logger } from "../lib/logger";
import { updateSyncStatus } from "./onec-status";
import { record1CSync } from "../lib/metrics";
import { setStock } from "./stock-ledger";

/*
  Обмен с 1С по стандартному OData.

  ── Из 1С ───────────────────────────────────────────────────────────────────
  Номенклатура (без папок и помеченных на удаление) + единицы измерения +
  цены выбранного типа срезом последних. Товар без цены в этом типе цен
  цену не теряет: обновляются только название, код и единица.

  ── В 1С ────────────────────────────────────────────────────────────────────
  Заказ → «Реализация товаров и услуг» по именам пресета: организация, склад
  и договор берутся из настроек подключения и самой 1С; количество идёт в
  единице номенклатуры (она и есть единица товара — приехала оттуда же).
  При частичной доставке в документ попадает довезённое. Оплата → ПКО, если
  включено. Всё это ходит через журнал (onec-journal): повторы с паузой,
  причина отказа, кнопка «Повторить».
*/

const money = (n: number) => Math.round(n * 100) / 100;

export class OneCSyncService {
  async syncProducts(tenantId: number): Promise<{ synced: number; errors: number; blockedByPlan: number }> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    const n = bridge.names;
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

      const [config] = await db.select({ priceTypeKey: onecConfig.priceTypeKey }).from(onecConfig).where(eq(onecConfig.tenantId, tenantId)).limit(1);

      const filter = [`${n.nomenclature.deletion} eq false`, n.nomenclature.folder ? `${n.nomenclature.folder} eq false` : null].filter(Boolean).join(" and ");
      const items = await bridge.queryAll<Record<string, unknown>>(n.nomenclature.set, {
        $select: ["Ref_Key", "Code", n.nomenclature.name, n.nomenclature.code, n.nomenclature.unitRef].join(","),
        $filter: filter,
      });

      const unitRows = await bridge.queryAll<Record<string, unknown>>(n.units.set, { $select: `Ref_Key,${n.units.name}` });
      const unitByKey = new Map(unitRows.map(u => [String(u.Ref_Key), String(u[n.units.name] ?? "")]));

      // Цены — срез последних по выбранному типу цен; без типа цен цены не трогаем.
      const priceByItem = new Map<string, number>();
      if (config?.priceTypeKey) {
        const priceRows = await bridge.sliceLast<Record<string, unknown>>(n.prices.set, `${n.prices.type} eq ${guid(config.priceTypeKey)}`, {
          $select: `${n.prices.item},${n.prices.price}`,
        });
        for (const r of priceRows) priceByItem.set(String(r[n.prices.item]), Number(r[n.prices.price]));
      }

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
        const refKey = String(item.Ref_Key);
        try {
          const name = sanitizeText(String(item[n.nomenclature.name] ?? "")).trim();
          // Артикул может быть пуст — тогда стандартный Code, он есть у любого справочника.
          const code = sanitizeText(String(item[n.nomenclature.code] || item.Code || "")).trim();
          if (!name || !code) throw new Error(`Номенклатура ${refKey}: пустое название или код`);
          const unit = mapUnit(unitByKey.get(String(item[n.nomenclature.unitRef] ?? "")) ?? "шт");
          const price = priceByItem.get(refKey);
          if (price !== undefined && !Number.isFinite(price)) throw new Error(`Номенклатура ${refKey}: цена не число`);
          const unitPrice = price === undefined ? undefined : money(price).toFixed(2);
          const internalId = externalToInternal.get(refKey) ?? null;

          if (internalId) {
            await db
              .update(products)
              .set({ name, code, unit, ...(unitPrice !== undefined ? { unitPrice } : {}) })
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
                .values({ tenantId, name, code, unitPrice: unitPrice ?? "0.00", unit });
              const id = Number(result.insertId);

              // Get default warehouse for tenant
              const [defaultWarehouse] = await tx.select({ id: warehouses.id })
                .from(warehouses)
                .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
                .limit(1);

              if (defaultWarehouse) {
                await setStock(tx, { tenantId, warehouseId: defaultWarehouse.id, productId: id, quantity: 0 });
              }

              await OneCMapper.upsert(tx as unknown as typeof db, tenantId, "product", refKey, id);
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
                .where(and(eq(products.tenantId, tenantId), eq(products.code, code)))
                .limit(1);
              if (!existing) throw e;

              await OneCMapper.upsert(db, tenantId, "product", refKey, existing.id);
              logger.warn(`Товар ${code} был в базе без связи с 1С — связь восстановлена`, {
                tenantId, externalId: refKey, productId: existing.id,
              });
              return existing.id;
            });

            externalToInternal.set(refKey, newId);
            room--;
          }
          touchedExternalIds.add(refKey);
          synced++;
        } catch (e) {
          errors++;
          logger.error(`Failed to sync product ${refKey}`, { error: String(e), externalId: refKey });
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

  /** Организация, склад, тип цен — без них документ в 1С не собрать. */
  private async requireKeys(tenantId: number) {
    const db = getDb();
    const [config] = await db.select({
      organizationKey: onecConfig.organizationKey, warehouseKey: onecConfig.warehouseKey,
    }).from(onecConfig).where(eq(onecConfig.tenantId, tenantId)).limit(1);
    if (!config?.organizationKey || !config.warehouseKey) {
      throw new OneCError("В настройках 1С не выбраны организация и склад");
    }
    return { organizationKey: config.organizationKey, warehouseKey: config.warehouseKey };
  }

  /** Договор контрагента с организацией (Бухгалтерия требует его в реализации); нет — заводим один. */
  private async contractFor(bridge: OneCBridge, shopKey: string, organizationKey: string): Promise<string | null> {
    const c = bridge.names.contracts;
    if (!c) return null;
    const found = await bridge.query<{ Ref_Key: string }>(c.set, {
      $select: "Ref_Key", $top: "1",
      $filter: `${c.owner} eq ${guid(shopKey)} and ${c.organization} eq ${guid(organizationKey)} and DeletionMark eq false`,
    });
    if (found[0]) return found[0].Ref_Key;
    const body: Record<string, unknown> = { [c.name]: "Основной договор", [c.owner]: shopKey, [c.organization]: organizationKey };
    if (c.kind && c.kindValue) body[c.kind] = c.kindValue;
    const created = await bridge.create(c.set, body);
    return created.Ref_Key ?? null;
  }

  /**
   * Выгрузить заказ в 1С.
   *
   * asNewDocument — прямое решение директора выгрузить заказ ЗАНОВО, отдельным
   * документом. Нужно после возврата заказа из архива в работу: прежний
   * документ описывает первый круг, а тронуть его отсюда нечем — обмен умеет
   * только создать и провести. Разбирается тот документ в самой 1С, руками, и
   * этот признак означает «разобрал».
   */
  async syncOrderTo1C(tenantId: number, orderId: number, opts?: { asNewDocument?: boolean }): Promise<void> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    const s = bridge.names.sale;
    const startTime = Date.now();

    try {
      await updateSyncStatus(tenantId, "order", "to1c", "processing");

      const order = await db.select({
        id: orders.id, status: orders.status, total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
        orderNumber: orders.orderNumber, shopId: orders.shopId, createdAt: orders.createdAt, deliveredAt: orders.deliveredAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      if (!order[0]) throw new Error(`Order ${orderId} not found`);

      // Заказ выгружается в 1С ровно один раз.
      //
      // Раньше каждый вызов начинался с создания. Достаточно было проведению
      // упереться в таймаут — документ в 1С уже создан, но наружу летела
      // ошибка и статус "failed", — чтобы директор нажал синхронизацию
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
        const keys = await this.requireKeys(tenantId);
        const items = await db.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          deliveredQuantity: orderItems.deliveredQuantity,
          unitPrice: orderItems.unitPrice,
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

        // Скидка заказа раскладывается по строкам пропорционально: в 1С сумма
        // документа обязана совпасть с тем, что записано магазину в долг.
        const subtotal = Number(order[0].subtotal);
        const factor = subtotal > 0 && Number(order[0].discount) > 0 ? Number(order[0].total) / subtotal : 1;

        const lines: Array<Record<string, unknown>> = [];
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
          // Частичная доставка: в учёт идёт довезённое, недовезённое — не продажа.
          const qty = Number(item.deliveredQuantity ?? item.quantity);
          if (qty <= 0) continue;
          const price = money(Number(item.unitPrice) * factor);
          const sum = money(qty * price);
          const line: Record<string, unknown> = {
            LineNumber: lines.length + 1,
            [s.item.product]: productExternalId,
            [s.item.qty]: qty,
            [s.item.price]: price,
            [s.item.sum]: sum,
          };
          if (s.item.vatRate && s.vatRateValue) line[s.item.vatRate] = s.vatRateValue;
          if (s.item.vatSum && s.vatPercent !== null) line[s.item.vatSum] = money(sum * s.vatPercent / (100 + s.vatPercent));
          lines.push(line);
        }
        if (lines.length === 0) throw new Error(`Заказ ${orderId}: ничего не довезено — выгружать в 1С нечего`);

        const doc: Record<string, unknown> = {
          [s.fields.date]: to1CDate(order[0].deliveredAt ?? order[0].createdAt),
          [s.fields.organization]: keys.organizationKey,
          [s.fields.counterparty]: shopExternalId,
          [s.fields.warehouse]: keys.warehouseKey,
          [s.fields.comment]: `Warehouse Pro: заказ ${order[0].orderNumber}`,
          [s.items]: lines,
        };
        if (s.fields.operation && s.operationValue) doc[s.fields.operation] = s.operationValue;
        if (s.fields.contract) {
          const contract = await this.contractFor(bridge, shopExternalId, keys.organizationKey);
          if (contract) doc[s.fields.contract] = contract;
        }

        const created = await bridge.create(s.set, doc);
        if (!created.Ref_Key) throw new OneCError("1С не вернула Ref_Key созданного документа");
        documentId = created.Ref_Key;
        // Маппинг записывается до проведения, а не после: между созданием и
        // проведением и рвётся связь в том самом сценарии с таймаутом. Если
        // сохранять id после проведения, повтор снова начнётся с создания.
        await OneCMapper.upsert(db, tenantId, "order", documentId, orderId);
      }

      await bridge.post(s.set, documentId);

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

  /**
   * Оплата магазина → приходный кассовый ордер. Один платёж — один ПКО,
   * повтор до-проводит. Только наличные: карта и перевод приходят в 1С из
   * выписки банка сами, ПКО на них задвоил бы поступление в учёте.
   */
  async syncPaymentTo1C(tenantId: number, paymentId: number): Promise<void> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    const c = bridge.names.cashIn;
    if (!c) throw new OneCError("В этой конфигурации приходный ордер не настроен");
    const [p] = await db.select({
      id: payments.id, shopId: payments.shopId, amount: payments.amount, type: payments.type, paymentMethod: payments.paymentMethod,
      paidAt: payments.paidAt, createdAt: payments.createdAt, orderId: payments.orderId,
    }).from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
    if (!p) throw new Error(`Payment ${paymentId} not found`);
    if (p.type !== "payment" || Number(p.amount) <= 0) throw new Error(`Payment ${paymentId}: не оплата`);
    if (p.paymentMethod !== "cash") throw badRequest("Безнал приходит в 1С из выписки банка — ПКО не создаётся");

    let documentId = await OneCMapper.getExternalId(db, tenantId, "payment", paymentId);
    if (!documentId) {
      const keys = await this.requireKeys(tenantId);
      const shopExternalId = await OneCMapper.getExternalId(db, tenantId, "shop", p.shopId);
      if (!shopExternalId) throw new Error(`Shop ${p.shopId} not mapped to 1C`);
      const doc: Record<string, unknown> = {
        [c.fields.date]: to1CDate(p.paidAt ?? p.createdAt),
        [c.fields.organization]: keys.organizationKey,
        [c.fields.counterparty]: shopExternalId,
        [c.fields.sum]: money(Number(p.amount)),
        [c.fields.comment]: `Warehouse Pro: оплата №${p.id}${p.orderId ? ` по заказу ${p.orderId}` : ""}`,
      };
      if (c.fields.operation && c.operationValue) doc[c.fields.operation] = c.operationValue;
      if (c.fields.contract) {
        const contract = await this.contractFor(bridge, shopExternalId, keys.organizationKey);
        if (contract) doc[c.fields.contract] = contract;
      }
      const created = await bridge.create(c.set, doc);
      if (!created.Ref_Key) throw new OneCError("1С не вернула Ref_Key созданного документа");
      documentId = created.Ref_Key;
      await OneCMapper.upsert(db, tenantId, "payment", documentId, paymentId);
    }
    await bridge.post(c.set, documentId);
    logger.info(`Payment ${paymentId} synced to 1C`, { tenantId, documentId });
  }

  /**
   * Поставить в очередь то, что довезли и чем заплатили с момента подключения.
   * Старую историю не выгружаем: подключение 1С в сентябре не означает
   * «перепровести прошлый год» — это решает бухгалтер, руками.
   */
  async enqueueDelivered(tenantId: number): Promise<{ orders: number; payments: number }> {
    const db = getDb();
    const [config] = await db.select({ createdAt: onecConfig.createdAt, syncPayments: onecConfig.syncPayments })
      .from(onecConfig).where(eq(onecConfig.tenantId, tenantId)).limit(1);
    if (!config) return { orders: 0, payments: 0 };

    const newOrders = await db.select({ id: orders.id }).from(orders)
      .leftJoin(onecJournal, and(eq(onecJournal.tenantId, tenantId), eq(onecJournal.entityType, "order"), eq(onecJournal.entityId, orders.id), eq(onecJournal.direction, "to1c")))
      .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "delivered"), gte(orders.deliveredAt, config.createdAt), isNull(onecJournal.id)))
      .limit(500);
    for (const o of newOrders) await OnecJournal.enqueue(db, tenantId, "order", o.id);

    let paid = 0;
    if (config.syncPayments) {
      // В очередь — только наличные: безнал в 1С приходит из выписки банка.
      const newPayments = await db.select({ id: payments.id }).from(payments)
        .leftJoin(onecJournal, and(eq(onecJournal.tenantId, tenantId), eq(onecJournal.entityType, "payment"), eq(onecJournal.entityId, payments.id), eq(onecJournal.direction, "to1c")))
        .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), gte(payments.createdAt, config.createdAt), isNull(onecJournal.id)))
        .limit(500);
      for (const p of newPayments) await OnecJournal.enqueue(db, tenantId, "payment", p.id);
      paid = newPayments.length;
    }
    return { orders: newOrders.length, payments: paid };
  }

  /**
   * Безнал ← выписка банка через 1С. Переводы и карты, которые кассир ещё не
   * подтвердил, ищутся среди проведённых поступлений на счёт: тот же
   * контрагент, та же сумма, не раньше чем за сутки до записи. Найденное —
   * «пришло» с номером документа 1С; поступление помечается использованным,
   * чтобы второй такой же перевод не закрылся тем же документом.
   */
  async reconcileBankReceipts(tenantId: number, now = new Date()): Promise<{ matched: number; pending: number; disabled?: true }> {
    const db = getDb();
    const bridge = await getBridgeForTenant(tenantId);
    const b = bridge.names.bankIn;
    if (!b) return { matched: 0, pending: 0, disabled: true };

    const pending = await db.select({ id: payments.id, shopId: payments.shopId, amount: payments.amount, createdAt: payments.createdAt }).from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), inArray(payments.paymentMethod, ["card", "transfer"]),
        isNull(payments.reversalOf), isNull(payments.bankConfirmedAt), ne(payments.status, "reversed")));
    if (!pending.length) return { matched: 0, pending: 0 };

    const shopIds = [...new Set(pending.map(p => Number(p.shopId)))];
    const links = await db.select({ internalId: idMappings.internalId, externalId: idMappings.externalId }).from(idMappings)
      .where(and(eq(idMappings.tenantId, tenantId), eq(idMappings.entityType, "shop"), inArray(idMappings.internalId, shopIds)));
    const extOf = new Map(links.map(l => [Number(l.internalId), l.externalId]));
    const candidates = pending.filter(p => extOf.has(Number(p.shopId)))
      .map(p => ({ id: p.id, counterparty: extOf.get(Number(p.shopId))!, amount: Number(p.amount), createdAt: p.createdAt }));
    if (!candidates.length) return { matched: 0, pending: pending.length };

    const since = new Date(Math.min(...candidates.map(p => p.createdAt.getTime())) - 86_400_000);
    const rows = await bridge.queryAll<Record<string, unknown>>(b.set, {
      $filter: [`Posted eq true`, `DeletionMark eq false`, `${b.fields.date} ge datetime'${to1CDate(since)}'`,
        ...(b.fields.operation && b.operationValue ? [`${b.fields.operation} eq '${b.operationValue}'`] : [])].join(" and "),
      $select: ["Ref_Key", "Number", b.fields.date, b.fields.counterparty, b.fields.sum].join(","),
    });
    const keys = rows.map(r => String(r.Ref_Key));
    const used = keys.length ? await db.select({ externalId: idMappings.externalId }).from(idMappings)
      .where(and(eq(idMappings.tenantId, tenantId), eq(idMappings.entityType, "bank_receipt"), inArray(idMappings.externalId, keys))) : [];
    const usedKeys = new Set(used.map(u => u.externalId));
    const receipts = rows.filter(r => !usedKeys.has(String(r.Ref_Key))).map(r => ({
      key: String(r.Ref_Key), number: String(r.Number ?? ""), date: new Date(String(r[b.fields.date]) + (String(r[b.fields.date]).endsWith("Z") ? "" : "Z")),
      counterparty: String(r[b.fields.counterparty]), sum: Number(r[b.fields.sum]),
    }));

    const hits = matchReceipts(receipts, candidates);
    for (const h of hits) await OneCMapper.upsert(db, tenantId, "bank_receipt", h.key, h.paymentId);
    const matched = await NonCashService.confirmFromBank(db, tenantId,
      hits.map(h => ({ paymentId: h.paymentId, bankRef: `1С №${h.number}`, receiptDate: h.date })), now);
    logger.info("1C bank receipts reconciled", { tenantId, matched, pending: pending.length - matched });
    return { matched, pending: pending.length - matched };
  }

  private running = new Set<number>();

  /** Прогнать очередь журнала: что пора — выгрузить, отказ — записать с паузой до следующей попытки. */
  async processQueue(tenantId: number): Promise<{ processed: number; done: number; failed: number; skipped: number }> {
    const db = getDb();
    const out = { processed: 0, done: 0, failed: 0, skipped: 0 };
    // ponytail: замок в памяти одного процесса; при втором инстансе API — SELECT … FOR UPDATE SKIP LOCKED
    if (this.running.has(tenantId)) return out;
    this.running.add(tenantId);
    try {
      const due = await OnecJournal.due(db, tenantId);
      for (const row of due) {
        out.processed++;
        try {
          if (row.entityType === "order") await this.syncOrderTo1C(tenantId, row.entityId);
          else if (row.entityType === "payment") await this.syncPaymentTo1C(tenantId, row.entityId);
          else { await OnecJournal.markSkipped(db, row.id, `Тип ${row.entityType} очередью не выгружается`); out.skipped++; continue; }
          const externalId = await OneCMapper.getExternalId(db, tenantId, row.entityType === "order" ? "order" : "payment", row.entityId);
          await OnecJournal.markDone(db, row.id, externalId);
          out.done++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // Второй круг заказа: решает человек, повторы не помогут.
          if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
            await OnecJournal.markSkipped(db, row.id, message);
            out.skipped++;
          } else {
            await OnecJournal.markFailed(db, row.id, row.attempts, message);
            out.failed++;
          }
        }
      }
    } finally {
      this.running.delete(tenantId);
    }
    return out;
  }

  /**
   * Крон: организации с включённым обменом, у которых прошёл интервал.
   * Порядок — номенклатура, контрагенты, затем очередь: заказ выгружается
   * только когда его товары и магазин уже сопоставлены.
   */
  async runScheduled(now = new Date()): Promise<{ tenants: number }> {
    const db = getDb();
    const configs = await db.select({
      tenantId: onecConfig.tenantId, intervalMinutes: onecConfig.intervalMinutes, lastSyncAt: onecConfig.lastSyncAt,
      syncProducts: onecConfig.syncProducts, syncOrders: onecConfig.syncOrders, syncCounterparties: onecConfig.syncCounterparties,
      syncPayments: onecConfig.syncPayments, organizationKey: onecConfig.organizationKey, warehouseKey: onecConfig.warehouseKey,
    }).from(onecConfig).where(eq(onecConfig.enabled, true));
    let ran = 0;
    for (const c of configs) {
      const interval = (c.intervalMinutes ?? 60) * 60_000;
      if (c.lastSyncAt && now.getTime() - c.lastSyncAt.getTime() < interval) continue;
      ran++;
      const step = async (what: string, fn: () => Promise<unknown>) => {
        try { await fn(); } catch (e) { logger.error(`1C scheduled ${what} failed`, { tenantId: c.tenantId, error: e instanceof Error ? e.message : String(e) }); }
      };
      if (c.syncProducts) await step("products", () => this.syncProducts(c.tenantId));
      if (c.syncCounterparties) await step("counterparties", () => syncCounterparties(c.tenantId));
      if (c.syncOrders && c.organizationKey && c.warehouseKey) {
        await step("queue", async () => { await this.enqueueDelivered(c.tenantId); await this.processQueue(c.tenantId); });
      }
      // Безнал сверяется после контрагентов: магазин без связи с 1С искать не по чему.
      if (c.syncPayments) await step("bank", () => this.reconcileBankReceipts(c.tenantId, now));
      await db.update(onecConfig).set({ lastSyncAt: now }).where(eq(onecConfig.tenantId, c.tenantId));
    }
    return { tenants: ran };
  }
}

export const oneCSync = new OneCSyncService();

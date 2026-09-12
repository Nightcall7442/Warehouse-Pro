import { receiveStock } from "./stock-ledger";
import { TRPCError } from "@trpc/server";
import { arrivals, arrivalItems, products, warehouses, suppliers, supplies, supplierPayments } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";
import { sanitizeString } from "../lib/sanitize";
import { sseBus } from "../lib/sse";
import { isDuplicateOf } from "../lib/db-errors";
import { dateColumnDay } from "../lib/period";
import type { Db } from "./order-shared";
import { recordAudit } from "./audit-log";

/*
  Приход товара: создать, провести (оприходовать на склад через дверь
  остатка), удалить. Перенесено из arrival-router.ts без изменений —
  роутеру остались zod и права. Теперь то же проведение доступно импорту,
  вебхуку 1С и крону, а не только экрану.
*/

export interface ArrivalItemInput {
  productId: number;
  quantity: string;
  expectedQuantity?: string;
  costPrice?: string;
  sellingPrice?: string;
  condition?: string;
  batchNumber?: string;
  /** «ГГГГ-ММ-ДД». */
  expiresAt?: string;
}

export interface ArrivalSupplierInput {
  supplierId?: number;
  newSupplierName?: string;
  amount: string;
  currency: "UZS" | "USD";
  rateToUzs?: string;
  dueDate?: string;
}

export interface CreateArrivalInput {
  truckId?: string;
  driverName?: string;
  driverPhone?: string;
  arrivalDate: string;
  fuelCost: string;
  tollCost: string;
  otherCost: string;
  notes?: string;
  items?: ArrivalItemInput[];
  supplier?: ArrivalSupplierInput;
}

export interface UpdateArrivalInput {
  id: number;
  truckId?: string;
  driverName?: string;
  driverPhone?: string;
  status?: "pending" | "unloading" | "completed";
  warehouseId?: number;
  fuelCost?: string;
  tollCost?: string;
  otherCost?: string;
  notes?: string;
}

export async function createArrival(db: Db, tenantId: number, userId: number, input: CreateArrivalInput) {
  /*
    Срок годности раньше дня прихода — это опечатка, а не товар.

    Проверка здесь, а не в схеме входа: zod видит поля по одному, а сравнить
    надо с датой самого прихода. Принять такую строку значит завести партию,
    которая просрочена в момент приёмки, и объяснять потом, откуда она.
  */
  for (const item of input.items ?? []) {
    if (item.expiresAt && item.expiresAt < input.arrivalDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Срок годности ${item.expiresAt} раньше даты прихода ${input.arrivalDate}`,
      });
    }
  }
  const raw = crypto.randomUUID().replace(/-/g, "");
  const arrivalNumber = `ARR-${raw.slice(0, 12).toUpperCase()}`;
  const totalExpense  = (Number(input.fuelCost) + Number(input.tollCost) + Number(input.otherCost)).toFixed(2);

  // Validate every item's product exists in this tenant before inserting —
  // otherwise a stale/deleted productId hits arrival_items' FK constraint
  // and surfaces as a raw, unhandled 500 instead of a clear error.
  if (input.items && input.items.length > 0) {
    const productIds = input.items.map(i => i.productId);
    const existing = await db.select({ id: products.id }).from(products)
      .where(and(
        sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
        eq(products.tenantId, tenantId),
      ));
    const existingIds = new Set(existing.map(p => p.id));
    for (const item of input.items) {
      if (!existingIds.has(item.productId)) {
        throw new Error(`Товар #${item.productId} не найден в вашей организации`);
      }
    }
  }

  if (input.supplier) {
    // Курс обязателен для долларовой поставки: без него закупку нельзя
    // показать в сумах ни в одном отчёте, а вспомнить его через полгода
    // невозможно.
    if (input.supplier.currency === "USD" && !(Number(input.supplier.rateToUzs) > 0)) {
      throw new Error("Для поставки в долларах укажите курс на день сделки");
    }
    if (input.supplier.supplierId) {
      const [own] = await db.select({ id: suppliers.id }).from(suppliers)
        .where(and(eq(suppliers.id, input.supplier.supplierId), eq(suppliers.tenantId, tenantId)))
        .limit(1);
      if (!own) throw new Error("Поставщик не найден");
    }
  }

  return db.transaction(async (tx) => {
    const [result] = await tx.insert(arrivals).values({
      tenantId, arrivalNumber,
      truckId:     input.truckId ? sanitizeString(input.truckId) : undefined,
      driverName:  input.driverName ? sanitizeString(input.driverName) : undefined,
      driverPhone: input.driverPhone,
      arrivalDate: new Date(input.arrivalDate),
      fuelCost:    input.fuelCost,
      tollCost:    input.tollCost,
      otherCost:   input.otherCost,
      totalExpense,
      notes:       input.notes ? sanitizeString(input.notes) : undefined,
      status:      "pending",
    });

    const arrivalId = Number(result.insertId);

    if (input.supplier) {
      let supplierId = input.supplier.supplierId;
      if (!supplierId) {
        // Тот же уникальный индекс (имя, организация), что и у
        // supplier.create — тут он не мешает, а подстраховывает: до
        // этого момента дважды кликнуть «Сохранить» на форме прихода с
        // новым поставщиком означало бы завести его дважды.
        try {
          const [newSupplier] = await tx.insert(suppliers).values({
            tenantId,
            name: sanitizeString(input.supplier.newSupplierName!),
          });
          supplierId = Number(newSupplier.insertId);
        } catch (e) {
          // Через isDuplicateOf: drizzle прячет ошибку драйвера в cause,
          // и проверка по тексту e.message не срабатывала никогда.
          if (isDuplicateOf(e, "uq_supplier_name_tenant")) {
            throw new Error("Поставщик с таким названием уже заведён — выберите его из списка");
          }
          throw e;
        }
      }

      // Номер поставки — тот же случайный хвост, что у номера прихода,
      // под своим префиксом: они физически один документ, оформленный
      // одной формой, и совместный номер это подчёркивает, а не просто
      // экономит вызов crypto.randomUUID().
      await tx.insert(supplies).values({
        tenantId,
        supplierId,
        arrivalId,
        supplyNumber: `SUP-${raw.slice(0, 12).toUpperCase()}`,
        amount:       input.supplier.amount,
        currency:     input.supplier.currency,
        rateToUzs:    input.supplier.currency === "USD" ? input.supplier.rateToUzs : undefined,
        supplyDate:   new Date(input.arrivalDate),
        dueDate:      input.supplier.dueDate ? new Date(input.supplier.dueDate) : undefined,
        createdBy:    userId,
      });
    }

    if (input.items && input.items.length > 0) {
      for (const item of input.items) {
        await tx.insert(arrivalItems).values({
          arrivalId,
          productId: item.productId,
          quantity: item.quantity,
          expectedQuantity: item.expectedQuantity ?? null,
          costPrice: item.costPrice ?? "0.00",
          sellingPrice: item.sellingPrice ?? "0.00",
          condition: item.condition ? sanitizeString(item.condition) : undefined,
          batchNumber: item.batchNumber ? sanitizeString(item.batchNumber) : null,
          /*
            Дата уходит строкой, а не Date: колонка DATE времени не хранит,
            а Date драйвер развернул бы в поясе сервера и мог сдвинуть день.
            Тот же случай, что с ключом месяца в api/lib/period.ts.
          */
          expiresAt: item.expiresAt ? sql`${item.expiresAt}` : null,
        });
      }
    }

    return { id: arrivalId, arrivalNumber };
  });
}

export async function updateArrival(db: Db, tenantId: number, input: UpdateArrivalInput, actor?: { id: number; name: string; ip?: string }) {
  const { id, ...data } = input;
  const targetWarehouseId = data.warehouseId;
  delete data.warehouseId;

  // Validate status transitions: completed cannot go back to pending/unloading
  if (data.status && data.status !== "completed") {
    const [current] = await db.select({ status: arrivals.status })
      .from(arrivals).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
    if (current?.status === "completed") {
      throw new Error("Нельзя изменить статус завершённого прихода");
    }
  }

  // Prevent duplicate completion
  if (data.status === "completed") {
    const [current] = await db.select({ status: arrivals.status })
      .from(arrivals).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
    if (current?.status === "completed") {
      throw new Error("Приход уже завершён");
    }
  }

  // When completing an arrival, update warehouse stock in a transaction
  if (data.status === "completed") {
    // Get arrival number for stock movement notes
    const [arrivalRow] = await db.select({ arrivalNumber: arrivals.arrivalNumber })
      .from(arrivals).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
    const arrivalNumber = arrivalRow?.arrivalNumber ?? `#${id}`;

    await db.transaction(async (tx) => {
      // Lock and re-check the arrival's status inside the transaction —
      // the "prevent duplicate completion" check above ran on an
      // unlocked read outside any transaction, so two concurrent
      // `update({status:"completed"})` calls for the same arrival (a
      // double-click, or a retried request) both pass it before either
      // commits, and each then credits warehouse_stock for the same
      // physical shipment. This lock makes the second one queue behind
      // the first and see it already completed.
      // Расходы читаются здесь же, под той же блокировкой: ниже они нужны
      // для пересчёта итога, и брать их отдельным запросом значило бы
      // считать по значениям, которые мог поменять другой вызов.
      const [lockedArrival] = await tx.select({
        status: arrivals.status,
        fuelCost: arrivals.fuelCost,
        tollCost: arrivals.tollCost,
        otherCost: arrivals.otherCost,
      })
        .from(arrivals)
        .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)))
        .for("update")
        .limit(1);
      if (!lockedArrival) throw new Error("Приход не найден");
      if (lockedArrival.status === "completed") throw new Error("Приход уже завершён");

      // Use sql template (not Drizzle select) to avoid selecting non-existent columns
      // Партия и срок читаются здесь же: приёмка — единственное место, где
      // они известны, и передать их на остаток можно только отсюда.
      const itemsResult = await tx.execute(
        sql`SELECT ai.id, ai.arrival_id AS arrivalId, ai.product_id AS productId, ai.quantity, ai.condition, ai.notes, ai.cost_price AS costPrice, ai.selling_price AS sellingPrice, ai.batch_number AS batchNumber, ai.expires_at AS expiresAt FROM arrival_items ai WHERE ai.arrival_id = ${id}`
      );
      const rows = (itemsResult as unknown[][])[0];
      const rawItems = Array.isArray(rows) ? rows : [];
      // The columns are AS-aliased to camelCase above, so this cast is safe —
      // unlike the `unknown` the raw sql.execute() result carries by default.
      const items = rawItems as Array<{ id: number; arrivalId: number; productId: number; quantity: string; condition: string; notes: string | null; costPrice: string | null; sellingPrice: string | null; batchNumber: string | null; expiresAt: Date | string | null }>;
      const badItem = items.find(it => it.productId == null);
      if (badItem) throw new Error(`Позиция прихода #${badItem.id} не привязана к товару`);

      // Use provided warehouseId, or fall back to default warehouse
      let warehouseId: number;
      if (targetWarehouseId) {
        const [warehouse] = await tx.select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.id, targetWarehouseId), eq(warehouses.tenantId, tenantId)))
          .limit(1);
        if (!warehouse) throw new Error("Указанный склад не найден");
        warehouseId = warehouse.id;
      } else {
        const [warehouse] = await tx.select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
          .limit(1);
        if (!warehouse) throw new Error("Склад не найден — создайте склад в настройках");
        warehouseId = warehouse.id;
      }

      // Batch update: for each product, update stock in one query
      for (const item of items) {
        const qty = Number(item.quantity);

        /*
          Один вызов вместо «найти строку под блокировкой, а дальше UPDATE
          или INSERT».

          Прежний способ брал SELECT .. FOR UPDATE, чтобы два одновременных
          прихода не перетёрли друг друга. Но заблокировать НЕСУЩЕСТВУЮЩУЮ
          строку нельзя, и ровно в этом случае — первый приход товара на
          склад — защиты не было вовсе: оба запроса не находили строки и оба
          шли вставлять. Дверь делает это одним INSERT .. ON DUPLICATE KEY
          UPDATE: он атомарен на уровне строки, и два прихода складываются.

          Движение в журнал пишет она же — раньше это был отдельный вызов
          следом, и его можно было забыть.
        */
        /*
          Партия уходит на остаток вместе с количеством.

          До этого срок годности записывался в строку приёмки и там же и
          оставался: на полке лежало одно число на товар, без памяти о том,
          какими партиями оно набралось. Ответить, что сгорает через
          неделю, было нечем — данные на входе есть, учёта нет.

          Строка без номера партии и без срока партией не считается: такой
          товар ложится в остаток без партии, как и раньше.
        */
        const hasBatch = Boolean(item.batchNumber) || Boolean(item.expiresAt);
        await receiveStock(tx, {
          tenantId, warehouseId, productId: item.productId,
          quantity: qty,
          reason: "arrival", referenceId: id,
          notes: `Приход ${arrivalNumber}`,
          batch: hasBatch ? {
            batchNumber: item.batchNumber,
            expiresAt: item.expiresAt == null ? null : dateColumnDay(item.expiresAt),
            arrivalItemId: item.id,
            // Себестоимость этой приёмки — на партию: «сгорает на N» считается по ней.
            costPrice: item.costPrice != null && Number(item.costPrice) > 0 ? String(item.costPrice) : null,
          } : null,
        });

        /*
          Цены товара — из прихода.

          Форма прихода подставляет себестоимость и цену продажи ИЗ
          КАРТОЧКИ ТОВАРА и даёт их поправить: оператор, меняя цифру,
          уверен, что записывает новую закупку и новую цену. А
          записывалось это только в строку прихода — карточка товара
          оставалась с прежними числами, и следующий заказ снимал
          себестоимость по-старому (order_items хранит её слепком на
          момент заказа, и весь расчёт прибыли идёт от него).

          Переносим только то, что оператор действительно заполнил:
          ноль и пустое поле — это «не трогать», а не «обнулить».
        */
        const newCost = Number(item.costPrice ?? 0);
        const newPrice = Number(item.sellingPrice ?? 0);
        if (newCost > 0 || newPrice > 0) {
          const pricePatch: { costPrice?: string; unitPrice?: string; updatedAt: Date } = { updatedAt: new Date() };
          if (newCost > 0) pricePatch.costPrice = newCost.toFixed(2);
          if (newPrice > 0) pricePatch.unitPrice = newPrice.toFixed(2);
          await tx.update(products).set(pricePatch)
            .where(and(eq(products.id, item.productId), eq(products.tenantId, tenantId)));
        }
      }

      // Update arrival status. Guarded on status != 'completed' as a second,
      // cheap line of defense alongside the lock above.
      const notCompleted = and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId), sql`${arrivals.status} != 'completed'`);
      let statusUpdateResult: unknown;
      if (data.fuelCost || data.tollCost || data.otherCost) {
        // Неуказанные расходы берутся из самой записи, а не считаются нулём.
        //
        // Оператор, завершая приход, обычно уточняет что-то одно — скажем,
        // топливо. Прежний код подставлял ноль вместо остальных, и
        // дорожные с прочими расходами исчезали ИЗ СУММЫ, оставаясь при
        // этом в своих колонках: строка становилась внутренне
        // противоречивой, а операционные расходы в отчёте о прибыли
        // занижались. Навсегда — завершённый приход больше не
        // редактируется.
        //
        // В ветке «не завершение» такая подстановка есть; здесь её забыли.
        const fuel  = Number(data.fuelCost  ?? lockedArrival.fuelCost  ?? "0");
        const toll  = Number(data.tollCost  ?? lockedArrival.tollCost  ?? "0");
        const other = Number(data.otherCost ?? lockedArrival.otherCost ?? "0");
        [statusUpdateResult] = await tx.update(arrivals).set({ ...data, totalExpense: (fuel + toll + other).toFixed(2) })
          .where(notCompleted);
      } else {
        [statusUpdateResult] = await tx.update(arrivals).set(data).where(notCompleted);
      }
      if ((statusUpdateResult as { affectedRows?: number }).affectedRows !== 1) {
        throw new Error("Приход уже завершён");
      }
      // Проведение кладёт товар на склад — след в той же транзакции.
      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor?.id, actorName: actor?.name, ip: actor?.ip,
        action: "arrival.completed", targetType: "arrival", targetId: id,
        meta: { arrivalNumber, items: items.length },
      }, { strict: true });
    });

    // Notify connected frontends that stock has changed
    sseBus.emit({ type: "notification.new", tenantId, data: { type: "arrival.completed", arrivalId: id, arrivalNumber } });

    return { success: true };
  }

  // Non-completion status changes
  if (data.fuelCost || data.tollCost || data.otherCost) {
    const [existing] = await db.select().from(arrivals)
      .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
    if (existing) {
      const fuel  = Number(data.fuelCost  ?? existing.fuelCost);
      const toll  = Number(data.tollCost  ?? existing.tollCost);
      const other = Number(data.otherCost ?? existing.otherCost);
      await db.update(arrivals).set({ ...data, totalExpense: (fuel + toll + other).toFixed(2) })
        .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
      return { success: true };
    }
  }

  await db.update(arrivals).set(data).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
  return { success: true };
}

export async function deleteArrival(db: Db, tenantId: number, arrivalId: number) {
  // Only allow deleting pending arrivals
  const [arrival] = await db.select({ id: arrivals.id, status: arrivals.status })
    .from(arrivals).where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId))).limit(1);
  if (!arrival) throw new Error("Приход не найден");
  if (arrival.status === "completed") throw new Error("Нельзя удалить завершённый приход");

  /*
    Поставка, заведённая той же формой, удаляется вместе с приходом.

    Внешний ключ у supplies.arrival_id — ON DELETE SET NULL, поэтому
    удаление ошибочно заведённого прихода оставляло долг перед
    поставщиком жить дальше: без ссылки на документ, которым он
    появился, и без всякого следа на экране приходов. Найти его потом
    можно было только в списке поставок, гадая, откуда он взялся.

    Если по поставке уже платили — не удаляем ничего и говорим прямо:
    оплата это движение денег, и стирать её заодно с черновиком
    прихода нельзя.
  */
  const [linkedSupply] = await db.select({ id: supplies.id, supplyNumber: supplies.supplyNumber })
    .from(supplies)
    .where(and(eq(supplies.arrivalId, arrivalId), eq(supplies.tenantId, tenantId)))
    .limit(1);

  if (linkedSupply) {
    const [paid] = await db.select({ count: sql<number>`count(*)` })
      .from(supplierPayments)
      .where(and(eq(supplierPayments.supplyId, linkedSupply.id), eq(supplierPayments.tenantId, tenantId)));
    if (Number(paid?.count ?? 0) > 0) {
      throw new Error(`По поставке ${linkedSupply.supplyNumber} уже проходили оплаты — сначала разберитесь с ней в разделе поставщиков`);
    }
  }

  await db.transaction(async (tx) => {
    // Delete items first (FK) — use sql template for safe parameterization
    await tx.execute(sql`DELETE FROM arrival_items WHERE arrival_id = ${arrivalId}`);
    if (linkedSupply) {
      await tx.delete(supplies).where(and(eq(supplies.id, linkedSupply.id), eq(supplies.tenantId, tenantId)));
    }
    await tx.delete(arrivals).where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId)));
  });

  return { success: true };
}

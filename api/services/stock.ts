import { warehouseStock, products, warehouses } from "@db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { sseBus } from "../lib/sse";
import { recordAudit } from "./audit-log";
import { recordStockMovement } from "./stock-ledger";
import { TRPCError } from "@trpc/server";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface StockItem {
  productId: number;
  quantity: number;
}

/** Get default warehouse for a tenant. Used when no warehouseId is specified. */
async function getDefaultWarehouseId(db: DrizzleInstance, tenantId: number): Promise<number> {
  const [wh] = await db.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .limit(1);
  if (!wh) throw new Error("Склад по умолчанию не найден");
  return wh.id;
}

export const StockService = {
  async reserve(db: DrizzleInstance, tenantId: number, items: StockItem[], warehouseId?: number) {
    if (items.length === 0) return { success: true };

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    await db.transaction(async (tx) => {
      const productIds = items.map(i => i.productId);
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          inArray(warehouseStock.productId, productIds),
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, whId),
        ))
        .for("update");

      const stockMap = new Map<number, typeof stockRows[number]>();
      for (const row of stockRows) stockMap.set(row.productId, row);

      for (const item of items) {
        const stock = stockMap.get(item.productId);
        const availableQty = Number(stock?.available ?? 0);
        if (availableQty < item.quantity) {
          throw new Error(`Недостаточно товара на складе (доступно: ${availableQty}, запрошено: ${item.quantity})`);
        }
      }

      await tx.execute(sql`
        UPDATE warehouse_stock
        SET
          reserved = reserved + CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END,
          available = available - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END
        WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
          AND tenant_id = ${tenantId}
          AND warehouse_id = ${whId}
      `);
    });

    return { success: true };
  },

  async release(db: DrizzleInstance, tenantId: number, items: StockItem[], warehouseId?: number) {
    if (items.length === 0) return { success: true };

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    await db.transaction(async (tx) => {
      const productIds = items.map(i => i.productId);
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          inArray(warehouseStock.productId, productIds),
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, whId),
        ))
        .for("update");

      const stockMap = new Map<number, typeof stockRows[number]>();
      for (const row of stockRows) stockMap.set(row.productId, row);

      for (const item of items) {
        const stock = stockMap.get(item.productId);
        const reservedQty = Number(stock?.reserved ?? 0);
        if (reservedQty < item.quantity) {
          throw new Error(`Недостаточно зарезервированного товара (зарезервировано: ${reservedQty}, запрошено: ${item.quantity})`);
        }
      }

      await tx.execute(sql`
        UPDATE warehouse_stock
        SET
          reserved = reserved - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END,
          available = available + CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END
        WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
          AND tenant_id = ${tenantId}
          AND warehouse_id = ${whId}
      `);
    });

    return { success: true };
  },

  async deduct(db: DrizzleInstance, tenantId: number, items: StockItem[], warehouseId?: number) {
    if (items.length === 0) return { success: true };

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    await db.transaction(async (tx) => {
      const productIds = items.map(i => i.productId);
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          inArray(warehouseStock.productId, productIds),
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, whId),
        ))
        .for("update");

      const stockMap = new Map<number, typeof stockRows[number]>();
      for (const row of stockRows) stockMap.set(row.productId, row);

      for (const item of items) {
        const stock = stockMap.get(item.productId);
        const currentQty = Number(stock?.currentStock ?? 0);
        if (currentQty < item.quantity) {
          throw new Error(`Недостаточно товара на складе (на складе: ${currentQty}, запрошено: ${item.quantity})`);
        }
      }

      await tx.execute(sql`
        UPDATE warehouse_stock
        SET
          current_stock = current_stock - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END,
          reserved = reserved - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END,
          available = (current_stock - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END) - (reserved - CASE ${sql.join(items.map(i =>
            sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
          ), sql`\n`)} ELSE 0 END)
        WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
          AND tenant_id = ${tenantId}
          AND warehouse_id = ${whId}
      `);

      for (const item of items) {
        await recordStockMovement(tx, {
          tenantId, warehouseId: whId, productId: item.productId,
          type: "out", quantity: item.quantity,
          reason: "order_delivery", notes: "Списание по заказу",
        });
      }
    });

    return { success: true };
  },

  async adjust(
    db: DrizzleInstance,
    tenantId: number,
    productId: number,
    quantity: number,
    type: "in" | "out" | "adjustment",
    notes?: string,
    actor?: { id: number; name: string; ip?: string },
    warehouseId?: number,
  ) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Количество должно быть положительным числом");
    }

    // productId приходит от клиента, а таблица products общая для платформы.
    // Проверки принадлежности здесь не было: оператор организации A вызывал
    // adjustStock с чужим productId, в warehouse_stock появлялась строка
    // tenant_id=A / product_id организации B, и warehouse.list возвращал её
    // вместе с названием, кодом, категорией, ценой и СЕБЕСТОИМОСТЬЮ чужого
    // товара. Перебором id так выгружался чужой прайс и закупочные цены.
    //
    // Правило и текст отказа те же, что в assertProductsBelongToTenant
    // (api/lib/tenant-refs.ts), включая главное: название чужого товара в
    // ответе не называется, иначе сообщение об ошибке само станет тем каналом
    // утечки, который мы закрываем. Проверка сделана здесь запросом на один
    // товар, а не вызовом того хелпера: тот принимает список и строит условие
    // через inArray ради десятков строк прайс-листа, а сюда всегда приходит
    // ровно один товар.
    const [ownProduct] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);
    if (!ownProduct) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Товар #${productId} не найден в вашей организации`,
      });
    }

    // Склад тоже приходит снаружи. getDefaultWarehouseId фильтрует по
    // организации, а явно переданный warehouseId раньше не проверялся вовсе —
    // и остаток можно было записать на чужой склад.
    if (warehouseId !== undefined) {
      const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
      if (!wh) throw new Error("Склад не найден в вашей организации");
    }

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    let updatedAvailable: string | undefined;
    let productName: string | undefined;
    let reorderPoint: string | undefined;
    let adjustmentDiff = 0;

    await db.transaction(async (tx) => {
      const stockWhere = and(
        eq(warehouseStock.productId, productId),
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, whId),
      );
      let [currentStock] = await tx.select({
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
        reserved: warehouseStock.reserved,
      })
        .from(warehouseStock).where(stockWhere).limit(1).for("update");

      // If no stock row exists, create one
      if (!currentStock) {
        await tx.insert(warehouseStock).values({
          tenantId,
          warehouseId: whId,
          productId,
          currentStock: "0.00",
          reserved: "0.00",
          available: "0.00",
        });
        currentStock = { currentStock: "0.00", available: "0.00", reserved: "0.00" };
      }

      const currentQty = Number(currentStock?.currentStock ?? 0);
      const availableQty = Number(currentStock?.available ?? 0);
      const reservedQty = Number(currentStock?.reserved ?? 0);

      if (type === "in") {
        await tx.update(warehouseStock).set({
          currentStock: sql`${warehouseStock.currentStock} + ${quantity}`,
          available: sql`${warehouseStock.available} + ${quantity}`,
        }).where(stockWhere);
      } else if (type === "out") {
        // Сверка шла с current_stock, а списывать можно только свободный
        // остаток. При current 100 / reserved 100 / available 0 списание 20
        // единиц боя проходило (100 >= 20) и загоняло available в −20.
        // Инвариант current = available + reserved при этом формально сходится,
        // поэтому ни одна проверка целостности не срабатывала, а всплывало это
        // позже и в другом месте: OrderService.create по такому товару падал с
        // «Некорректный остаток товара на складе. Обратитесь к администратору».
        //
        // В тексте ошибки назван резерв: без него оператор видит на складе сто
        // единиц и не понимает, почему нельзя списать двадцать.
        if (availableQty < quantity) {
          throw new Error(
            `Недостаточно свободного товара на складе (на складе: ${currentQty}, из них ${reservedQty} зарезервировано под заказы; свободно: ${availableQty}, запрошено: ${quantity})`,
          );
        }
        await tx.update(warehouseStock).set({
          currentStock: sql`${warehouseStock.currentStock} - ${quantity}`,
          available: sql`${warehouseStock.available} - ${quantity}`,
        }).where(stockWhere);

        const [updatedStock] = await tx.select({ available: warehouseStock.available })
          .from(warehouseStock).where(stockWhere).limit(1);
        // Условие по организации и на чтении: в базе могут лежать строки
        // warehouse_stock с чужим product_id, записанные до появления проверки
        // выше, и подставлять в уведомление название чужого товара нельзя.
        const [product] = await tx.select({ name: products.name, reorderPoint: products.reorderPoint })
          .from(products).where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);

        updatedAvailable = updatedStock?.available;
        productName = product?.name;
        reorderPoint = product?.reorderPoint;
      } else {
        // Инвентаризация задаёт новое АБСОЛЮТНОЕ количество. Опустить его ниже
        // резерва нельзя: зарезервированное уже обещано открытым заказам, и
        // пересчёт «было 100, стало 80» при резерве 100 уводил available в −20
        // ровно так же, как списание выше. Резерв назван в тексте, иначе отказ
        // читается как придирка к цифре.
        if (quantity < reservedQty) {
          throw new Error(
            `Новое количество (${quantity}) меньше зарезервированного под заказы (${reservedQty}). Сначала проведите или отмените заказы, занявшие резерв.`,
          );
        }
        const diff = quantity - currentQty;
        await tx.update(warehouseStock).set({
          currentStock: String(quantity),
          available: sql`${warehouseStock.available} + ${diff}`,
        }).where(stockWhere);
        adjustmentDiff = diff;
      }

      // For "in"/"out" the caller's `quantity` already is the magnitude that
      // just moved. For "adjustment" it's the new absolute count, not a
      // movement size — logging it verbatim overstated every recount (and
      // fabricated a movement for a recount that confirmed the count was
      // already correct). Recording the true delta as a signed "in"/"out"
      // also matches this ledger's own documented meaning of those types.
      if (type !== "adjustment") {
        await recordStockMovement(tx, {
          tenantId, warehouseId: whId, productId,
          type, quantity, reason: "manual_adjustment", notes,
        });
      } else if (adjustmentDiff !== 0) {
        await recordStockMovement(tx, {
          tenantId, warehouseId: whId, productId,
          type: adjustmentDiff > 0 ? "in" : "out",
          quantity: Math.abs(adjustmentDiff),
          reason: "manual_adjustment", notes,
        });
      }
    });

    if (type === "out" && updatedAvailable !== undefined && productName !== undefined && reorderPoint !== undefined) {
      if (Number(updatedAvailable) < Number(reorderPoint)) {
        sseBus.emit({
          type: "stock.low",
          tenantId,
          data: { productId, productName, available: updatedAvailable, reorderPoint },
        });
      }
    }

    recordAudit(db, {
      tenantId,
      actorId: actor?.id,
      actorName: actor?.name,
      action: "stock.adjusted",
      targetType: "product",
      targetId: productId,
      meta: { type, quantity, notes, productName, updatedAvailable },
      ip: actor?.ip,
    });

    return { success: true };
  },
};

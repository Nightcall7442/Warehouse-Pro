import { warehouseStock, stockMovements, products, warehouses } from "@db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { sseBus } from "../lib/sse";
import { recordAudit } from "./audit-log";

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

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    let updatedAvailable: string | undefined;
    let productName: string | undefined;
    let reorderPoint: string | undefined;

    await db.transaction(async (tx) => {
      const stockWhere = and(
        eq(warehouseStock.productId, productId),
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, whId),
      );
      const [currentStock] = await tx.select({
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
      })
        .from(warehouseStock).where(stockWhere).limit(1).for("update");

      const currentQty = Number(currentStock?.currentStock ?? 0);

      if (type === "in") {
        await tx.update(warehouseStock).set({
          currentStock: sql`${warehouseStock.currentStock} + ${quantity}`,
          available: sql`${warehouseStock.available} + ${quantity}`,
        }).where(stockWhere);
      } else if (type === "out") {
        if (currentQty < quantity) {
          throw new Error(`Недостаточно товара на складе (на складе: ${currentQty}, запрошено: ${quantity})`);
        }
        await tx.update(warehouseStock).set({
          currentStock: sql`${warehouseStock.currentStock} - ${quantity}`,
          available: sql`${warehouseStock.available} - ${quantity}`,
        }).where(stockWhere);

        const [updatedStock] = await tx.select({ available: warehouseStock.available })
          .from(warehouseStock).where(stockWhere).limit(1);
        const [product] = await tx.select({ name: products.name, reorderPoint: products.reorderPoint })
          .from(products).where(eq(products.id, productId)).limit(1);

        updatedAvailable = updatedStock?.available;
        productName = product?.name;
        reorderPoint = product?.reorderPoint;
      } else {
        const diff = quantity - currentQty;
        await tx.update(warehouseStock).set({
          currentStock: String(quantity),
          available: sql`${warehouseStock.available} + ${diff}`,
        }).where(stockWhere);
      }

      await tx.insert(stockMovements).values({
        tenantId,
        productId,
        type,
        quantity: String(quantity),
        notes,
      });
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

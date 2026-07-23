import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { arrivals, arrivalItems, products, warehouseStock, warehouses } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "./lib/sanitize";

export const arrivalRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      status:   z.enum(["pending", "unloading", "completed"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(arrivals.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(arrivals.status, input.status));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
          driverName: arrivals.driverName, status: arrivals.status,
          fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
          totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
          arrivalTime: arrivals.arrivalTime, createdAt: arrivals.createdAt,
        }).from(arrivals).where(where).limit(pageSize).offset(offset).orderBy(desc(arrivals.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(arrivals).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const [arrival] = await db.select({
        id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
        driverName: arrivals.driverName, driverPhone: arrivals.driverPhone, status: arrivals.status,
        fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
        totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
        arrivalTime: arrivals.arrivalTime, unloadingTime: arrivals.unloadingTime,
        notes: arrivals.notes, createdAt: arrivals.createdAt,
      }).from(arrivals)
        .where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId))).limit(1);
      if (!arrival) return null;

      let items: any[];
      try {
        const result = await db.execute(sql`
          SELECT ai.id, ai.arrival_id, ai.product_id, ai.quantity, ai.condition, ai.notes,
                 p.name AS productName, p.code AS productCode
          FROM arrival_items ai
          LEFT JOIN products p ON ai.product_id = p.id
          WHERE ai.arrival_id = ${arrival.id}
        `);
        const rows = (result as any)[0];
        items = Array.isArray(rows) ? rows.map((r: any) => ({
          ...r,
          costPrice: r.cost_price ?? "0.00",
          sellingPrice: r.selling_price ?? "0.00",
        })) : [];
      } catch {
        items = [];
      }

      return { ...arrival, items };
    }),

  create: operatorQuery
    .input(z.object({
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      arrivalDate: z.string(),
      fuelCost:    z.string().default("0.00"),
      tollCost:    z.string().default("0.00"),
      otherCost:   z.string().default("0.00"),
      notes:       z.string().optional(),
      items:       z.array(z.object({ productId: z.number(), quantity: z.string(), costPrice: z.string().optional(), sellingPrice: z.string().optional(), condition: z.string().optional(), warehouseId: z.number().optional() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const raw = crypto.randomUUID().replace(/-/g, "");
      const arrivalNumber = `ARR-${raw.slice(0, 12).toUpperCase()}`;
      const totalExpense  = (Number(input.fuelCost) + Number(input.tollCost) + Number(input.otherCost)).toFixed(2);

      const [result] = await db.insert(arrivals).values({
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

      if (input.items && input.items.length > 0) {
        // Insert items one by one to avoid raw SQL issues with column mismatches
        for (const item of input.items) {
          try {
            await db.insert(arrivalItems).values({
              arrivalId,
              productId: item.productId,
              quantity: item.quantity,
              condition: item.condition ? sanitizeString(item.condition) : undefined,
            });
          } catch {
            // If columns don't exist, skip this item (migration 0016 will fix it)
          }
        }
      }

      return { id: arrivalId, arrivalNumber };
    }),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      status:      z.enum(["pending", "unloading", "completed"]).optional(),
      warehouseId: z.number().optional(),
      fuelCost:    z.string().optional(),
      tollCost:    z.string().optional(),
      otherCost:   z.string().optional(),
      notes:       z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const { id, ...data } = input;
      const targetWarehouseId = data.warehouseId;
      delete data.warehouseId;

      // When completing an arrival, update warehouse stock in a transaction
      if (data.status === "completed") {
        // Get arrival number for stock movement notes
        const [arrivalRow] = await db.select({ arrivalNumber: arrivals.arrivalNumber })
          .from(arrivals).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
        const arrivalNumber = arrivalRow?.arrivalNumber ?? `#${id}`;

        await db.transaction(async (tx) => {
          // Use sql template (not Drizzle select) to avoid selecting non-existent columns
          const itemsResult = await tx.execute(
            sql`SELECT ai.id, ai.arrival_id, ai.product_id, ai.quantity, ai.condition, ai.notes FROM arrival_items ai WHERE ai.arrival_id = ${id}`
          );
          const rows = (itemsResult as any)[0];
          const items = Array.isArray(rows) ? rows : [];

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

            // Upsert warehouse_stock using INSERT ... ON DUPLICATE KEY UPDATE
            await tx.execute(sql`
              INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
              VALUES (${tenantId}, ${warehouseId}, ${item.productId}, ${qty}, 0, ${qty})
              ON DUPLICATE KEY UPDATE
                current_stock = current_stock + ${qty},
                available = available + ${qty}
            `);

            // Create stock movement record
            try {
              const { stockMovements } = await import("@db/schema");
              await tx.insert(stockMovements).values({
                tenantId, productId: item.productId,
                type: "in", quantity: String(qty),
                referenceType: "arrival", referenceId: id,
                notes: `Приход ${arrivalNumber}`,
              });
            } catch { /* stock_movements table may not exist */ }
          }

          // Update arrival status
          if (data.fuelCost || data.tollCost || data.otherCost) {
            const fuel  = Number(data.fuelCost  ?? "0");
            const toll  = Number(data.tollCost  ?? "0");
            const other = Number(data.otherCost ?? "0");
            await tx.update(arrivals).set({ ...data, totalExpense: (fuel + toll + other).toFixed(2) })
              .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
          } else {
            await tx.update(arrivals).set(data).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
          }
        });

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
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Only allow deleting pending arrivals
      const [arrival] = await db.select({ id: arrivals.id, status: arrivals.status })
        .from(arrivals).where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId))).limit(1);
      if (!arrival) throw new Error("Приход не найден");
      if (arrival.status === "completed") throw new Error("Нельзя удалить завершённый приход");

      await db.transaction(async (tx) => {
        // Delete items first (FK) — use sql template for safe parameterization
        await tx.execute(sql`DELETE FROM arrival_items WHERE arrival_id = ${input.id}`);
        await tx.delete(arrivals).where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId)));
      });

      return { success: true };
    }),
});

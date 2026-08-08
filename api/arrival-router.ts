import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { arrivals, arrivalItems, products, warehouses } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "./lib/sanitize";
import { decimalOrDefault } from "./lib/zod-decimal";
import { sseBus } from "./lib/sse";
import { recordStockMovement } from "./services/stock-ledger";

type ArrivalItemRow = {
  id:           number;
  productId:    number;
  quantity:     string;
  condition:    string | null;
  notes:        string | null;
  costPrice:    string | null;
  sellingPrice: string | null;
  productName:  string | null;
  productCode:  string | null;
};

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

      // Always use raw SQL for items — avoids Drizzle referencing non-existent columns
      let items: Array<{ id: number; productId: number; quantity: number; condition: string; notes: string; productName: string; productCode: string; costPrice: string; sellingPrice: string }>;
      try {
        const result = await db.execute(sql`SELECT ai.id, ai.product_id AS productId, ai.quantity, ai.condition, ai.notes, ai.cost_price AS costPrice, ai.selling_price AS sellingPrice, p.name AS productName, p.code AS productCode FROM arrival_items ai LEFT JOIN products p ON ai.product_id = p.id WHERE ai.arrival_id = ${arrival.id}`);
        const [rows] = result as unknown as [ArrivalItemRow[], unknown];
        items = Array.isArray(rows) ? rows.map(r => ({
          id: Number(r.id),
          productId: Number(r.productId),
          quantity: Number(r.quantity),
          condition: String(r.condition ?? ""),
          notes: String(r.notes ?? ""),
          productName: String(r.productName ?? ""),
          productCode: String(r.productCode ?? ""),
          costPrice: String(r.costPrice ?? "0.00"),
          sellingPrice: String(r.sellingPrice ?? "0.00"),
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
      fuelCost:    decimalOrDefault("0.00").default("0.00"),
      tollCost:    decimalOrDefault("0.00").default("0.00"),
      otherCost:   decimalOrDefault("0.00").default("0.00"),
      notes:       z.string().optional(),
      items:       z.array(z.object({ productId: z.number(), quantity: z.string().refine(v => Number(v) > 0, "Количество должно быть положительным"), costPrice: decimalOrDefault("0.00").optional(), sellingPrice: decimalOrDefault("0.00").optional(), condition: z.string().optional(), warehouseId: z.number().optional() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
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

        if (input.items && input.items.length > 0) {
          for (const item of input.items) {
            await tx.insert(arrivalItems).values({
              arrivalId,
              productId: item.productId,
              quantity: item.quantity,
              costPrice: item.costPrice ?? "0.00",
              sellingPrice: item.sellingPrice ?? "0.00",
              condition: item.condition ? sanitizeString(item.condition) : undefined,
            });
          }
        }

        return { id: arrivalId, arrivalNumber };
      });
    }),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      status:      z.enum(["pending", "unloading", "completed"]).optional(),
      warehouseId: z.number().optional(),
      fuelCost:    decimalOrDefault("0.00").optional(),
      tollCost:    decimalOrDefault("0.00").optional(),
      otherCost:   decimalOrDefault("0.00").optional(),
      notes:       z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
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
          const itemsResult = await tx.execute(
            sql`SELECT ai.id, ai.arrival_id AS arrivalId, ai.product_id AS productId, ai.quantity, ai.condition, ai.notes FROM arrival_items ai WHERE ai.arrival_id = ${id}`
          );
          const rows = (itemsResult as unknown[][])[0];
          const rawItems = Array.isArray(rows) ? rows : [];
          // The columns are AS-aliased to camelCase above, so this cast is safe —
          // unlike the `unknown` the raw sql.execute() result carries by default.
          const items = rawItems as Array<{ id: number; arrivalId: number; productId: number; quantity: string; condition: string; notes: string | null }>;
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

            // Lock the row first to prevent race conditions on concurrent arrivals
            // mysql2 returns [rows, fields]; rows is an empty array [] when no match
            const [rows] = await tx.execute(sql`
              SELECT id FROM warehouse_stock
              WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${item.productId}
              FOR UPDATE
            `) as unknown as [Array<{ id: number }>, unknown];
            const existing = rows?.[0];

            if (existing) {
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET current_stock = current_stock + ${qty}, available = available + ${qty}
                WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${item.productId}
              `);
            } else {
              await tx.execute(sql`
                INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
                VALUES (${tenantId}, ${warehouseId}, ${item.productId}, ${qty}, 0, ${qty})
              `);
            }

            await recordStockMovement(tx, {
              tenantId, warehouseId, productId: item.productId,
              type: "in", quantity: qty,
              reason: "arrival", referenceId: id,
              notes: `Приход ${arrivalNumber}`,
            });
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
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
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

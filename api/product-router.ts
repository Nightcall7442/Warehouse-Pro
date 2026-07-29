import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, warehouseStock, stockMovements, warehouses } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";
import { ProductService } from "./services/ProductService";

async function getDefaultWarehouseId(db: ReturnType<typeof getDb>, tenantId: number): Promise<number | null> {
  const [wh] = await db.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .limit(1);
  return wh?.id ?? null;
}

export const productRouter = createRouter({
  /** All active products for a tenant — no pagination, used by mobile catalog & selectors */
  listAll: fieldSalesQuery
    .input(z.object({ search: z.string().optional(), category: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      const cacheKey = `products:${tenantId}:listAll:${input?.search ?? ""}:${input?.category ?? ""}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const warehouseId = await getDefaultWarehouseId(db, tenantId);

      const conditions = [eq(products.tenantId, tenantId), eq(products.status, "active")];
      if (input?.search)   conditions.push(like(products.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.category) conditions.push(eq(products.category, input?.category));
      const where = and(...conditions);

      const stockJoinCond = warehouseId
        ? and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId))
        : and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId));

      const data = await db.select({
        id:           products.id,
        code:         products.code,
        name:         products.name,
        category:     products.category,
        costPrice:    products.costPrice,
        unitPrice:    products.unitPrice,
        unit:         products.unit,
        unitWeight:   products.unitWeight,
        description:  products.description,
        photoUrl:     products.photoUrl,
        reorderPoint: products.reorderPoint,
        status:       products.status,
        createdAt:    products.createdAt,
        currentStock: warehouseStock.currentStock,
        available:    warehouseStock.available,
      })
        .from(products)
        .leftJoin(warehouseStock, stockJoinCond)
        .where(where)
        .orderBy(products.name)
        .limit(10000);

      cache.set(cacheKey, data, CacheTTL.products);
      return data;
    }),

  list: fieldSalesQuery
    .input(z.object({
      page:       z.number().default(1),
      pageSize:   z.number().default(25),
      search:     z.string().optional(),
      category:   z.string().optional(),
      includeAll: z.boolean().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const warehouseId = await getDefaultWarehouseId(db, tenantId);

      const cacheKey = CacheKeys.productList(tenantId, page, input?.search, input?.category) + (input?.includeAll ? ":all" : "");
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const conditions = [eq(products.tenantId, tenantId)];
      if (!input?.includeAll) conditions.push(eq(products.status, "active"));
      if (input?.search)   conditions.push(like(products.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.category) conditions.push(eq(products.category, input?.category));
      const where = and(...conditions);

      const stockJoinCond = warehouseId
        ? and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId))
        : and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId));

      const [data, countResult] = await Promise.all([
        db.select({
          id:           products.id,
          code:         products.code,
          name:         products.name,
          category:     products.category,
          costPrice:    products.costPrice,
          unitPrice:    products.unitPrice,
          unit:         products.unit,
          unitWeight:   products.unitWeight,
          description:  products.description,
          photoUrl:     products.photoUrl,
          reorderPoint: products.reorderPoint,
          status:       products.status,
          createdAt:    products.createdAt,
          currentStock: warehouseStock.currentStock,
          available:    warehouseStock.available,
        })
          .from(products)
          .leftJoin(warehouseStock, stockJoinCond)
          .where(where)
          .limit(pageSize)
          .offset(offset)
          .orderBy(products.name),
        db.select({ count: sql<number>`count(*)` }).from(products).where(where),
      ]);

      const result = { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
      cache.set(cacheKey, result, CacheTTL.products);
      return result;
    }),

  getById: fieldSalesQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const warehouseId = await getDefaultWarehouseId(db, tenantId);

      const [product] = await db.select({
        id: products.id, code: products.code, barcode: products.barcode, name: products.name,
        category: products.category, costPrice: products.costPrice, unitPrice: products.unitPrice,
        unit: products.unit, unitWeight: products.unitWeight, description: products.description,
        photoUrl: products.photoUrl, reorderPoint: products.reorderPoint, status: products.status,
        createdAt: products.createdAt,
      }).from(products)
        .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)))
        .limit(1);
      if (!product) return null;

      const stockWhere = warehouseId
        ? and(eq(warehouseStock.productId, product.id), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId))
        : and(eq(warehouseStock.productId, product.id), eq(warehouseStock.tenantId, tenantId));

      const [stockResult, movements] = await Promise.all([
        db.select({
          id: warehouseStock.id, currentStock: warehouseStock.currentStock,
          reserved: warehouseStock.reserved, available: warehouseStock.available,
        }).from(warehouseStock)
          .where(stockWhere)
          .limit(1),
        db.select({
          id: stockMovements.id, type: stockMovements.type, quantity: stockMovements.quantity,
          referenceType: stockMovements.referenceType, referenceId: stockMovements.referenceId,
          notes: stockMovements.notes, createdAt: stockMovements.createdAt,
        }).from(stockMovements)
          .where(and(eq(stockMovements.productId, product.id), eq(stockMovements.tenantId, tenantId)))
          .orderBy(desc(stockMovements.createdAt))
          .limit(20),
      ]);

      return { ...product, stock: stockResult[0] ?? null, movements };
    }),

  create: operatorQuery
    .input(z.object({
      code:         z.string().min(1),
      barcode:      z.string().optional(),
      name:         z.string().min(1),
      category:     z.string().optional(),
      costPrice:    z.string().refine(v => Number(v) >= 0, "Цена не может быть отрицательной").default("0.00"),
      unitPrice:    z.string().refine(v => Number(v) > 0, "Цена должна быть положительной"),
      unit:         z.enum(["kg", "l", "pcs", "box", "pack", "m", "block"]).default("pcs"),
      unitWeight:   z.string().default("0.000"),
      description:  z.string().optional(),
      photoUrl:     z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").optional(),
      reorderPoint: z.string().default("10.00"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const sanitized = {
        ...input,
        code: sanitizeString(input.code),
        name: sanitizeString(input.name),
        category: input.category ? sanitizeString(input.category) : undefined,
        description: input.description ? sanitizeString(input.description) : undefined,
      };

      const productId = await db.transaction(async (tx) => {
        const [result] = await tx.insert(products).values({ tenantId, ...sanitized, status: "active" });
        const id = Number(result.insertId);

        // Get or create default warehouse
        let [defaultWarehouse] = await tx.select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
          .limit(1);

        if (!defaultWarehouse) {
          const [created] = await tx.insert(warehouses).values({
            tenantId, name: "Основной склад", isDefault: true, status: "active",
          });
          defaultWarehouse = { id: Number(created.insertId) };
        }

        // Use raw SQL to handle case where warehouse_id column may not exist yet
        try {
          await tx.execute(sql`INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available) VALUES (${tenantId}, ${defaultWarehouse.id}, ${id}, '0.00', '0.00', '0.00')`);
        } catch {
          // Fallback: try without warehouse_id (column may not exist)
          try {
            await tx.execute(sql`INSERT INTO warehouse_stock (tenant_id, product_id, current_stock, reserved, available) VALUES (${tenantId}, ${id}, '0.00', '0.00', '0.00')`);
          } catch { /* give up */ }
        }

        return id;
      });

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      cache.invalidatePrefix(`warehouse:${tenantId}`);
      cache.invalidatePrefix(`warehouse_valuation:${tenantId}`);
      return { id: productId };
    }),

  update: operatorQuery
    .input(z.object({
      id:           z.number(),
      code:         z.string().min(1).optional(),
      name:         z.string().min(1).optional(),
      category:     z.string().optional(),
      costPrice:    z.string().refine(v => v === undefined || Number(v) >= 0, "Цена не может быть отрицательной").optional(),
      unitPrice:    z.string().refine(v => v === undefined || Number(v) > 0, "Цена должна быть положительной").optional(),
      unit:         z.enum(["kg", "l", "pcs", "box", "pack", "m", "block"]).optional(),
      unitWeight:   z.string().optional(),
      description:  z.string().optional(),
      photoUrl:     z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").nullable().optional(),
      reorderPoint: z.string().optional(),
      status:       z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const sanitized: Record<string, unknown> = { ...data };
      if (typeof data.code === "string") sanitized.code = sanitizeString(data.code);
      if (typeof data.name === "string") sanitized.name = sanitizeString(data.name);
      if (typeof data.category === "string") sanitized.category = sanitizeString(data.category);
      if (typeof data.description === "string") sanitized.description = sanitizeString(data.description);

      // Skip update if no fields to set
      if (Object.keys(sanitized).length === 0) return { success: true };

      await getDb().update(products).set(sanitized)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenant.id)));
      cache.invalidatePrefix(`products:${ctx.tenant.id}`);
      cache.invalidatePrefix(`product_cats:${ctx.tenant.id}`);
      cache.invalidatePrefix(`warehouse:${ctx.tenant.id}`);
      cache.invalidatePrefix(`warehouse_valuation:${ctx.tenant.id}`);
      return { success: true };
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const warehouseId = await getDefaultWarehouseId(db, tenantId);

      const [existingProduct] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId))).limit(1);
      if (!existingProduct) throw new Error("Товар не найден");

      // Delete warehouse_stock
      const deleteStockWhere = warehouseId
        ? and(eq(warehouseStock.productId, input.id), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId))
        : and(eq(warehouseStock.productId, input.id), eq(warehouseStock.tenantId, tenantId));
      await db.delete(warehouseStock).where(deleteStockWhere);

      // Try hard delete — if FK constraints block it, fall back to soft delete
      try {
        await db.delete(products).where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)));
      } catch (err: unknown) {
        const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code ?? "";
        const msg = (err as { cause?: { message?: string }; message?: string })?.cause?.message ?? (err as { message?: string })?.message ?? "";
        // Only soft-delete if it's an FK constraint error, re-throw otherwise
        if (code === "ER_NO_REFERENCED_ROW_2" || code === "ER_ROW_IS_REFERENCED" || msg.includes("foreign key") || msg.includes("a child row")) {
          await db.update(products)
            .set({ status: "inactive", updatedAt: new Date() })
            .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)));
        } else {
          throw err;
        }
      }

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      cache.invalidatePrefix(`warehouse:${tenantId}`);
      cache.invalidatePrefix(`warehouse_valuation:${tenantId}`);
      return { success: true };
    }),

  bulkDelete: operatorQuery
    .input(z.object({ ids: z.array(z.number()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const warehouseId = await getDefaultWarehouseId(db, tenantId);

      let deleted = 0;
      let softDeleted = 0;

      await db.transaction(async (tx) => {
        for (const id of input.ids) {
          try {
            // Delete warehouse_stock
            const stockWhere = warehouseId
              ? and(eq(warehouseStock.productId, id), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId))
              : and(eq(warehouseStock.productId, id), eq(warehouseStock.tenantId, tenantId));
            await tx.delete(warehouseStock).where(stockWhere);

            // Try hard delete
            const [result] = await tx.delete(products)
              .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
            if (((result as { affectedRows?: number }).affectedRows ?? 0) > 0) {
              deleted++;
            } else {
              softDeleted++;
            }
          } catch (err: unknown) {
            const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code ?? "";
            const msg = (err as { cause?: { message?: string }; message?: string })?.cause?.message ?? (err as { message?: string })?.message ?? "";
            if (code === "ER_NO_REFERENCED_ROW_2" || code === "ER_ROW_IS_REFERENCED" || msg.includes("foreign key") || msg.includes("a child row")) {
              await tx.update(products)
                .set({ status: "inactive", updatedAt: new Date() })
                .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
              softDeleted++;
            } else {
              throw err;
            }
          }
        }
      });

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      cache.invalidatePrefix(`warehouse:${tenantId}`);
      cache.invalidatePrefix(`warehouse_valuation:${tenantId}`);
      return { deleted, softDeleted, total: input.ids.length };
    }),

  uploadPhoto: operatorQuery
    .input(z.object({
      productId: z.number(),
      dataUrl: z.string().refine((val) => val.startsWith("data:image/") || val.startsWith("http://") || val.startsWith("https://"), "Неверный формат изображения (data URL или HTTP/HTTPS URL)").max(5_000_000, "Файл слишком большой (макс. 4 МБ)"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { env } = await import("./lib/env");
        const isS3 = !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);

        if (!isS3) {
          // No S3 configured — store base64 directly (will bloat DB, but functional)
          await getDb().update(products)
            .set({ photoUrl: input.dataUrl })
            .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id)));
          return { success: true, warning: "S3 не настроен — фото сохранено в БД (рекомендуется настроить S3)" };
        }

        const match = input.dataUrl.match(/^data:image\/(\w+);base64,([\s\S]+)$/);
        if (!match) throw new Error("Неверный формат изображения");

        const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
        const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
        const key = `products/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({
          region: env.s3Region || "us-east-1",
          credentials: { accessKeyId: env.s3AccessKey || "", secretAccessKey: env.s3SecretKey || "" },
        });
        await s3.send(new PutObjectCommand({
          Bucket: env.s3Bucket!, Key: key, Body: buffer,
          ContentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
        }));

        const photoUrl = `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
        await getDb().update(products)
          .set({ photoUrl })
          .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id)));
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[uploadPhoto FAILED]", msg);
        throw new Error(`Ошибка загрузки фото: ${msg}`);
      }
    }),

  // ── Find by Barcode ─────────────────────────────────────────────────────────
  // P0-15 FIX: Changed from supervisorQuery to fieldSalesQuery — agents and operators scan barcodes
  findByBarcode: fieldSalesQuery
    .input(z.object({ barcode: z.string() }))
    .query(async ({ input, ctx }) => {
      return ProductService.searchByBarcode(getDb(), ctx.tenant.id, input.barcode);
    }),

  categories: fieldSalesQuery.query(async ({ ctx }) => {
    const tenantId = ctx.tenant.id;
    const cacheKey = CacheKeys.productCategories(tenantId);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const results = await getDb().select({ category: products.category })
      .from(products).where(and(eq(products.tenantId, tenantId), eq(products.status, "active"))).groupBy(products.category);
    const cats = results.map(r => r.category).filter(Boolean);
    cache.set(cacheKey, cats, CacheTTL.categories);
    return cats;
  }),

  renameCategory: operatorQuery
    .input(z.object({ from: z.string().min(1), to: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      await db.update(products)
        .set({ category: sanitizeString(input.to) })
        .where(and(eq(products.tenantId, tenantId), eq(products.category, input.from)));
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      return { success: true };
    }),

  deleteCategory: operatorQuery
    .input(z.object({ category: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      await db.update(products)
        .set({ category: null })
        .where(and(eq(products.tenantId, tenantId), eq(products.category, input.category)));
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      return { success: true };
    }),

  /** Delete ALL products for this tenant — clears stock, movements, and product records */
  clearAll: operatorQuery
    .mutation(async ({ ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const ALLOWED_TABLES = new Set([
        "order_items", "arrival_items", "return_items", "price_list_items",
        "stock_transfers", "stock_movements", "warehouse_stock",
        "orders", "returns", "products",
      ]);

      // FK-safe delete order using raw SQL (Drizzle can't handle all FK combos)
      await db.transaction(async (tx) => {
        const del = (table: string) => {
          if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table: ${table}`);
          return tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE product_id IN (SELECT id FROM products WHERE tenant_id = ${tenantId})`);
        };
        const delByTenant = (table: string) => {
          if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table: ${table}`);
          return tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
        };

        await del("order_items").catch(() => {});
        await del("arrival_items").catch(() => {});
        await del("return_items").catch(() => {});
        await del("price_list_items").catch(() => {});
        await delByTenant("stock_transfers").catch(() => {});
        await delByTenant("stock_movements").catch(() => {});
        await delByTenant("warehouse_stock").catch(() => {});

        await delByTenant("orders").catch(() => {});
        await delByTenant("returns").catch(() => {});

        await tx.execute(sql`DELETE FROM products WHERE tenant_id = ${tenantId}`);
      });

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      cache.invalidatePrefix(`warehouse:${tenantId}`);
      cache.invalidatePrefix(`warehouse_valuation:${tenantId}`);
      return { success: true };
    }),
});
import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery } from "./middleware";
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
        .orderBy(products.name);

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
      costPrice:    z.string().default("0.00"),
      unitPrice:    z.string(),
      unit:         z.enum(["kg", "l", "pcs", "box", "pack", "m"]).default("pcs"),
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
        name: sanitizeString(input.name),
        category: input.category ? sanitizeString(input.category) : undefined,
        description: input.description ? sanitizeString(input.description) : undefined,
      };
      const [result] = await db.insert(products).values({ tenantId, ...sanitized, status: "active" });
      const productId = Number(result.insertId);

      // Get default warehouse for tenant
      const [defaultWarehouse] = await db.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
        .limit(1);

      if (defaultWarehouse) {
        await db.insert(warehouseStock).values({ tenantId, warehouseId: defaultWarehouse.id, productId, currentStock: "0.00", reserved: "0.00", available: "0.00" });
      }

      cache.invalidatePrefix(`products:${tenantId}`);
      return { id: productId };
    }),

  update: operatorQuery
    .input(z.object({
      id:           z.number(),
      code:         z.string().min(1).optional(),
      name:         z.string().min(1).optional(),
      category:     z.string().optional(),
      costPrice:    z.string().optional(),
      unitPrice:    z.string().optional(),
      unit:         z.enum(["kg", "l", "pcs", "box", "pack", "m"]).optional(),
      unitWeight:   z.string().optional(),
      description:  z.string().optional(),
      photoUrl:     z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").nullable().optional(),
      reorderPoint: z.string().optional(),
      status:       z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const sanitized: Record<string, unknown> = { ...data };
      if (typeof data.name === "string") sanitized.name = sanitizeString(data.name);
      if (typeof data.category === "string") sanitized.category = sanitizeString(data.category);
      if (typeof data.description === "string") sanitized.description = sanitizeString(data.description);
      await getDb().update(products).set(sanitized)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenant.id)));
      cache.invalidatePrefix(`products:${ctx.tenant.id}`);
      cache.invalidatePrefix(`product_cats:${ctx.tenant.id}`);
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

      // Try hard delete — if FK constraints (order_items, stock_movements) block it, fall back to soft delete
      try {
        await db.delete(products).where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)));
      } catch {
        await db.update(products)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)));
      }

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
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
            if ((result as any).affectedRows > 0) {
              deleted++;
            } else {
              softDeleted++;
            }
          } catch {
            // FK constraint (order_items, stock_movements) — fall back to soft delete
            await tx.update(products)
              .set({ status: "inactive", updatedAt: new Date() })
              .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
            softDeleted++;
          }
        }
      });

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      return { deleted, softDeleted, total: input.ids.length };
    }),

  uploadPhoto: operatorQuery
    .input(z.object({
      productId: z.number(),
      dataUrl: z.string().startsWith("data:image/").max(5_000_000, "Файл слишком большой (макс. 4 МБ)"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Upload to S3 first, store only the URL (not base64) in the DB
      const { env } = await import("./lib/env");
      const isS3 = !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);

      let photoUrl = input.dataUrl;
      if (isS3) {
        const match = input.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
          const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
          const buffer = Buffer.from(match[2], "base64");
          const key = `products/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const s3 = new S3Client({
            region: env.s3Region || "us-east-1",
            credentials: { accessKeyId: env.s3AccessKey || "", secretAccessKey: env.s3SecretKey || "" },
          });
          await s3.send(new PutObjectCommand({ Bucket: env.s3Bucket!, Key: key, Body: buffer, ContentType: `image/${ext === "jpg" ? "jpeg" : ext}` }));
          photoUrl = `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
        }
      }

      await getDb().update(products)
        .set({ photoUrl })
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // ── Find by Barcode ─────────────────────────────────────────────────────────
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
});
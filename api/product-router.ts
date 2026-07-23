import { z } from "zod";
import { createRouter, operatorQuery, agentQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, warehouseStock, stockMovements, orderItems, warehouses } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";

async function getDefaultWarehouseId(db: ReturnType<typeof getDb>, tenantId: number): Promise<number | null> {
  const [wh] = await db.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .limit(1);
  return wh?.id ?? null;
}

export const productRouter = createRouter({
  /** All active products for a tenant — no pagination, used by mobile catalog & selectors */
  listAll: agentQuery
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

  list: agentQuery
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

      const cacheKey = CacheKeys.productList(tenantId, page, input?.search, input?.category) + (input?.includeAll ? ":all" : "");
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const conditions = [eq(products.tenantId, tenantId)];
      if (!input?.includeAll) conditions.push(eq(products.status, "active"));
      if (input?.search)   conditions.push(like(products.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.category) conditions.push(eq(products.category, input?.category));
      const where = and(...conditions);

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
          .leftJoin(warehouseStock, and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId)))
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

  getById: agentQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
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

      const [stockResult, movements] = await Promise.all([
        db.select({
          id: warehouseStock.id, currentStock: warehouseStock.currentStock,
          reserved: warehouseStock.reserved, available: warehouseStock.available,
        }).from(warehouseStock)
          .where(and(eq(warehouseStock.productId, product.id), eq(warehouseStock.tenantId, tenantId)))
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

      await db.insert(warehouseStock).values({ tenantId, productId, currentStock: "0.00", reserved: "0.00", available: "0.00" });

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

  // SECURITY FIX 1.4: Block deletion if product has linked order items or warehouse stock
  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const [existingProduct] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId))).limit(1);
      if (!existingProduct) throw new Error("Товар не найден");

      // Soft delete — помечаем inactive вместо удаления (FK на order_items, stock_movements мешает удалению)
      await db.update(products)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)));

      // Полностью удаляем запись стока
      await db.delete(warehouseStock)
        .where(and(eq(warehouseStock.productId, input.id), eq(warehouseStock.tenantId, tenantId)));

      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      return { success: true };
    }),

  uploadPhoto: operatorQuery
    .input(z.object({
      productId: z.number(),
      // ~2MB after base64 encoding (base64 inflates by ~33%, plus the
      // "data:image/jpeg;base64," prefix). The 2MB limit shown to the user
      // in the upload UI (web Products.tsx, mobile forms) is only a
      // client-side hint — without this server-side cap, a direct API call
      // bypassing the UI could store an arbitrarily large string in the DB.
      dataUrl: z.string().startsWith("data:image/").max(2_800_000, "Файл слишком большой (макс. 2 МБ)"),
    }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(products)
        .set({ photoUrl: input.dataUrl })
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // ── Find by Barcode ─────────────────────────────────────────────────────────
  findByBarcode: agentQuery
    .input(z.object({ barcode: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await getDb().select({
        id: products.id, code: products.code, name: products.name,
        unitPrice: products.unitPrice, unit: products.unit, available: warehouseStock.available,
      })
        .from(products)
        .leftJoin(warehouseStock, and(eq(warehouseStock.productId, products.id), eq(warehouseStock.tenantId, ctx.tenant.id)))
        .where(and(eq(products.tenantId, ctx.tenant.id), eq(products.barcode, input.barcode)))
        .limit(1);
      return result[0] ?? null;
    }),

  categories: agentQuery.query(async ({ ctx }) => {
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
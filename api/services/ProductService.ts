import {
  products,
  warehouseStock,
  stockMovements,
  orderItems,
} from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "../lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface ProductListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
}

export interface ProductCreateInput {
  code: string;
  barcode?: string;
  name: string;
  category?: string;
  costPrice?: string;
  unitPrice: string;
  unit?: "kg" | "l" | "pcs" | "box" | "pack" | "m";
  unitWeight?: string;
  description?: string;
  photoUrl?: string;
  reorderPoint?: string;
}

export interface ProductUpdateInput {
  code?: string;
  name?: string;
  category?: string;
  costPrice?: string;
  unitPrice?: string;
  unit?: "kg" | "l" | "pcs" | "box" | "pack" | "m";
  unitWeight?: string;
  description?: string;
  photoUrl?: string | null;
  reorderPoint?: string;
  status?: "active" | "inactive";
}

export const ProductService = {
  async list(db: DrizzleInstance, tenantId: number, filters?: ProductListFilters) {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const cacheKey = CacheKeys.productList(tenantId, page, filters?.search, filters?.category);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const conditions = [eq(products.tenantId, tenantId)];
    if (filters?.search) conditions.push(like(products.name, `%${sanitizeSearch(filters.search)}%`));
    if (filters?.category) conditions.push(eq(products.category, filters.category));
    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      db.select({
        id: products.id,
        code: products.code,
        name: products.name,
        category: products.category,
        costPrice: products.costPrice,
        unitPrice: products.unitPrice,
        unit: products.unit,
        unitWeight: products.unitWeight,
        description: products.description,
        photoUrl: products.photoUrl,
        reorderPoint: products.reorderPoint,
        status: products.status,
        createdAt: products.createdAt,
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
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
  },

  async getById(db: DrizzleInstance, tenantId: number, productId: number) {
    const [product] = await db.select({
      id: products.id,
      code: products.code,
      barcode: products.barcode,
      name: products.name,
      category: products.category,
      costPrice: products.costPrice,
      unitPrice: products.unitPrice,
      unit: products.unit,
      unitWeight: products.unitWeight,
      description: products.description,
      photoUrl: products.photoUrl,
      reorderPoint: products.reorderPoint,
      status: products.status,
      createdAt: products.createdAt,
    })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
      .limit(1);
    if (!product) return null;

    const [stockResult, movements] = await Promise.all([
      db.select({
        id: warehouseStock.id,
        currentStock: warehouseStock.currentStock,
        reserved: warehouseStock.reserved,
        available: warehouseStock.available,
      })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.productId, product.id), eq(warehouseStock.tenantId, tenantId)))
        .limit(1),
      db.select({
        id: stockMovements.id,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        notes: stockMovements.notes,
        createdAt: stockMovements.createdAt,
      })
        .from(stockMovements)
        .where(and(eq(stockMovements.productId, product.id), eq(stockMovements.tenantId, tenantId)))
        .orderBy(desc(stockMovements.createdAt))
        .limit(20),
    ]);

    return { ...product, stock: stockResult ?? null, movements };
  },

  async create(db: DrizzleInstance, tenantId: number, data: ProductCreateInput) {
    const sanitized = {
      ...data,
      name: sanitizeString(data.name),
      category: data.category ? sanitizeString(data.category) : undefined,
      description: data.description ? sanitizeString(data.description) : undefined,
    };
    const [result] = await db.insert(products).values({ tenantId, ...sanitized, status: "active" });
    const productId = Number(result.insertId);

    await db.insert(warehouseStock).values({
      tenantId,
      productId,
      currentStock: "0.00",
      reserved: "0.00",
      available: "0.00",
    });

    cache.invalidatePrefix(`products:${tenantId}`);
    return { id: productId };
  },

  async update(db: DrizzleInstance, tenantId: number, productId: number, data: ProductUpdateInput) {
    const sanitized: Record<string, unknown> = { ...data };
    if (typeof data.name === "string") sanitized.name = sanitizeString(data.name);
    if (typeof data.category === "string") sanitized.category = sanitizeString(data.category);
    if (typeof data.description === "string") sanitized.description = sanitizeString(data.description);

    await db.update(products).set(sanitized)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));

    cache.invalidatePrefix(`products:${tenantId}`);
    cache.invalidatePrefix(`product_cats:${tenantId}`);
    return { success: true };
  },

  async delete(db: DrizzleInstance, tenantId: number, productId: number) {
    const [existingProduct] = await db.select().from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);
    if (!existingProduct) throw new Error("Товар не найден");

    const [orderItemCount] = await db.select({ count: sql<number>`count(*)` })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(and(eq(orderItems.productId, productId), eq(products.tenantId, tenantId)));
    if (Number(orderItemCount.count) > 0) {
      throw new Error(`Невозможно удалить товар: связан с ${orderItemCount.count} позицией(ями) заказов`);
    }

    const [stock] = await db.select().from(warehouseStock)
      .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId))).limit(1);
    if (stock && Number(stock.currentStock) > 0) {
      throw new Error("Невозможно удалить товар: на складе есть остаток");
    }

    await db.transaction(async (tx) => {
      await tx.delete(warehouseStock)
        .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId)));
      await tx.delete(products)
        .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
    });

    cache.invalidatePrefix(`products:${tenantId}`);
    cache.invalidatePrefix(`product_cats:${tenantId}`);
    return { success: true };
  },

  async getCategories(db: DrizzleInstance, tenantId: number) {
    const cacheKey = CacheKeys.productCategories(tenantId);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const results = await db.select({ category: products.category })
      .from(products)
      .where(eq(products.tenantId, tenantId))
      .groupBy(products.category);
    const cats = results.map((r) => r.category).filter(Boolean);

    cache.set(cacheKey, cats, CacheTTL.categories);
    return cats;
  },

  async searchByBarcode(db: DrizzleInstance, tenantId: number, barcode: string) {
    const result = await db.select({
      id: products.id,
      code: products.code,
      name: products.name,
      unitPrice: products.unitPrice,
      unit: products.unit,
      available: warehouseStock.available,
    })
      .from(products)
      .leftJoin(warehouseStock, and(eq(warehouseStock.productId, products.id), eq(warehouseStock.tenantId, tenantId)))
      .where(and(eq(products.tenantId, tenantId), eq(products.barcode, barcode)))
      .limit(1);
    return result[0] ?? null;
  },

  async uploadPhoto(db: DrizzleInstance, tenantId: number, productId: number, dataUrl: string) {
    await db.update(products)
      .set({ photoUrl: dataUrl })
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
    return { success: true };
  },
};

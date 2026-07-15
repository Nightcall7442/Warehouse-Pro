import {
  shops,
  users,
  orders,
  payments,
} from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "../lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface ShopListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  city?: string;
  district?: string;
  agentId?: number;
}

export interface ShopCreateInput {
  name: string;
  ownerName?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  photoUrl?: string;
  gpsLat?: string;
  gpsLng?: string;
  agentId?: number;
  notes?: string;
}

export interface ShopUpdateInput {
  name?: string;
  ownerName?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  photoUrl?: string | null;
  gpsLat?: string;
  gpsLng?: string;
  agentId?: number;
  notes?: string;
  status?: "active" | "inactive";
}

export const ShopService = {
  async list(db: DrizzleInstance, tenantId: number, filters?: ShopListFilters) {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const cacheKey = CacheKeys.shopList(tenantId, page, filters?.search, filters?.city, filters?.district, filters?.agentId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const conditions = [eq(shops.tenantId, tenantId)];
    if (filters?.search) conditions.push(like(shops.name, `%${sanitizeSearch(filters.search)}%`));
    if (filters?.city) conditions.push(eq(shops.city, filters.city));
    if (filters?.district) conditions.push(eq(shops.district, filters.district));
    if (filters?.agentId) conditions.push(eq(shops.agentId, filters.agentId));
    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      db.select({
        id: shops.id,
        name: shops.name,
        ownerName: shops.ownerName,
        phone: shops.phone,
        address: shops.address,
        city: shops.city,
        district: shops.district,
        photoUrl: shops.photoUrl,
        gpsLat: shops.gpsLat,
        gpsLng: shops.gpsLng,
        debt: shops.debt,
        status: shops.status,
        createdAt: shops.createdAt,
        agentName: users.name,
      })
        .from(shops)
        .leftJoin(users, eq(shops.agentId, users.id))
        .where(where)
        .limit(pageSize)
        .offset(offset)
        .orderBy(desc(shops.createdAt)),
      db.select({ count: sql<number>`count(*)` }).from(shops).where(where),
    ]);

    const result = { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    cache.set(cacheKey, result, CacheTTL.shops);
    return result;
  },

  async getById(db: DrizzleInstance, tenantId: number, shopId: number) {
    const [shop] = await db.select({
      id: shops.id,
      name: shops.name,
      ownerName: shops.ownerName,
      phone: shops.phone,
      address: shops.address,
      city: shops.city,
      district: shops.district,
      photoUrl: shops.photoUrl,
      gpsLat: shops.gpsLat,
      gpsLng: shops.gpsLng,
      debt: shops.debt,
      status: shops.status,
      agentId: shops.agentId,
      notes: shops.notes,
      createdAt: shops.createdAt,
    })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
      .limit(1);
    if (!shop) return null;

    const [agentResult, recentOrders, paymentHistory] = await Promise.all([
      db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, shop.agentId ?? 0))
        .limit(1),
      db.select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
      })
        .from(orders)
        .where(and(eq(orders.shopId, shop.id), eq(orders.tenantId, tenantId)))
        .orderBy(desc(orders.createdAt))
        .limit(20),
      db.select({
        id: payments.id,
        amount: payments.amount,
        type: payments.type,
        notes: payments.notes,
        createdAt: payments.createdAt,
      })
        .from(payments)
        .where(and(eq(payments.shopId, shop.id), eq(payments.tenantId, tenantId)))
        .orderBy(desc(payments.createdAt))
        .limit(20),
    ]);

    return { ...shop, agent: agentResult ?? null, recentOrders, paymentHistory };
  },

  async create(db: DrizzleInstance, tenantId: number, data: ShopCreateInput) {
    const sanitized = {
      name: sanitizeString(data.name),
      ownerName: data.ownerName ? sanitizeString(data.ownerName) : undefined,
      phone: data.phone,
      address: data.address ? sanitizeString(data.address) : undefined,
      city: data.city ? sanitizeString(data.city) : undefined,
      district: data.district ? sanitizeString(data.district) : undefined,
      photoUrl: data.photoUrl,
      gpsLat: data.gpsLat,
      gpsLng: data.gpsLng,
      agentId: data.agentId,
      notes: data.notes ? sanitizeString(data.notes) : undefined,
    };
    const [result] = await db.insert(shops).values({
      ...sanitized,
      tenantId,
      debt: "0.00",
      status: "active",
    });

    cache.invalidatePrefix(`shops:${tenantId}`);
    cache.invalidate(CacheKeys.shopCities(tenantId));
    return { id: Number(result.insertId) };
  },

  async update(db: DrizzleInstance, tenantId: number, shopId: number, data: ShopUpdateInput) {
    const sanitized: Record<string, unknown> = {};
    if (data.name !== undefined) sanitized.name = sanitizeString(data.name);
    if (data.ownerName !== undefined) sanitized.ownerName = sanitizeString(data.ownerName);
    if (data.phone !== undefined) sanitized.phone = data.phone;
    if (data.address !== undefined) sanitized.address = sanitizeString(data.address);
    if (data.city !== undefined) sanitized.city = sanitizeString(data.city);
    if (data.district !== undefined) sanitized.district = sanitizeString(data.district);
    if (data.photoUrl !== undefined) sanitized.photoUrl = data.photoUrl;
    if (data.gpsLat !== undefined) sanitized.gpsLat = data.gpsLat;
    if (data.gpsLng !== undefined) sanitized.gpsLng = data.gpsLng;
    if (data.agentId !== undefined) sanitized.agentId = data.agentId;
    if (data.notes !== undefined) sanitized.notes = sanitizeString(data.notes);
    if (data.status !== undefined) sanitized.status = data.status;

    await db.update(shops).set(sanitized)
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));

    cache.invalidatePrefix(`shops:${tenantId}`);
    cache.invalidate(CacheKeys.shopCities(tenantId));
    return { success: true };
  },

  async delete(db: DrizzleInstance, tenantId: number, shopId: number) {
    const [existingShop] = await db.select().from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
    if (!existingShop) throw new Error("Магазин не найден");

    const [orderCount] = await db.select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), eq(orders.tenantId, tenantId)));
    if (Number(orderCount.count) > 0) {
      throw new Error(`Невозможно удалить магазин: связано ${orderCount.count} заказ(ов)`);
    }

    const [paymentCount] = await db.select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(and(eq(payments.shopId, shopId), eq(payments.tenantId, tenantId)));
    if (Number(paymentCount.count) > 0) {
      throw new Error(`Невозможно удалить магазин: связано ${paymentCount.count} платёж(ей)`);
    }

    await db.delete(shops)
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));

    cache.invalidatePrefix(`shops:${tenantId}`);
    cache.invalidate(CacheKeys.shopCities(tenantId));
    return { success: true };
  },

  async getCities(db: DrizzleInstance, tenantId: number) {
    const cacheKey = CacheKeys.shopCities(tenantId);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const results = await db.select({ city: shops.city })
      .from(shops)
      .where(eq(shops.tenantId, tenantId))
      .groupBy(shops.city);
    const cities = results.map((r) => r.city).filter(Boolean);

    cache.set(cacheKey, cities, CacheTTL.categories);
    return cities;
  },

  async getDistricts(db: DrizzleInstance, tenantId: number, city?: string) {
    const cacheKey = CacheKeys.shopDistricts(tenantId, city);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const conditions = [eq(shops.tenantId, tenantId)];
    if (city) conditions.push(eq(shops.city, city));
    const results = await db.select({ district: shops.district })
      .from(shops)
      .where(and(...conditions))
      .groupBy(shops.district);
    const districts = results.map((r) => r.district).filter(Boolean);

    cache.set(cacheKey, districts, CacheTTL.categories);
    return districts;
  },

  async getDebtReport(db: DrizzleInstance, tenantId: number) {
    return db.select({
      shopName: shops.name,
      city: shops.city,
      debt: shops.debt,
      agentName: users.name,
    })
      .from(shops)
      .leftJoin(users, eq(shops.agentId, users.id))
      .where(and(eq(shops.tenantId, tenantId), sql`${shops.debt} > 0`))
      .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL)`));
  },

  async uploadPhoto(db: DrizzleInstance, tenantId: number, shopId: number, dataUrl: string) {
    await db.update(shops)
      .set({ photoUrl: dataUrl })
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
    return { success: true };
  },
};

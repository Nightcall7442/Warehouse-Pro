import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { shops, users, orders, payments, dailyPlans, territories } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { PaymentService } from "./services/payment";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";
import { parseLocationFromUrl } from "./lib/parse-location";

export const shopRouter = createRouter({
  territories: operatorQuery.query(async ({ ctx }) => {
    const rows = await getDb().select({
      id: territories.id,
      name: territories.name,
      color: territories.color,
      shopCount: sql<number>`count(${shops.id})`,
      totalDebt: sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL)), 0)`,
    })
      .from(territories)
      .leftJoin(shops, eq(territories.id, shops.territoryId))
      .where(eq(territories.tenantId, ctx.tenant.id))
      .groupBy(territories.id)
      .orderBy(sql`count(${shops.id}) DESC`);
    return rows;
  }),

  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().min(1).max(500).default(25),
      search:     z.string().optional(),
      city:       z.string().optional(),
      district:   z.string().optional(),
      agentId:    z.number().optional(),
      territoryId: z.number().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const cacheKey = CacheKeys.shopList(tenantId, page, input?.search, input?.city, input?.district, input?.agentId);
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const conditions = [eq(shops.tenantId, tenantId)];
      if (input?.search)   conditions.push(like(shops.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.city)     conditions.push(eq(shops.city, input.city));
      if (input?.district) conditions.push(eq(shops.district, input.district));
      if (input?.agentId)    conditions.push(eq(shops.agentId, input.agentId));
      if (input?.territoryId) conditions.push(eq(shops.territoryId, input.territoryId));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id:        shops.id,
          name:      shops.name,
          ownerName: shops.ownerName,
          phone:     shops.phone,
          address:   shops.address,
          city:      shops.city,
          district:  shops.district,
          photoUrl:  shops.photoUrl,
          gpsLat:    shops.gpsLat,
          gpsLng:    shops.gpsLng,
          debt:      shops.debt,
          status:    shops.status,
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
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [shop]   = await db.select({
        id: shops.id, name: shops.name, ownerName: shops.ownerName, phone: shops.phone,
        address: shops.address, city: shops.city, district: shops.district,
        photoUrl: shops.photoUrl, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
        debt: shops.debt, status: shops.status, agentId: shops.agentId,
        notes: shops.notes, createdAt: shops.createdAt,
      }).from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, tenantId)))
        .limit(1);
      if (!shop) return null;

      const [agentResult, recentOrders, paymentHistory] = await Promise.all([
        db.select({ id: users.id, name: users.name, email: users.email })
          .from(users).where(eq(users.id, shop.agentId ?? 0)).limit(1),
        db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, status: orders.status, createdAt: orders.createdAt })
          .from(orders).where(and(eq(orders.shopId, shop.id), eq(orders.tenantId, tenantId))).orderBy(desc(orders.createdAt)).limit(20),
        db.select({ id: payments.id, amount: payments.amount, type: payments.type, notes: payments.notes, createdAt: payments.createdAt })
          .from(payments)
          .where(and(eq(payments.shopId, shop.id), eq(payments.tenantId, tenantId))).orderBy(desc(payments.createdAt)).limit(20),
      ]);

      return { ...shop, agent: agentResult[0] ?? null, recentOrders, paymentHistory };
    }),

  create: operatorQuery
    .input(z.object({
      name:     z.string().min(1),
      ownerName: z.string().optional(),
      phone:    z.string().optional(),
      address:  z.string().optional(),
      city:     z.string().optional(),
      district: z.string().optional(),
      photoUrl: z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").optional(),
      gpsLat:   z.string().optional(),
      gpsLng:   z.string().optional(),
      telegramLink: z.string().optional(),
      agentId:  z.number().optional(),
      territoryId: z.number().optional(),
      notes:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Parse GPS from Telegram link if provided and no manual GPS
      let gpsLat = input.gpsLat;
      let gpsLng = input.gpsLng;
      if (input.telegramLink && !gpsLat && !gpsLng) {
        const parsed = parseLocationFromUrl(input.telegramLink);
        if (parsed) {
          gpsLat = parsed.lat.toFixed(8);
          gpsLng = parsed.lng.toFixed(8);
        }
      }

      const sanitized = {
        ...input,
        name: sanitizeString(input.name),
        ownerName: input.ownerName ? sanitizeString(input.ownerName) : undefined,
        address: input.address ? sanitizeString(input.address) : undefined,
        city: input.city ? sanitizeString(input.city) : undefined,
        district: input.district ? sanitizeString(input.district) : undefined,
        notes: input.notes ? sanitizeString(input.notes) : undefined,
        gpsLat,
        gpsLng,
      };
      // Remove telegramLink from DB insert (not a DB column)
      const { telegramLink: _, ...dbData } = sanitized;
      const [result] = await db.insert(shops).values({ ...dbData, tenantId: ctx.tenant.id, debt: "0.00", status: "active" });
      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
      cache.invalidate(CacheKeys.shopCities(ctx.tenant.id));
      return { id: Number(result.insertId) };
    }),

  update: operatorQuery
    .input(z.object({
      id:       z.number(),
      name:     z.string().min(1).optional(),
      ownerName: z.string().optional(),
      phone:    z.string().optional(),
      address:  z.string().optional(),
      city:     z.string().optional(),
      district: z.string().optional(),
      photoUrl: z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").nullable().optional(),
      gpsLat:   z.string().optional(),
      gpsLng:   z.string().optional(),
      agentId:  z.number().optional(),
      territoryId: z.number().nullable().optional(),
      notes:    z.string().optional(),
      status:   z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const sanitized: Record<string, unknown> = { ...data };
      if (typeof data.name === "string") sanitized.name = sanitizeString(data.name);
      if (typeof data.ownerName === "string") sanitized.ownerName = sanitizeString(data.ownerName);
      if (typeof data.address === "string") sanitized.address = sanitizeString(data.address);
      if (typeof data.city === "string") sanitized.city = sanitizeString(data.city);
      if (typeof data.district === "string") sanitized.district = sanitizeString(data.district);
      if (typeof data.notes === "string") sanitized.notes = sanitizeString(data.notes);

      // Skip update if no fields to set
      if (Object.keys(sanitized).length === 0) return { success: true };

      await getDb().update(shops).set(sanitized)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id)));
      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
      cache.invalidate(CacheKeys.shopCities(ctx.tenant.id));
      return { success: true };
    }),

  // SECURITY FIX 1.4: Block deletion if shop has linked orders or payments
  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const [existingShop] = await db.select().from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, tenantId))).limit(1);
      if (!existingShop) throw new Error("Магазин не найден");

      const [orderCount] = await db.select({ count: sql<number>`count(*)` })
        .from(orders).where(and(eq(orders.shopId, input.id), eq(orders.tenantId, tenantId)));
      if (Number(orderCount.count) > 0) {
        throw new Error(`Невозможно удалить магазин: связано ${orderCount.count} заказ(ов)`);
      }

      const [paymentCount] = await db.select({ count: sql<number>`count(*)` })
        .from(payments).where(and(eq(payments.shopId, input.id), eq(payments.tenantId, tenantId)));
      if (Number(paymentCount.count) > 0) {
        throw new Error(`Невозможно удалить магазин: связано ${paymentCount.count} платёж(ей)`);
      }

      const [planCount] = await db.select({ count: sql<number>`count(*)` })
        .from(dailyPlans).where(and(eq(dailyPlans.shopId, input.id), eq(dailyPlans.tenantId, tenantId)));
      if (Number(planCount.count) > 0) {
        throw new Error(`Невозможно удалить магазин: связано ${planCount.count} план(ов) посещений`);
      }

      await db.delete(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, tenantId)));
      cache.invalidatePrefix(`shops:${tenantId}`);
      cache.invalidate(CacheKeys.shopCities(tenantId));
      return { success: true };
    }),

  addPayment: operatorQuery
    .input(z.object({
      shopId: z.number(),
      amount: z.string().refine(v => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Неверный формат суммы"),
      type:   z.enum(["payment", "debt"]).default("payment"),
      notes:  z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return PaymentService.addPayment(ctx.db, ctx.tenant.id, {
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  uploadPhoto: operatorQuery
    .input(z.object({
      shopId:  z.number(),
      dataUrl: z.string().refine((val) => val.startsWith("data:image/") || val.startsWith("http://") || val.startsWith("https://"), "Неверный формат изображения (data URL или HTTP/HTTPS URL)").max(5_000_000, "Файл слишком большой (макс. 4 МБ)"),
    }))
    .mutation(async ({ input, ctx }) => {
      const { env } = await import("./lib/env");
      const isS3 = !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);
      let photoUrl = input.dataUrl;
      if (isS3) {
        const match = input.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
          const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
          const buffer = Buffer.from(match[2], "base64");
          const key = `shops/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const s3 = new S3Client({
            region: env.s3Region || "us-east-1",
            credentials: { accessKeyId: env.s3AccessKey || "", secretAccessKey: env.s3SecretKey || "" },
          });
          await s3.send(new PutObjectCommand({ Bucket: env.s3Bucket!, Key: key, Body: buffer, ContentType: `image/${ext === "jpg" ? "jpeg" : ext}` }));
          photoUrl = `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
        }
      }
      await getDb().update(shops)
        .set({ photoUrl })
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  cities: operatorQuery.query(async ({ ctx }) => {
    const tenantId = ctx.tenant.id;
    const cacheKey = CacheKeys.shopCities(tenantId);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const results = await getDb().select({ city: shops.city })
      .from(shops).where(eq(shops.tenantId, tenantId)).groupBy(shops.city);
    const cities = results.map(r => r.city).filter(Boolean);
    cache.set(cacheKey, cities, CacheTTL.categories);
    return cities;
  }),

  districts: operatorQuery
    .input(z.object({ city: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const cacheKey = CacheKeys.shopDistricts(tenantId, input?.city);
      const cached = cache.get<string[]>(cacheKey);
      if (cached) return cached;

      const conditions = [eq(shops.tenantId, tenantId)];
      if (input?.city) conditions.push(eq(shops.city, input.city));
      const results = await getDb().select({ district: shops.district })
        .from(shops).where(and(...conditions)).groupBy(shops.district);
      const districts = results.map(r => r.district).filter(Boolean);
      cache.set(cacheKey, districts, CacheTTL.categories);
      return districts;
    }),

  // ── Debt Report ─────────────────────────────────────────────────────────────
  debtReport: operatorQuery.query(async ({ ctx }) => {
    return getDb().select({
      shopName: shops.name,
      city: shops.city,
      debt: shops.debt,
      agentName: users.name,
    })
      .from(shops).leftJoin(users, eq(shops.agentId, users.id))
      .where(and(eq(shops.tenantId, ctx.tenant.id), sql`${shops.debt} != 0`))
      .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL)`));
  }),

  /** Delete ALL shops for this tenant */
  clearAll: operatorQuery
    .mutation(async ({ ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      await db.transaction(async (tx) => {
        // Delete child records first (FK-safe order)
        await tx.execute(sql`DELETE FROM visit_reports WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = ${tenantId})`);
        await tx.execute(sql`DELETE FROM daily_plans WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = ${tenantId})`);
        await tx.execute(sql`DELETE FROM payments WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = ${tenantId})`);
        await tx.execute(sql`DELETE FROM returns WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = ${tenantId})`);
        await tx.execute(sql`DELETE FROM agent_territories WHERE tenant_id = ${tenantId}`);
        await tx.execute(sql`DELETE FROM shops WHERE tenant_id = ${tenantId}`);
      });

      cache.invalidatePrefix(`shops:${tenantId}`);
      cache.invalidate(CacheKeys.shopCities(tenantId));
      cache.invalidate(CacheKeys.shopDistricts(tenantId));
      return { success: true };
    }),
});

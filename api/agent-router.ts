import { z } from "zod";
import { createRouter, agentQuery, supervisorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentLocations, dailyPlans, shops, users } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "./lib/sse";

export const agentRouter = createRouter({
  // Supervisor needs a lightweight agent picker for "assign plan to agent" —
  // full CRUD access to users (user.list) is ceo-only, and giving supervisor
  // that would be over-broad just to populate a dropdown.
  listAgents: supervisorQuery.query(async ({ ctx }) => {
    return getDb().select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "agent"), eq(users.status, "active")))
      .limit(500);
  }),

  // Same reasoning as listAgents — supervisor only needs name+city for the
  // shop picker, not the full shop.list (operator-only) response.
  listShopsForPlan: supervisorQuery.query(async ({ ctx }) => {
    return getDb().select({ id: shops.id, name: shops.name, city: shops.city })
      .from(shops)
      .where(and(eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active")))
      .limit(500);
  }),

  // Supervisor: full shop list for the Shops tab (same fields as agent.myShops)
  listAllShops: supervisorQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: shops.id, name: shops.name, ownerName: shops.ownerName,
      phone: shops.phone, address: shops.address, city: shops.city,
      district: shops.district, photoUrl: shops.photoUrl, status: shops.status,
      debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
    })
      .from(shops)
      .where(and(eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active")))
      .limit(500);
  }),

  saveLocation: agentQuery
    .input(z.object({ lat: z.string(), lng: z.string(), accuracy: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().insert(agentLocations).values({
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,
        lat:      input.lat,
        lng:      input.lng,
        accuracy: input.accuracy,
      });

      sseBus.emit({
        type: "agent.location_updated",
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        data: { agentId: ctx.user.id, lat: input.lat, lng: input.lng, accuracy: input.accuracy },
      });

      return { success: true };
    }),

  getLocations: supervisorQuery.query(async ({ ctx }) => {
    // Optimized: get latest location per agent using subquery
    const db = getDb();
    const latestPerAgent = db.select({
      agentId: agentLocations.agentId,
      maxId: sql<number>`max(${agentLocations.id})`,
    })
      .from(agentLocations)
      .where(eq(agentLocations.tenantId, ctx.tenant.id))
      .groupBy(agentLocations.agentId);

    const results = await db.select({
      id: agentLocations.id, agentId: agentLocations.agentId,
      lat: agentLocations.lat, lng: agentLocations.lng,
      accuracy: agentLocations.accuracy, createdAt: agentLocations.createdAt,
      agentName: users.name,
    })
      .from(agentLocations)
      .leftJoin(users, eq(agentLocations.agentId, users.id))
      .where(sql`${agentLocations.id} IN (SELECT maxId FROM (${latestPerAgent}))`)
      .orderBy(desc(agentLocations.createdAt));

    return results;
  }),

  // ── GPS Trail History ───────────────────────────────────────────────────────
  getTrail: supervisorQuery
    .input(z.object({ agentId: z.number(), date: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      if (!input?.agentId) return [];
      const dateStr = input.date ?? new Date().toISOString().split("T")[0];
      const start = `${dateStr}T00:00:00`;
      const end = `${dateStr}T23:59:59`;

      return getDb().select({
        id: agentLocations.id,
        lat: agentLocations.lat,
        lng: agentLocations.lng,
        accuracy: agentLocations.accuracy,
        createdAt: agentLocations.createdAt,
      })
        .from(agentLocations)
        .where(and(
          eq(agentLocations.tenantId, ctx.tenant.id),
          eq(agentLocations.agentId, input.agentId),
          sql`${agentLocations.createdAt} >= ${start}`,
          sql`${agentLocations.createdAt} <= ${end}`,
        ))
        .orderBy(agentLocations.createdAt);
    }),

  getPlans: authedQuery
    .input(z.object({ agentId: z.number().optional(), date: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const dateStr = input?.date ?? new Date().toISOString().split("T")[0];
      const isPrivileged = ["ceo", "supervisor", "superadmin"].includes(ctx.user.role);
      // For privileged roles: show all plans if no agentId filter; for agents/merchandisers: own plans only
      const agentId = input?.agentId ?? (isPrivileged ? undefined : ctx.user.id);

      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        sql`DATE(${dailyPlans.planDate}) = ${dateStr}`,
      ];
      if (agentId !== undefined) {
        conditions.push(eq(dailyPlans.agentId, agentId));
      }

      return getDb().select({
        id: dailyPlans.id, planDate: dailyPlans.planDate, status: dailyPlans.status,
        notes: dailyPlans.notes, createdAt: dailyPlans.createdAt,
        shopName: shops.name, shopAddress: shops.address, shopDebt: shops.debt,
        shopCity: shops.city, agentName: users.name, shopId: dailyPlans.shopId,
      })
        .from(dailyPlans)
        .leftJoin(shops, eq(dailyPlans.shopId, shops.id))
        .leftJoin(users, eq(dailyPlans.agentId, users.id))
        .where(and(...conditions))
        .limit(100);
    }),

  updatePlanStatus: supervisorQuery
    .input(z.object({ planId: z.number(), status: z.enum(["planned", "visited", "skipped"]) }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(dailyPlans).set({ status: input.status })
        .where(and(eq(dailyPlans.id, input.planId), eq(dailyPlans.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // ── Visit Photo Proof ───────────────────────────────────────────────────────
  saveVisitPhoto: supervisorQuery
    .input(z.object({ planId: z.number(), photoUrl: z.string().max(5_000_000), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(dailyPlans).set({
        status: "visited",
        notes: input.notes ?? undefined,
      }).where(and(eq(dailyPlans.id, input.planId), eq(dailyPlans.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  createPlan: supervisorQuery
    .input(z.object({ agentId: z.number(), shopId: z.number(), planDate: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await getDb().insert(dailyPlans).values({
        tenantId:  ctx.tenant.id,
        agentId:   input.agentId,
        shopId:    input.shopId,
        planDate:  new Date(input.planDate),
        notes:     input.notes,
        createdBy: ctx.user.id,
      });
      return { id: Number(result.insertId) };
    }),

  myShops: agentQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: shops.id, name: shops.name, ownerName: shops.ownerName,
      phone: shops.phone, address: shops.address, city: shops.city,
      district: shops.district, photoUrl: shops.photoUrl, status: shops.status,
      debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
    })
      .from(shops)
      .where(and(eq(shops.agentId, ctx.user.id), eq(shops.tenantId, ctx.tenant.id)))
      .limit(200);
  }),

  // Агент может добавить новый магазин — автоматически привязывается к нему
  createShop: agentQuery
    .input(z.object({
      name:      z.string().min(1),
      ownerName: z.string().optional(),
      phone:     z.string().optional(),
      address:   z.string().optional(),
      city:      z.string().optional(),
      district:  z.string().optional(),
      photoUrl:  z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").optional(),
      gpsLat:    z.string().optional(),
      gpsLng:    z.string().optional(),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(shops).values({
        ...input,
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,   // автоматически привязываем к агенту
        debt:     "0.00",
        status:   "active",
      });
      return { id: Number(result.insertId) };
    }),

  nearbyShops: agentQuery
    .input(z.object({ lat: z.number(), lng: z.number(), radius: z.number().default(5) }))
    .query(async ({ input, ctx }) => {
      const agentShops = await getDb().select().from(shops)
        .where(and(eq(shops.agentId, ctx.user.id), eq(shops.tenantId, ctx.tenant.id)));
      return agentShops.filter((shop) => {
        if (!shop.gpsLat || !shop.gpsLng) return false;
        const dist = haversineKm(input.lat, input.lng, Number(shop.gpsLat), Number(shop.gpsLng));
        return dist <= input.radius;
      });
    }),

  // Мобильное приложение: агент смотрит детальные данные ТОЛЬКО своего магазина
  getShopById: agentQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [shop] = await db.select().from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)))
        .limit(1);
      if (!shop) return null;
      return shop;
    }),

  // Супервайзер: просмотр любого магазина в тенанте
  getShopByIdSupervisor: supervisorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [shop] = await db.select().from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!shop) return null;
      return shop;
    }),

  // Мобильное приложение: агент редактирует ТОЛЬКО свой магазин
  updateMyShop: agentQuery
    .input(z.object({
      id:        z.number(),
      name:      z.string().min(1).optional(),
      ownerName: z.string().optional(),
      phone:     z.string().optional(),
      address:   z.string().optional(),
      city:      z.string().optional(),
      district:  z.string().optional(),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      await getDb().update(shops).set(rest)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      return { success: true };
    }),

  // Мобильное приложение: агент загружает фото ТОЛЬКО своего магазина
  uploadMyShopPhoto: agentQuery
    .input(z.object({ shopId: z.number(), dataUrl: z.string().startsWith("data:image/").max(2_800_000, "Файл слишком большой (макс. 2 МБ)") }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(shops).set({ photoUrl: input.dataUrl })
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      return { success: true };
    }),
});

// ── Haversine distance in km ─────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Supervisor: list all agent plans (not just own)

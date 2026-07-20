import { z } from "zod";
import { createRouter, fieldSalesQuery, merchVisitQuery, supervisorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentLocations, dailyPlans, shops, users } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "./lib/sse";
import { sanitizeString } from "./lib/sanitize";

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

  // Agent: list all shops in tenant (for order creation, shop picker)
  myShops: fieldSalesQuery.query(async ({ ctx }) => {
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

  saveLocation: fieldSalesQuery
    .input(z.object({ lat: z.string(), lng: z.string(), accuracy: z.string().optional(), batteryLevel: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().insert(agentLocations).values({
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,
        lat:      input.lat,
        lng:      input.lng,
        accuracy: input.accuracy,
        batteryLevel: input.batteryLevel,
      });

      sseBus.emit({
        type: "agent.location_updated",
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        data: { agentId: ctx.user.id, lat: input.lat, lng: input.lng, accuracy: input.accuracy, batteryLevel: input.batteryLevel },
      });

      return { success: true };
    }),

  getLocations: supervisorQuery.query(async ({ ctx }) => {
    // Get latest location per agent using a simpler approach
    const db = getDb();
    
    // First get the max IDs per agent
    const maxIds = await db.select({
      agentId: agentLocations.agentId,
      maxId: sql<number>`max(${agentLocations.id})`,
    })
      .from(agentLocations)
      .where(eq(agentLocations.tenantId, ctx.tenant.id))
      .groupBy(agentLocations.agentId);

    if (maxIds.length === 0) return [];

    const ids = maxIds.map(m => m.maxId);

    // Then get the full records for those IDs
    const results = await db.select({
      id: agentLocations.id, agentId: agentLocations.agentId,
      lat: agentLocations.lat, lng: agentLocations.lng,
      accuracy: agentLocations.accuracy, batteryLevel: agentLocations.batteryLevel,
      createdAt: agentLocations.createdAt,
      agentName: users.name,
    })
      .from(agentLocations)
      .leftJoin(users, eq(agentLocations.agentId, users.id))
      .where(sql`${agentLocations.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)
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
        photoUrl: dailyPlans.photoUrl, notes: dailyPlans.notes, createdAt: dailyPlans.createdAt,
        shopName: shops.name, shopAddress: shops.address, shopDebt: shops.debt,
        shopCity: shops.city, agentName: users.name, shopId: dailyPlans.shopId,
      })
        .from(dailyPlans)
        .leftJoin(shops, eq(dailyPlans.shopId, shops.id))
        .leftJoin(users, eq(dailyPlans.agentId, users.id))
        .where(and(...conditions))
        .limit(100);
    }),

  // Optimized route — sort plans by distance from current location
  getOptimizedRoute: fieldSalesQuery
    .input(z.object({
      date: z.string().optional(),
      agentId: z.number().optional(),
      currentLat: z.number(),
      currentLng: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const dateStr = input.date ?? new Date().toISOString().split("T")[0];
      const isPrivileged = ["ceo", "supervisor", "superadmin"].includes(ctx.user.role);
      const agentId = input.agentId ?? (isPrivileged ? undefined : ctx.user.id);

      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        sql`DATE(${dailyPlans.planDate}) = ${dateStr}`,
        eq(dailyPlans.status, "planned"), // Only unvisited plans
      ];
      if (agentId !== undefined) {
        conditions.push(eq(dailyPlans.agentId, agentId));
      }

      const plans = await db.select({
        id: dailyPlans.id,
        planDate: dailyPlans.planDate,
        status: dailyPlans.status,
        shopId: dailyPlans.shopId,
        shopName: shops.name,
        shopAddress: shops.address,
        shopCity: shops.city,
        shopDebt: shops.debt,
        lat: shops.gpsLat,
        lng: shops.gpsLng,
      })
        .from(dailyPlans)
        .leftJoin(shops, eq(dailyPlans.shopId, shops.id))
        .where(and(...conditions))
        .limit(50);

      // Calculate distance from current location and sort
      const R = 6371; // Earth's radius in km
      const withDistance = plans.map(p => {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!lat || !lng) return { ...p, distance: 9999 };

        const dLat = (lat - input.currentLat) * Math.PI / 180;
        const dLng = (lng - input.currentLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(input.currentLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        return { ...p, distance: Math.round(distance * 10) / 10 };
      });

      // Sort by distance (nearest first) — nearest neighbor heuristic
      const sorted: typeof withDistance = [];
      const remaining = [...withDistance];
      let currentLat = input.currentLat;
      let currentLng = input.currentLng;

      while (remaining.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;

        for (let i = 0; i < remaining.length; i++) {
          const lat = Number(remaining[i].lat);
          const lng = Number(remaining[i].lng);
          if (!lat || !lng) continue;

          const dLat = (lat - currentLat) * Math.PI / 180;
          const dLng = (lng - currentLng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(currentLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const dist = R * c;

          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        }

        const nearest = remaining.splice(nearestIdx, 1)[0];
        sorted.push(nearest);
        currentLat = Number(nearest.lat) || currentLat;
        currentLng = Number(nearest.lng) || currentLng;
      }

      // Calculate total distance
      let totalDistance = 0;
      for (let i = 1; i < sorted.length; i++) {
        totalDistance += sorted[i].distance;
      }

      return {
        plans: sorted,
        totalDistance: Math.round(totalDistance * 10) / 10,
        totalStops: sorted.length,
      };
    }),

  updatePlanStatus: merchVisitQuery
    .input(z.object({ planId: z.number(), status: z.enum(["planned", "visited", "skipped"]) }))
    .mutation(async ({ input, ctx }) => {
      const isPrivileged = ["ceo", "supervisor", "superadmin"].includes(ctx.user.role);
      const conditions = [
        eq(dailyPlans.id, input.planId),
        eq(dailyPlans.tenantId, ctx.tenant.id),
      ];
      // Non-privileged users can only update their own plans
      if (!isPrivileged) {
        conditions.push(eq(dailyPlans.agentId, ctx.user.id));
      }
      await getDb().update(dailyPlans).set({ status: input.status })
        .where(and(...conditions));
      return { success: true };
    }),

  // ── Visit Photo Proof ───────────────────────────────────────────────────────
  saveVisitPhoto: merchVisitQuery
    .input(z.object({ planId: z.number(), photoUrl: z.string().startsWith("data:image/").max(5_000_000, "Файл слишком большой (макс. 5 МБ)"), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(dailyPlans).set({
        status: "visited",
        photoUrl: input.photoUrl,
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

  // Агент может добавить новый магазин — автоматически привязывается к нему
  createShop: fieldSalesQuery
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
        name:      sanitizeString(input.name),
        ownerName: input.ownerName ? sanitizeString(input.ownerName) : undefined,
        phone:     input.phone,
        address:   input.address ? sanitizeString(input.address) : undefined,
        city:      input.city ? sanitizeString(input.city) : undefined,
        district:  input.district ? sanitizeString(input.district) : undefined,
        photoUrl:  input.photoUrl,
        gpsLat:    input.gpsLat,
        gpsLng:    input.gpsLng,
        notes:     input.notes ? sanitizeString(input.notes) : undefined,
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,   // автоматически привязываем к агенту
        debt:     "0.00",
        status:   "active",
      });
      return { id: Number(result.insertId) };
    }),

  nearbyShops: fieldSalesQuery
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
  getShopById: fieldSalesQuery
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
  updateMyShop: fieldSalesQuery
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
      const sanitized: Record<string, unknown> = { ...rest };
      if (typeof rest.name === "string") sanitized.name = sanitizeString(rest.name);
      if (typeof rest.ownerName === "string") sanitized.ownerName = sanitizeString(rest.ownerName);
      if (typeof rest.address === "string") sanitized.address = sanitizeString(rest.address);
      if (typeof rest.city === "string") sanitized.city = sanitizeString(rest.city);
      if (typeof rest.district === "string") sanitized.district = sanitizeString(rest.district);
      if (typeof rest.notes === "string") sanitized.notes = sanitizeString(rest.notes);
      await getDb().update(shops).set(sanitized)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      return { success: true };
    }),

  // Мобильное приложение: агент загружает фото ТОЛЬКО своего магазина
  uploadMyShopPhoto: fieldSalesQuery
    .input(z.object({ shopId: z.number(), dataUrl: z.string().startsWith("data:image/").max(2_800_000, "Файл слишком большой (макс. 2 МБ)") }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(shops).set({ photoUrl: input.dataUrl })
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      return { success: true };
    }),

  // ── Gamification: Leaderboard + Streaks + Achievements ─────────────────────
  gamification: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.tenant.id;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Import here to avoid circular dependency
    const { orders, dailyPlans } = await import("@db/schema");

    // Weekly leaderboard: agents ranked by order count
    const weeklyLeaderboard = await db.select({
      agentId: users.id,
      agentName: users.name,
      orderCount: sql<number>`count(DISTINCT ${orders.id})`,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      visitCount: sql<number>`count(DISTINCT ${dailyPlans.id})`,
    })
      .from(users)
      .leftJoin(orders, and(eq(orders.agentId, users.id), sql`${orders.createdAt} >= ${weekAgo}`, eq(orders.status, "completed")))
      .leftJoin(dailyPlans, and(eq(dailyPlans.agentId, users.id), sql`${dailyPlans.planDate} >= ${weekAgo}`, eq(dailyPlans.status, "visited")))
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active")))
      .groupBy(users.id)
      .orderBy(desc(sql`count(DISTINCT ${orders.id})`))
      .limit(10);

    // Current user's stats
    const [myStats] = await db.select({
      weeklyOrders: sql<number>`count(DISTINCT ${orders.id})`,
      weeklyRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      monthlyOrders: sql<number>`(SELECT count(*) FROM ${orders} WHERE agent_id = ${ctx.user.id} AND created_at >= ${monthAgo} AND status = 'completed')`,
    })
      .from(orders)
      .where(and(eq(orders.agentId, ctx.user.id), sql`${orders.createdAt} >= ${weekAgo}`, eq(orders.status, "completed")));

    // Calculate streak: consecutive days with at least 1 completed order
    const streakData = await db.select({
      day: sql<string>`DATE(${orders.createdAt})`,
      count: sql<number>`count(*)`,
    })
      .from(orders)
      .where(and(
        eq(orders.agentId, ctx.user.id),
        eq(orders.status, "completed"),
        sql`${orders.createdAt} >= ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()}`,
      ))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(desc(sql`DATE(${orders.createdAt})`));

    let streak = 0;
    for (let i = 0; i < streakData.length; i++) {
      const expectedDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      if (streakData[i]?.day === expectedDate && Number(streakData[i]?.count) > 0) {
        streak++;
      } else {
        break;
      }
    }

    // Achievements
    const achievements = [];
    const totalAllTime = await db.select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.agentId, ctx.user.id), eq(orders.status, "completed")));

    const total = Number(totalAllTime[0]?.count ?? 0);
    if (total >= 1) achievements.push({ id: "first_order", title: "Первый заказ", titleUz: "Birinchi buyurtma", icon: "🎯", unlocked: true });
    if (total >= 10) achievements.push({ id: "orders_10", title: "10 заказов", titleUz: "10 buyurtma", icon: "🔥", unlocked: true });
    if (total >= 50) achievements.push({ id: "orders_50", title: "50 заказов", titleUz: "50 buyurtma", icon: "⚡", unlocked: true });
    if (total >= 100) achievements.push({ id: "orders_100", title: "100 заказов", titleUz: "100 buyurtma", icon: "💎", unlocked: true });
    if (streak >= 3) achievements.push({ id: "streak_3", title: "3 дня подряд", titleUz: "3 kun ketma-ket", icon: "🔥", unlocked: true });
    if (streak >= 7) achievements.push({ id: "streak_7", title: "Неделя без перерыва", titleUz: "Hafta dam olishsiz", icon: "🏆", unlocked: true });

    // Monthly top agent
    const [topAgent] = await db.select({
      agentId: users.id,
      agentName: users.name,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
    })
      .from(users)
      .leftJoin(orders, and(eq(orders.agentId, users.id), sql`${orders.createdAt} >= ${monthAgo}`, eq(orders.status, "completed")))
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent")))
      .groupBy(users.id)
      .orderBy(desc(sql`SUM(${orders.total})`))
      .limit(1);

    return {
      leaderboard: weeklyLeaderboard.map((r, i) => ({
        rank: i + 1,
        agentId: r.agentId,
        agentName: r.agentName,
        orderCount: Number(r.orderCount),
        revenue: Number(r.revenue),
        visitCount: Number(r.visitCount),
      })),
      myStats: {
        weeklyOrders: Number(myStats?.weeklyOrders ?? 0),
        weeklyRevenue: Number(myStats?.weeklyRevenue ?? 0),
        monthlyOrders: Number(myStats?.monthlyOrders ?? 0),
        streak,
      },
      achievements,
      topAgent: topAgent ? {
        name: topAgent.agentName,
        revenue: Number(topAgent.revenue),
      } : null,
    };
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

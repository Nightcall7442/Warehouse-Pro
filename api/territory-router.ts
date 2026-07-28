import { z } from "zod";
import { createRouter, authedQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { territories, shops } from "@db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { haversineKm } from "./lib/geo";

export const territoryRouter = createRouter({
  /** List all territories for current tenant */
  list: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb().select({
      id: territories.id,
      name: territories.name,
      color: territories.color,
      centerLat: territories.centerLat,
      centerLng: territories.centerLng,
      radiusKm: territories.radiusKm,
      shopCount: sql<number>`count(${shops.id})`,
      totalDebt: sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL)), 0)`,
    })
      .from(territories)
      .leftJoin(shops, eq(territories.id, shops.territoryId))
      .where(eq(territories.tenantId, ctx.tenant.id))
      .groupBy(territories.id)
      .orderBy(territories.name);
    return rows;
  }),

  /** Create territory */
  create: supervisorQuery
    .input(z.object({
      name: z.string().min(1).max(255),
      color: z.string().max(7).optional(),
      centerLat: z.number().min(-90).max(90).optional(),
      centerLng: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(0.1).max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await getDb().insert(territories).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        color: input.color,
        centerLat: input.centerLat?.toFixed(8) ?? null,
        centerLng: input.centerLng?.toFixed(8) ?? null,
        radiusKm: input.radiusKm?.toFixed(2) ?? "10.00",
      });
      return { id: Number(result.insertId) };
    }),

  /** Update territory */
  update: supervisorQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      color: z.string().max(7).optional(),
      centerLat: z.number().min(-90).max(90).optional(),
      centerLng: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(0.1).max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      const data: Record<string, unknown> = {};
      if (rest.name !== undefined) data.name = rest.name;
      if (rest.color !== undefined) data.color = rest.color;
      if (rest.centerLat !== undefined) data.centerLat = rest.centerLat.toFixed(8);
      if (rest.centerLng !== undefined) data.centerLng = rest.centerLng.toFixed(8);
      if (rest.radiusKm !== undefined) data.radiusKm = rest.radiusKm.toFixed(2);
      await getDb().update(territories).set(data)
        .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Delete territory (shops lose their territoryId) */
  delete: supervisorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(shops).set({ territoryId: null })
        .where(and(eq(shops.territoryId, input.id), eq(shops.tenantId, ctx.tenant.id)));
      await getDb().delete(territories)
        .where(and(eq(territories.id, input.id), eq(territories.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Get shops in a territory */
  getShops: authedQuery
    .input(z.object({ territoryId: z.number() }))
    .query(async ({ input, ctx }) => {
      return getDb().select({
        id: shops.id, name: shops.name, city: shops.city, address: shops.address,
      })
        .from(shops)
        .where(and(eq(shops.territoryId, input.territoryId), eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active")))
        .orderBy(shops.name);
    }),

  /** Auto-assign shops without territory to nearest territory center */
  autoAssign: supervisorQuery
    .mutation(async ({ ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Get all territories with geo data
      const terrs = await db.select({
        id: territories.id,
        centerLat: territories.centerLat,
        centerLng: territories.centerLng,
        radiusKm: territories.radiusKm,
      })
        .from(territories)
        .where(and(eq(territories.tenantId, tenantId), sql`${territories.centerLat} IS NOT NULL`));

      if (terrs.length === 0) return { assigned: 0, total: 0, message: "Нет территорий с GPS-координатами" };

      // Get shops without territory that have GPS coords
      const unassigned = await db.select({
        id: shops.id,
        gpsLat: shops.gpsLat,
        gpsLng: shops.gpsLng,
      })
        .from(shops)
        .where(and(
          eq(shops.tenantId, tenantId),
          isNull(shops.territoryId),
          eq(shops.status, "active"),
          sql`${shops.gpsLat} IS NOT NULL AND ${shops.gpsLng} IS NOT NULL`,
        ));

      let assigned = 0;
      for (const shop of unassigned) {
        const shopLat = Number(shop.gpsLat);
        const shopLng = Number(shop.gpsLng);

        for (const terr of terrs) {
          const dist = haversineKm(shopLat, shopLng, Number(terr.centerLat), Number(terr.centerLng));
          if (dist <= Number(terr.radiusKm)) {
            await db.update(shops).set({ territoryId: terr.id }).where(eq(shops.id, shop.id));
            assigned++;
            break;
          }
        }
      }

      return { assigned, total: unassigned.length };
    }),
});

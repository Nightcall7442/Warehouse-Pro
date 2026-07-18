import { z } from "zod";
import { createRouter, operatorQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { territories, shops } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";

export const territoryRouter = createRouter({
  /** List all territories for current tenant */
  list: operatorQuery.query(async ({ ctx }) => {
    const rows = await getDb().select({
      id: territories.id,
      name: territories.name,
      color: territories.color,
      shopCount: sql<number>`count(${shops.id})`,
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
    }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await getDb().insert(territories).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        color: input.color,
      });
      return { id: Number(result.insertId) };
    }),

  /** Update territory */
  update: supervisorQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      color: z.string().max(7).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await getDb().update(territories).set(data)
        .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Delete territory (shops lose their territoryId) */
  delete: supervisorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(shops).set({ territoryId: null })
        .where(eq(shops.territoryId, input.id));
      await getDb().delete(territories)
        .where(and(eq(territories.id, input.id), eq(territories.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Get shops in a territory */
  getShops: operatorQuery
    .input(z.object({ territoryId: z.number() }))
    .query(async ({ input, ctx }) => {
      return getDb().select({
        id: shops.id, name: shops.name, city: shops.city, address: shops.address,
      })
        .from(shops)
        .where(and(eq(shops.territoryId, input.territoryId), eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active")))
        .orderBy(shops.name);
    }),
});

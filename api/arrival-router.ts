import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { arrivals, arrivalItems, products } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "./lib/sanitize";

export const arrivalRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      status:   z.enum(["pending", "unloading", "completed"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(arrivals.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(arrivals.status, input.status));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
          driverName: arrivals.driverName, status: arrivals.status,
          totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
          arrivalTime: arrivals.arrivalTime, createdAt: arrivals.createdAt,
        }).from(arrivals).where(where).limit(pageSize).offset(offset).orderBy(desc(arrivals.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(arrivals).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [arrival] = await db.select({
        id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
        driverName: arrivals.driverName, driverPhone: arrivals.driverPhone, status: arrivals.status,
        fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
        totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
        arrivalTime: arrivals.arrivalTime, unloadingTime: arrivals.unloadingTime,
        notes: arrivals.notes, createdAt: arrivals.createdAt,
      }).from(arrivals)
        .where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId))).limit(1);
      if (!arrival) return null;

      const items = await db.select({
        id: arrivalItems.id, quantity: arrivalItems.quantity,
        condition: arrivalItems.condition, notes: arrivalItems.notes,
        productId: arrivalItems.productId,
        productName: products.name, productCode: products.code,
      })
        .from(arrivalItems)
        .leftJoin(products, eq(arrivalItems.productId, products.id))
        .where(eq(arrivalItems.arrivalId, arrival.id));

      return { ...arrival, items };
    }),

  create: operatorQuery
    .input(z.object({
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      arrivalDate: z.string(),
      fuelCost:    z.string().default("0.00"),
      tollCost:    z.string().default("0.00"),
      otherCost:   z.string().default("0.00"),
      notes:       z.string().optional(),
      items:       z.array(z.object({ productId: z.number(), quantity: z.string(), condition: z.string().optional() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db           = getDb();
      const tenantId     = ctx.tenant.id;
      // SECURITY FIX 1.1: Use random arrival number instead of predictable timestamp
      // EXPANDED: 12 hex chars = 48 bits entropy, safe for billions of arrivals
      const raw = crypto.randomUUID().replace(/-/g, "");
      const arrivalNumber = `ARR-${raw.slice(0, 12).toUpperCase()}`;
      const totalExpense  = (Number(input.fuelCost) + Number(input.tollCost) + Number(input.otherCost)).toFixed(2);

      const [result] = await db.insert(arrivals).values({
        tenantId, arrivalNumber,
        truckId:     input.truckId ? sanitizeString(input.truckId) : undefined,
        driverName:  input.driverName ? sanitizeString(input.driverName) : undefined,
        driverPhone: input.driverPhone,
        arrivalDate: new Date(input.arrivalDate),
        fuelCost:    input.fuelCost,
        tollCost:    input.tollCost,
        otherCost:   input.otherCost,
        totalExpense,
        notes:       input.notes ? sanitizeString(input.notes) : undefined,
        status:      "pending",
      });

      const arrivalId = Number(result.insertId);

      if (input.items && input.items.length > 0) {
        await db.insert(arrivalItems).values(input.items.map(item => ({
          arrivalId,
          productId: item.productId,
          quantity: item.quantity,
          condition: item.condition ? sanitizeString(item.condition) : undefined,
        })));
      }

      return { id: arrivalId, arrivalNumber };
    }),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      status:      z.enum(["pending", "unloading", "completed"]).optional(),
      fuelCost:    z.string().optional(),
      tollCost:    z.string().optional(),
      otherCost:   z.string().optional(),
      notes:       z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const { id, ...data } = input;

      if (data.fuelCost || data.tollCost || data.otherCost) {
        const [existing] = await db.select().from(arrivals)
          .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
        if (existing) {
          const fuel  = Number(data.fuelCost  ?? existing.fuelCost);
          const toll  = Number(data.tollCost  ?? existing.tollCost);
          const other = Number(data.otherCost ?? existing.otherCost);
          await db.update(arrivals).set({ ...data, totalExpense: (fuel + toll + other).toFixed(2) })
            .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
          return { success: true };
        }
      }

      await db.update(arrivals).set(data).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
      return { success: true };
    }),
});

import { z } from "zod";
import { createRouter, operatorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { priceLists, priceListItems, priceListAssignments, products, shops } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const priceListRouter = createRouter({
  // List price lists
  list: operatorQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({
      id: priceLists.id,
      name: priceLists.name,
      description: priceLists.description,
      type: priceLists.type,
      isActive: priceLists.isActive,
      priority: priceLists.priority,
      itemCount: sql<number>`(SELECT COUNT(*) FROM ${priceListItems} WHERE ${priceListItems.priceListId} = ${priceLists.id})`,
      shopCount: sql<number>`(SELECT COUNT(*) FROM ${priceListAssignments} WHERE ${priceListAssignments.priceListId} = ${priceLists.id})`,
      createdAt: priceLists.createdAt,
    }).from(priceLists)
      .where(eq(priceLists.tenantId, ctx.tenant.id))
      .orderBy(desc(priceLists.priority), desc(priceLists.createdAt));
  }),

  // Get price list with items
  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [list] = await db.select().from(priceLists)
        .where(and(eq(priceLists.id, input.id), eq(priceLists.tenantId, ctx.tenant.id)))
        .limit(1);

      if (!list) return null;

      const items = await db.select({
        id: priceListItems.id,
        productId: priceListItems.productId,
        productName: products.name,
        productCode: products.code,
        price: priceListItems.price,
        minQuantity: priceListItems.minQuantity,
        unitPrice: products.unitPrice,
      }).from(priceListItems)
        .leftJoin(products, eq(priceListItems.productId, products.id))
        .where(eq(priceListItems.priceListId, input.id));

      const assignments = await db.select({
        id: priceListAssignments.id,
        shopId: priceListAssignments.shopId,
        shopName: shops.name,
      }).from(priceListAssignments)
        .leftJoin(shops, eq(priceListAssignments.shopId, shops.id))
        .where(eq(priceListAssignments.priceListId, input.id));

      return { ...list, items, assignments };
    }),

  // Create price list
  create: operatorQuery
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["shop", "tier", "volume"]),
      priority: z.number().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(priceLists).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        description: input.description,
        type: input.type,
        priority: input.priority,
      });
      return { id: Number(result.insertId) };
    }),

  // Update price list
  update: operatorQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      priority: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(priceLists)
        .set(data)
        .where(and(eq(priceLists.id, id), eq(priceLists.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // Delete price list
  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(priceLists)
        .where(and(eq(priceLists.id, input.id), eq(priceLists.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // Add/update item in price list
  upsertItem: operatorQuery
    .input(z.object({
      priceListId: z.number(),
      productId: z.number(),
      price: z.number(),
      minQuantity: z.number().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Check if item exists
      const [existing] = await db.select()
        .from(priceListItems)
        .where(and(
          eq(priceListItems.priceListId, input.priceListId),
          eq(priceListItems.productId, input.productId),
        )).limit(1);

      if (existing) {
        await db.update(priceListItems)
          .set({ price: input.price.toFixed(2), minQuantity: input.minQuantity.toFixed(2) })
          .where(eq(priceListItems.id, existing.id));
      } else {
        await db.insert(priceListItems).values({
          priceListId: input.priceListId,
          productId: input.productId,
          price: input.price.toFixed(2),
          minQuantity: input.minQuantity.toFixed(2),
        });
      }

      return { success: true };
    }),

  // Remove item from price list
  removeItem: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(priceListItems).where(eq(priceListItems.id, input.id));
      return { success: true };
    }),

  // Assign price list to shop
  assignShop: operatorQuery
    .input(z.object({
      priceListId: z.number(),
      shopId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(priceListAssignments).values({
        priceListId: input.priceListId,
        shopId: input.shopId,
      });
      return { success: true };
    }),

  // Unassign price list from shop
  unassignShop: operatorQuery
    .input(z.object({
      priceListId: z.number(),
      shopId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(priceListAssignments)
        .where(and(
          eq(priceListAssignments.priceListId, input.priceListId),
          eq(priceListAssignments.shopId, input.shopId),
        ));
      return { success: true };
    }),

  // Get price for product in shop (checks all applicable price lists)
  getPrice: authedQuery
    .input(z.object({
      productId: z.number(),
      shopId: z.number(),
      quantity: z.number().default(1),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();

      // Find price lists assigned to this shop
      const assignedLists = await db.select({ priceListId: priceListAssignments.priceListId })
        .from(priceListAssignments)
        .where(eq(priceListAssignments.shopId, input.shopId));

      if (assignedLists.length === 0) {
        // No custom price list, return default product price
        const [product] = await db.select({ unitPrice: products.unitPrice })
          .from(products).where(eq(products.id, input.productId)).limit(1);
        return { price: product?.unitPrice ?? "0", source: "default" };
      }

      // Find applicable price for this product across assigned lists (highest priority wins)
      const listIds = assignedLists.map(l => l.priceListId);
      const [priceItem] = await db.select({
        price: priceListItems.price,
        priceListId: priceListItems.priceListId,
        minQuantity: priceListItems.minQuantity,
        priority: priceLists.priority,
      }).from(priceListItems)
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(and(
          eq(priceListItems.productId, input.productId),
          sql`${priceListItems.priceListId} IN (${sql.join(listIds.map(id => sql`${id}`), sql`, `)})`,
          eq(priceLists.isActive, true),
          sql`${priceListItems.minQuantity} <= ${input.quantity}`,
        ))
        .orderBy(desc(priceLists.priority))
        .limit(1);

      if (priceItem) {
        return { price: priceItem.price, source: `price_list_${priceItem.priceListId}` };
      }

      // Fallback to default price
      const [product] = await db.select({ unitPrice: products.unitPrice })
        .from(products).where(eq(products.id, input.productId)).limit(1);
      return { price: product?.unitPrice ?? "0", source: "default" };
    }),
});

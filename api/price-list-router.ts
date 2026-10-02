import { z } from "zod";
import { resolvePrices } from "./services/price-resolver";
import { createRouter, operatorQuery, authedQuery, managementQuery, fieldSalesQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProductsBelongToTenant } from "./lib/tenant-refs";
import { priceLists, priceListItems, priceListAssignments, products, shops, markdowns, stockBatches, warehouses } from "@db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { recordAudit, auditActor } from "./services/audit-log";
import { cache } from "./lib/cache";
import { invalidateReports } from "./lib/report-cache";
import { dayKey } from "./lib/period";

/*
  Каталог (product.list/listAll с shopId) кэширует уже посчитанные цены
  магазина на три минуты. Любая правка списка сбрасывает его: иначе
  каталог и корзина заказа показывали старую цену, а заказ считался по новой.
*/
const dropCatalogCache = (tenantId: number) => cache.invalidatePrefix(`products:${tenantId}`);

export const priceListRouter = createRouter({
  /**
   * Что нужно форме заказа: список магазина по умолчанию и все активные
   * списки — выбрать другой. Полевым ролям тоже: агент оформляет заказ.
   */
  forShop: fieldSalesQuery
    .input(z.object({ shopId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { shopPriceList } = await import("./services/price-resolver");
      const [current, all] = await Promise.all([
        shopPriceList(db, ctx.tenant.id, input.shopId),
        db.select({ id: priceLists.id, name: priceLists.name, markupPct: priceLists.markupPct }).from(priceLists)
          .where(and(eq(priceLists.tenantId, ctx.tenant.id), eq(priceLists.isActive, true))).orderBy(desc(priceLists.priority), priceLists.name),
      ]);
      return { current, lists: all.map(l => ({ id: Number(l.id), name: l.name, markupPct: l.markupPct })) };
    }),
  /** Прайс-лист магазина — один: назначить или снять с карточки магазина. */
  setForShop: operatorQuery.use(can("prices.manage"))
    .input(z.object({ shopId: z.number().int().positive(), priceListId: z.number().int().positive().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [shop] = await db.select({ id: shops.id }).from(shops).where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id))).limit(1);
      if (!shop) throw new Error("Магазин не найден");
      const own = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.tenantId, ctx.tenant.id));
      const ownIds = own.map(l => Number(l.id));
      if (input.priceListId != null && !ownIds.includes(input.priceListId)) throw new Error("Прайс-лист не найден");
      await db.transaction(async (tx) => {
        if (ownIds.length) await tx.delete(priceListAssignments).where(and(eq(priceListAssignments.shopId, input.shopId), inArray(priceListAssignments.priceListId, ownIds)));
        if (input.priceListId != null) await tx.insert(priceListAssignments).values({ priceListId: input.priceListId, shopId: input.shopId });
      });
      dropCatalogCache(ctx.tenant.id);
      await recordAudit(db, { ...auditActor(ctx), action: "price_list.shop_set", targetType: "shop", targetId: input.shopId, meta: { priceListId: input.priceListId } });
      return { success: true };
    }),
  /*
    Чтение списков — управлению (руководитель, оператор, супервайзер).
    Правит их оператор (prices.manage), а list/getById/shopMap стояли под
    supervisorQuery: оператор создавал список и попадал на пустую страницу
    с FORBIDDEN. Себестоимости здесь нет — только цена карточки.
  */
  list: managementQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({
      id: priceLists.id,
      name: priceLists.name,
      description: priceLists.description,
      type: priceLists.type,
      isActive: priceLists.isActive,
      priority: priceLists.priority,
      markupPct: priceLists.markupPct,
      /*
        Имена таблиц — явно, не через ${…}. В запросе без соединений drizzle
        пишет колонки без таблицы, и подзапрос выходил «WHERE price_list_id =
        id», где id — строки самого подзапроса. Список прайс-листов показывал
        одно и то же число у всех, чаще «0 товаров · 0 магазинов» (25.09.2026).
        Товары — со своей ценой от одной штуки, как «своих цен» на странице
        списка: ступени «от 10 / от 50» того же товара — не новые товары.
      */
      itemCount: sql<number>`(SELECT COUNT(DISTINCT pli.product_id) FROM price_list_items pli WHERE pli.price_list_id = price_lists.id AND pli.min_quantity <= 1)`,
      shopCount: sql<number>`(SELECT COUNT(*) FROM price_list_assignments pla WHERE pla.price_list_id = price_lists.id)`,
      createdAt: priceLists.createdAt,
    }).from(priceLists)
      .where(eq(priceLists.tenantId, ctx.tenant.id))
      .orderBy(desc(priceLists.priority), desc(priceLists.createdAt));
  }),

  // Get price list with items
  getById: managementQuery
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
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .leftJoin(products, and(eq(priceListItems.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(priceListItems.priceListId, input.id), eq(priceLists.tenantId, ctx.tenant.id)));

      const assignments = await db.select({
        id: priceListAssignments.id,
        shopId: priceListAssignments.shopId,
        shopName: shops.name,
      }).from(priceListAssignments)
        .innerJoin(priceLists, eq(priceListAssignments.priceListId, priceLists.id))
        .leftJoin(shops, and(eq(priceListAssignments.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
        .where(and(eq(priceListAssignments.priceListId, input.id), eq(priceLists.tenantId, ctx.tenant.id)));

      return { ...list, items, assignments };
    }),

  // Create price list
  create: operatorQuery.use(can("prices.manage"))
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["shop", "tier", "volume"]),
      priority: z.number().default(0),
      // Правило «к карточке», %: −7 — скидка, 5 — наценка; пусто — только строки.
      markupPct: z.number().min(-99).max(1000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(priceLists).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        description: input.description,
        type: input.type,
        priority: input.priority,
        markupPct: input.markupPct == null ? null : input.markupPct.toFixed(2),
      });
      return { id: Number(result.insertId) };
    }),

  // Update price list
  update: operatorQuery.use(can("prices.manage"))
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      priority: z.number().optional(),
      markupPct: z.number().min(-99).max(1000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, markupPct, ...data } = input;
      await db.update(priceLists)
        .set({ ...data, ...(markupPct !== undefined ? { markupPct: markupPct == null ? null : markupPct.toFixed(2) } : {}) })
        .where(and(eq(priceLists.id, id), eq(priceLists.tenantId, ctx.tenant.id)));
      dropCatalogCache(ctx.tenant.id);
      return { success: true };
    }),

  // Delete price list
  delete: operatorQuery.use(can("prices.manage"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(priceLists)
        .where(and(eq(priceLists.id, input.id), eq(priceLists.tenantId, ctx.tenant.id)));
      dropCatalogCache(ctx.tenant.id);
      await recordAudit(db, { ...auditActor(ctx), action: "price_list.deleted", targetType: "price_list", targetId: input.id });
      return { success: true };
    }),

  // Add/update item in price list
  upsertItem: operatorQuery.use(can("prices.manage"))
    .input(z.object({
      priceListId: z.number(),
      productId: z.number(),
      price: z.number().min(0, "Цена не может быть отрицательной"),
      minQuantity: z.number().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Verify price list belongs to tenant
      const [priceList] = await db.select({ id: priceLists.id })
        .from(priceLists)
        .where(and(eq(priceLists.id, input.priceListId), eq(priceLists.tenantId, tenantId)))
        .limit(1);
      if (!priceList) throw new Error("Прайс-лист не найден");

      // Прайс-лист свой, а товар в него кладут по идентификатору от клиента.
      // Без этой проверки в него добавлялся чужой product_id, а чтение
      // соединялось с products без границы организации — и отдавало название,
      // код и цену товара другой компании. Перебором так выгружался чужой
      // каталог целиком, вместе с прайсом.
      await assertProductsBelongToTenant(db, tenantId, [input.productId]);

      /*
        Строка — это товар И ступень. Раньше искали только по товару: ступень
        «от 10» затирала цену от одной штуки (её ставит сетка, setItems), а
        вторая ступень — первую. Ступень ≤ 1 — цена от одной штуки, как в
        setItems и резолвере; иначе «от» сравнивается числом: в базе "10.00".
      */
      // Сначала округление до копеек, как хранит колонка: «1.001» иначе прошло бы
      // мимо базы и легло второй ценой от одной штуки.
      const tierKey = (q: number) => { const r = Number(q.toFixed(2)); return r <= 1 ? "base" : r.toFixed(2); };
      const rows = await db.select()
        .from(priceListItems)
        .where(and(
          eq(priceListItems.priceListId, input.priceListId),
          eq(priceListItems.productId, input.productId),
        ));
      const existing = rows.find(r => tierKey(Number(r.minQuantity)) === tierKey(input.minQuantity));

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
      dropCatalogCache(tenantId);

      // Цена в прайсе — это цена заказа для магазина; спор о ней — спор о деньгах.
      await recordAudit(db, {
        ...auditActor(ctx), action: "price_list.item_set", targetType: "price_list", targetId: input.priceListId,
        meta: { productId: input.productId, price: input.price.toFixed(2), minQuantity: input.minQuantity.toFixed(2), was: existing ? { price: existing.price, minQuantity: existing.minQuantity } : null },
      });

      return { success: true };
    }),

  /*
    Цены списка — пачкой из сетки: товар → цена от одной штуки или null
    (убрать, товар снова по правилу списка или карточке). Ступени «от N
    штук» сетка не трогает — они правятся по одной (upsertItem/removeItem).
    Один журнальный след на сохранение: был, стал — по каждому товару.
  */
  setItems: operatorQuery.use(can("prices.manage"))
    .input(z.object({
      priceListId: z.number(),
      items: z.array(z.object({ productId: z.number(), price: z.number().min(0, "Цена не может быть отрицательной").nullable() })).max(20000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const [list] = await db.select({ id: priceLists.id }).from(priceLists)
        .where(and(eq(priceLists.id, input.priceListId), eq(priceLists.tenantId, tenantId))).limit(1);
      if (!list) throw new Error("Прайс-лист не найден");
      const ids = [...new Set(input.items.map(i => i.productId))];
      if (ids.length !== input.items.length) throw new Error("Товар встречается дважды");
      if (ids.length === 0) return { success: true, set: 0, cleared: 0 };
      await assertProductsBelongToTenant(db, tenantId, ids);

      const changes = await db.transaction(async (tx) => {
        const current = await tx.select({ id: priceListItems.id, productId: priceListItems.productId, price: priceListItems.price })
          .from(priceListItems)
          .where(and(eq(priceListItems.priceListId, input.priceListId), inArray(priceListItems.productId, ids), sql`${priceListItems.minQuantity} <= 1`));
        const byProduct = new Map(current.map(r => [Number(r.productId), r]));
        const log: Array<{ productId: number; was: string | null; now: string | null }> = [];
        for (const item of input.items) {
          const was = byProduct.get(item.productId);
          if (item.price == null) {
            if (!was) continue;
            await tx.delete(priceListItems).where(eq(priceListItems.id, was.id));
            log.push({ productId: item.productId, was: was.price, now: null });
            continue;
          }
          const now = item.price.toFixed(2);
          if (was) {
            if (Number(was.price).toFixed(2) === now) continue;
            await tx.update(priceListItems).set({ price: now }).where(eq(priceListItems.id, was.id));
          } else {
            await tx.insert(priceListItems).values({ priceListId: input.priceListId, productId: item.productId, price: now, minQuantity: "1.00" });
          }
          log.push({ productId: item.productId, was: was?.price ?? null, now });
        }
        return log;
      });
      dropCatalogCache(tenantId);
      if (changes.length > 0) {
        await recordAudit(db, {
          ...auditActor(ctx), action: "price_list.items_set", targetType: "price_list", targetId: input.priceListId,
          // Журнал — не выгрузка: первые двести строк, счёт — полный.
          meta: { count: changes.length, changes: changes.slice(0, 200) },
        });
      }
      return { success: true, set: changes.filter(c => c.now != null).length, cleared: changes.filter(c => c.now == null).length };
    }),

  // Remove item from price list
  removeItem: operatorQuery.use(can("prices.manage"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Verify the item belongs to a price list owned by this tenant
      const [item] = await db.select({ id: priceListItems.id })
        .from(priceListItems)
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(and(eq(priceListItems.id, input.id), eq(priceLists.tenantId, tenantId)))
        .limit(1);
      if (!item) throw new Error("Позиция не найдена");

      await db.delete(priceListItems).where(eq(priceListItems.id, input.id));
      dropCatalogCache(tenantId);
      return { success: true };
    }),

  /*
    Магазины списка — одним сохранением, а не по одному.

    Магазин живёт в одном списке (как в карточке магазина, setForShop):
    отмеченный здесь уходит из прежнего, снятый — остаётся без списка и
    получает цены карточки. Раньше магазины привязывались по одному
    выпадающим списком, и сто магазинов оптового канала — это сто кликов.
  */
  setShops: operatorQuery.use(can("prices.manage"))
    .input(z.object({ priceListId: z.number(), shopIds: z.array(z.number().int().positive()).max(20000) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const [list] = await db.select({ id: priceLists.id }).from(priceLists)
        .where(and(eq(priceLists.id, input.priceListId), eq(priceLists.tenantId, tenantId))).limit(1);
      if (!list) throw new Error("Прайс-лист не найден");
      const wanted = [...new Set(input.shopIds)];
      if (wanted.length > 0) {
        const own = await db.select({ id: shops.id }).from(shops)
          .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, wanted)));
        if (own.length !== wanted.length) throw new Error("Магазин не найден");
      }
      const tenantLists = db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.tenantId, tenantId));
      const result = await db.transaction(async (tx) => {
        const before = await tx.select({ shopId: priceListAssignments.shopId }).from(priceListAssignments)
          .where(eq(priceListAssignments.priceListId, input.priceListId));
        const had = new Set(before.map(r => Number(r.shopId)));
        // Снятые — вон из этого списка.
        const removed = [...had].filter(id => !wanted.includes(id));
        if (removed.length > 0) {
          await tx.delete(priceListAssignments).where(and(
            eq(priceListAssignments.priceListId, input.priceListId), inArray(priceListAssignments.shopId, removed)));
        }
        // Отмеченные — из прежних списков организации сюда.
        const added = wanted.filter(id => !had.has(id));
        let moved = 0;
        if (added.length > 0) {
          const elsewhere = await tx.select({ shopId: priceListAssignments.shopId }).from(priceListAssignments)
            .where(and(inArray(priceListAssignments.shopId, added), inArray(priceListAssignments.priceListId, tenantLists)));
          moved = new Set(elsewhere.map(r => Number(r.shopId))).size;
          await tx.delete(priceListAssignments).where(and(inArray(priceListAssignments.shopId, added), inArray(priceListAssignments.priceListId, tenantLists)));
          await tx.insert(priceListAssignments).values(added.map(shopId => ({ priceListId: input.priceListId, shopId })));
        }
        return { added: added.length, removed: removed.length, moved };
      });
      dropCatalogCache(tenantId);
      await recordAudit(db, {
        ...auditActor(ctx), action: "price_list.shops_set", targetType: "price_list", targetId: input.priceListId,
        meta: { total: wanted.length, ...result },
      });
      return { success: true, ...result };
    }),

  /*
    Уценка партии, которая не успеет продаться до срока (экран «Сроки»).

    Цена — потолок для всех магазинов, пока партия жива и не наступил её срок
    (services/markdown.ts, правило — в price-resolver). Права — те же, что у
    прайс-листов (prices.manage). Ниже закупки — только директор: продать в
    минус бывает лучше списания, но это решение о деньгах, и закупку видит
    только он (как P&L).
  */
  setMarkdown: operatorQuery.use(can("prices.manage"))
    .input(z.object({
      batchId: z.number().int().positive(),
      price: z.number().positive("Цена должна быть больше нуля").max(1_000_000_000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const today = dayKey(new Date());
      const [b] = await db.select({
        productId: stockBatches.productId,
        quantity:  stockBatches.quantity,
        expiresAt: sql<string | null>`DATE_FORMAT(${stockBatches.expiresAt}, '%Y-%m-%d')`,
        isDefault: warehouses.isDefault,
        unitPrice: products.unitPrice,
        cost:      sql<string>`COALESCE(${stockBatches.costPrice}, ${products.costPrice})`,
      })
        .from(stockBatches)
        .innerJoin(products, and(eq(products.id, stockBatches.productId), eq(products.tenantId, tenantId)))
        .leftJoin(warehouses, and(eq(warehouses.id, stockBatches.warehouseId), eq(warehouses.tenantId, tenantId)))
        .where(and(eq(stockBatches.id, input.batchId), eq(stockBatches.tenantId, tenantId)))
        .limit(1);
      if (!b || !(Number(b.quantity) > 0)) throw new TRPCError({ code: "NOT_FOUND", message: "Партия не найдена или уже продана" });
      if (!b.expiresAt) throw new TRPCError({ code: "BAD_REQUEST", message: "У партии нет срока — уценять её незачем" });
      if (b.expiresAt < today) throw new TRPCError({ code: "BAD_REQUEST", message: "Срок партии вышел — её не продают, а списывают" });
      if (!b.isDefault) throw new TRPCError({ code: "BAD_REQUEST", message: "Партия не на основном складе — с него не продают. Сначала переместите её" });
      const card = Number(b.unitPrice);
      const price = Math.round(input.price * 100) / 100;
      if (!(price < card)) throw new TRPCError({ code: "BAD_REQUEST", message: "Уценка — это цена ниже цены карточки" });
      if (price < Number(b.cost) && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Цена ниже закупки — такую уценку ставит директор" });
      }
      const productId = Number(b.productId);
      await db.insert(markdowns)
        .values({ tenantId, productId, batchId: input.batchId, price: price.toFixed(2), endsOn: sql`${b.expiresAt}`, createdBy: ctx.user.id })
        .onDuplicateKeyUpdate({ set: { batchId: input.batchId, price: price.toFixed(2), endsOn: sql`${b.expiresAt}`, createdBy: ctx.user.id, createdAt: sql`CURRENT_TIMESTAMP` } });
      dropCatalogCache(tenantId);
      await invalidateReports(tenantId, "price.markdown");
      await recordAudit(db, {
        ...auditActor(ctx), action: "price.markdown_set", targetType: "product", targetId: productId,
        meta: { productId, price: price.toFixed(2), was: card.toFixed(2), discountPct: Math.round((1 - price / card) * 1000) / 10, expiresAt: b.expiresAt },
      });
      return { success: true, productId, endsOn: b.expiresAt };
    }),

  /** Снять уценку раньше срока — цена товара снова обычная. */
  clearMarkdown: operatorQuery.use(can("prices.manage"))
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const [was] = await db.select({ price: markdowns.price }).from(markdowns)
        .where(and(eq(markdowns.tenantId, tenantId), eq(markdowns.productId, input.productId))).limit(1);
      if (!was) return { success: true, removed: false };
      await db.delete(markdowns).where(and(eq(markdowns.tenantId, tenantId), eq(markdowns.productId, input.productId)));
      dropCatalogCache(tenantId);
      await invalidateReports(tenantId, "price.markdown");
      await recordAudit(db, {
        ...auditActor(ctx), action: "price.markdown_cleared", targetType: "product", targetId: input.productId,
        meta: { productId: input.productId, was: Number(was.price).toFixed(2) },
      });
      return { success: true, removed: true };
    }),

  /** Какой список у какого магазина — чтобы при назначении видеть, откуда магазин уйдёт. */
  shopMap: managementQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({ shopId: priceListAssignments.shopId, priceListId: priceListAssignments.priceListId, name: priceLists.name })
      .from(priceListAssignments)
      .innerJoin(priceLists, eq(priceListAssignments.priceListId, priceLists.id))
      .where(eq(priceLists.tenantId, ctx.tenant.id));
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
      const tenantId = ctx.tenant.id;

      // Verify shop belongs to tenant
      const [shop] = await db.select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId)))
        .limit(1);
      if (!shop) throw new Error("Магазин не найден");

      /*
        Та же цена, что посчитает заказ: resolvePrices — ступени «от N» с
        приоритетом списка, цена от одной штуки на любое количество, правило
        списка «к карточке». Здесь стояла своя копия правила, и она
        расходилась с заказом: без правила списка, без исключения для порога
        ≤ 1, без выбора большего порога внутри одного приоритета.
      */
      const [product] = await db.select({ unitPrice: products.unitPrice })
        .from(products).where(and(eq(products.id, input.productId), eq(products.tenantId, tenantId))).limit(1);
      const card = product ? String(product.unitPrice) : "0";
      const resolved = (await resolvePrices(db, tenantId, input.shopId, [{ productId: input.productId, quantity: input.quantity }],
        new Map(product ? [[input.productId, card]] : []))).get(input.productId);
      return resolved?.priceListId
        ? { price: resolved.price, source: `price_list_${resolved.priceListId}` }
        : { price: card, source: "default" };
    }),
});

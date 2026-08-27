import { z } from "zod";
import { createRouter, authedQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { territories, shops } from "@db/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { haversineKm } from "./lib/geo";

/**
 * Сколько идентификаторов кладём в один IN (...).
 *
 * Пачка нужна не ради красоты, а ради max_allowed_packet и планировщика:
 * список на три тысячи чисел — это уже несколько сотен килобайт текста
 * запроса, и MySQL начинает выбирать полное сканирование вместо индекса.
 * Тысяча — размер, при котором запрос остаётся коротким, а число обращений к
 * серверу падает с тысяч до единиц.
 */
const SHOP_UPDATE_CHUNK = 1000;

/**
 * Привязать пачку магазинов к территории.
 *
 * Раньше привязка шла по одному UPDATE на магазин. Супервайзер жал «Привязать
 * по GPS» — и до трёх тысяч последовательных запросов, каждый со своим
 * round-trip и своим коммитом с fsync и записью в binlog. На удалённом MySQL
 * (5–15 мс на коммит) это 15–45 секунд под одним HTTP-запросом: клиент
 * отваливался по таймауту, мутация продолжала идти, а супервайзер, не увидев
 * результата, жал кнопку второй раз — и поверх первого прохода запускался
 * второй.
 *
 * Расстояние всё равно считается в JS, так что соответствие «территория →
 * магазины» уже собрано в памяти; остаётся выполнить один UPDATE на пачку.
 * tenant_id в условии обязателен: идентификаторы пришли из выборки по своей
 * организации, но условие рядом с IN (...) не даёт этой связи потеряться при
 * первой же правке запроса.
 */
async function assignShopsToTerritory(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  territoryId: number,
  shopIds: number[],
): Promise<void> {
  for (let i = 0; i < shopIds.length; i += SHOP_UPDATE_CHUNK) {
    const chunk = shopIds.slice(i, i + SHOP_UPDATE_CHUNK);
    await db.update(shops).set({ territoryId })
      .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, chunk)));
  }
}

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
      totalDebt: sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL(15,2))), 0)`,
    })
      .from(territories)
      // Условие по организации в самом соединении. Без него в счётчик
      // shopCount и в сумму totalDebt своей территории попадал чужой магазин:
      // достаточно было, чтобы кто-то из другой организации записал своему
      // магазину этот territory_id — и владелец территории видел завышенное
      // число точек и чужой долг в своей сводке.
      .leftJoin(shops, and(eq(territories.id, shops.territoryId), eq(shops.tenantId, ctx.tenant.id)))
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
      const db = getDb();
      const [result] = await db.insert(territories).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        color: input.color,
        centerLat: input.centerLat?.toFixed(8) ?? null,
        centerLng: input.centerLng?.toFixed(8) ?? null,
        radiusKm: input.radiusKm?.toFixed(2) ?? "10.00",
      });
      const territoryId = Number(result.insertId);

      // Auto-assign unassigned shops with GPS to this new territory
      if (input.centerLat && input.centerLng) {
        const centerLat = input.centerLat;
        const centerLng = input.centerLng;
        const radius = input.radiusKm ?? 10;
        const unassigned = await db.select({
          id: shops.id,
          gpsLat: shops.gpsLat,
          gpsLng: shops.gpsLng,
        }).from(shops).where(and(
          eq(shops.tenantId, ctx.tenant.id),
          isNull(shops.territoryId),
          eq(shops.status, "active"),
          sql`${shops.gpsLat} IS NOT NULL AND ${shops.gpsLng} IS NOT NULL`,
        ));

        const inRadius = unassigned
          .filter(shop => haversineKm(Number(shop.gpsLat), Number(shop.gpsLng), centerLat, centerLng) <= radius)
          .map(shop => Number(shop.id));

        await assignShopsToTerritory(db, ctx.tenant.id, territoryId, inRadius);
      }

      return { id: territoryId };
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
      const db = getDb();
      const { id, ...rest } = input;
      const data: Record<string, unknown> = {};
      if (rest.name !== undefined) data.name = rest.name;
      if (rest.color !== undefined) data.color = rest.color;
      if (rest.centerLat !== undefined) data.centerLat = rest.centerLat.toFixed(8);
      if (rest.centerLng !== undefined) data.centerLng = rest.centerLng.toFixed(8);
      if (rest.radiusKm !== undefined) data.radiusKm = rest.radiusKm.toFixed(2);
      await db.update(territories).set(data)
        .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenant.id)));

      // Re-assign shops with GPS if geo params changed
      if (rest.centerLat !== undefined || rest.centerLng !== undefined || rest.radiusKm !== undefined) {
        // tenant_id в условии: без него перечитывались координаты территории
        // другой организации — сам UPDATE выше её не тронул, но по её центру и
        // радиусу тут же переразмечались СВОИ магазины.
        const [terr] = await db.select({
          centerLat: territories.centerLat,
          centerLng: territories.centerLng,
          radiusKm: territories.radiusKm,
        }).from(territories)
          .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenant.id)))
          .limit(1);

        if (terr?.centerLat && terr?.centerLng) {
          const shopsWithGps = await db.select({
            id: shops.id,
            gpsLat: shops.gpsLat,
            gpsLng: shops.gpsLng,
          }).from(shops).where(and(
            eq(shops.tenantId, ctx.tenant.id),
            eq(shops.status, "active"),
            sql`${shops.gpsLat} IS NOT NULL AND ${shops.gpsLng} IS NOT NULL`,
          ));

          const radius = Number(terr.radiusKm ?? 10);
          const centerLat = Number(terr.centerLat);
          const centerLng = Number(terr.centerLng);
          const inRadius = shopsWithGps
            .filter(shop => haversineKm(Number(shop.gpsLat), Number(shop.gpsLng), centerLat, centerLng) <= radius)
            .map(shop => Number(shop.id));

          await assignShopsToTerritory(db, ctx.tenant.id, id, inRadius);
        }
      }

      return { success: true };
    }),

  /** Delete territory (shops lose their territoryId) */
  delete: supervisorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(shops).set({ territoryId: null })
        .where(and(eq(shops.territoryId, input.id), eq(shops.tenantId, ctx.tenant.id)));
      try {
        await db.delete(territories)
          .where(and(eq(territories.id, input.id), eq(territories.tenantId, ctx.tenant.id)));
      } catch (err: unknown) {
        // territories has no soft-delete column, so unlike shops/products a
        // restrict FK (agentTerritories, salesTargets still pointing at it)
        // can't be papered over — but it should surface as a clear business
        // rejection, not the raw MySQL 500 this used to throw.
        const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code ?? "";
        const msg = (err as { cause?: { message?: string }; message?: string })?.cause?.message ?? (err as { message?: string })?.message ?? "";
        if (code === "ER_ROW_IS_REFERENCED" || code === "ER_ROW_IS_REFERENCED_2" || msg.includes("foreign key") || msg.includes("a child row")) {
          throw new Error("Невозможно удалить территорию: за ней ещё закреплены агенты или планы продаж");
        }
        throw err;
      }
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

      // Сначала соответствие «территория → её магазины» целиком в памяти, и
      // только потом запись. Расстояние и так считается в JS, поэтому цикл
      // ничего не ждёт от базы — а записей выходит по одной на территорию
      // вместо одной на магазин.
      const byTerritory = new Map<number, number[]>();
      let assigned = 0;
      for (const shop of unassigned) {
        const shopLat = Number(shop.gpsLat);
        const shopLng = Number(shop.gpsLng);

        for (const terr of terrs) {
          const dist = haversineKm(shopLat, shopLng, Number(terr.centerLat), Number(terr.centerLng));
          if (dist <= Number(terr.radiusKm)) {
            const bucket = byTerritory.get(terr.id);
            if (bucket) bucket.push(Number(shop.id));
            else byTerritory.set(terr.id, [Number(shop.id)]);
            assigned++;
            break;
          }
        }
      }

      for (const [territoryId, shopIds] of byTerritory) {
        await assignShopsToTerritory(db, tenantId, territoryId, shopIds);
      }

      return { assigned, total: unassigned.length };
    }),
});

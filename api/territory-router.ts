import { z } from "zod";
import { TRPCError } from "@trpc/server";
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

/**
 * Сколько территорий разрешено завести одним разом.
 *
 * Не ради нагрузки: поле «город» заполняют руками, и в нём заводятся опечатки,
 * адреса целиком и пустые строки с пробелом. Пятьдесят районов у одного
 * арендатора — уже неправдоподобно, а двести означают, что мы сейчас переведём
 * мусор из справочника магазинов в справочник территорий, и разбирать его
 * придётся вручную по одному.
 */
const MAX_NEW_TERRITORIES = 50;

/**
 * Ключ, по которому два написания считаются одним местом.
 *
 * «Ташкент», «ташкент » и «Ташкент» с двойным пробелом — один город, и три
 * территории вместо одной здесь не нужны никому.
 */
function placeKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Цвета для новых территорий — по кругу, чтобы соседние отличались. */
const TERRITORY_COLORS = [
  "#5b6d8a", "#3a7ca5", "#3a9a8a", "#7a9a3a",
  "#c49530", "#c0703a", "#c06080", "#7a6db5",
];

/**
 * Собрать магазины арендатора в группы по городу или району.
 *
 * Магазины берутся только действующие: архивный (status = inactive) территории
 * не требует, а в счёт бы попал и завысил бы её размер.
 *
 * Вместе с группами возвращаются слагаемые: сколько всего магазинов, у скольких
 * поле пусто, сколько уже привязано. Их считают ЗДЕСЬ, из тех же строк, а не
 * отдельным запросом с SUM(CASE …): строки уже прочитаны, второе обращение к
 * базе ради тех же чисел — лишняя работа и второй способ ошибиться.
 *
 * Пустое поле больше не отсекается запросом: без этих строк не сосчитать, у
 * скольких магазинов город не заполнен, — а именно этот ответ и нужен человеку,
 * когда группировать оказалось нечего.
 */
async function groupShopsByPlace(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  by: "city" | "district",
) {

  /*
    Выбираются оба поля, а нужное берётся по разрезу. Алиас `place: column` был
    бы короче, но читать значение под собственным именем колонки честнее: тот,
    кто через год откроет этот код, увидит city и district, а не переименование,
    смысл которого надо восстанавливать по аргументу функции.
  */
  const rows = await db.select({
    id: shops.id,
    city: shops.city,
    district: shops.district,
    territoryId: shops.territoryId,
  }).from(shops).where(and(
    eq(shops.tenantId, tenantId),
    eq(shops.status, "active"),
  ));

  /*
    Имя группы — первое встреченное написание, а не приведённое к нижнему
    регистру: человеку читать «Ташкент», а не «ташкент». Ключ при этом общий.
  */
  const groups = new Map<string, { name: string; shopIds: number[]; freeShopIds: number[] }>();
  let withoutPlace = 0;
  let alreadyAssigned = 0;

  for (const row of rows) {
    if (row.territoryId !== null && row.territoryId !== undefined) alreadyAssigned++;

    const raw = String((by === "city" ? row.city : row.district) ?? "");
    const key = placeKey(raw);
    if (!key) { withoutPlace++; continue; }

    const g = groups.get(key) ?? { name: raw.trim().replace(/\s+/g, " "), shopIds: [], freeShopIds: [] };
    g.shopIds.push(Number(row.id));
    // Уже привязанные не трогаем — см. createFromShops.
    if (row.territoryId === null || row.territoryId === undefined) g.freeShopIds.push(Number(row.id));
    groups.set(key, g);
  }

  return { groups, totalShops: rows.length, withoutPlace, alreadyAssigned };
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

  /*
    ── Территории из магазинов ─────────────────────────────────────────────────

    Территорию заводили только руками: название, цвет, координаты центра и
    радиус. Для арендатора, у которого уже двести точек с заполненными городом и
    районом, это работа на вечер — и ровно та работа, которую машина сделает
    вернее человека, потому что данные для неё уже лежат в карточках магазинов.

    Разделено на две ручки нарочно. `previewFromShops` только считает и ничего
    не меняет: создание десятка сущностей вслепую — не та операция, которую
    делают одним нажатием, не увидев заранее, что именно получится. Человек
    смотрит список городов с числом точек и решает, тот ли это разрез.
  */
  previewFromShops: supervisorQuery
    .input(z.object({ by: z.enum(["city", "district"]) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { groups, totalShops, withoutPlace, alreadyAssigned } =
        await groupShopsByPlace(db, ctx.tenant.id, input.by);

      const existing = await db.select({ name: territories.name })
        .from(territories).where(eq(territories.tenantId, ctx.tenant.id));
      const taken = new Set(existing.map(t => placeKey(t.name)));

      const items = [...groups.entries()]
        .map(([key, g]) => ({
          name: g.name,
          shops: g.shopIds.length,
          free: g.freeShopIds.length,
          exists: taken.has(key),
        }))
        .sort((a, b) => b.shops - a.shops);

      /*
        Одного числа мало.

        «Создать 0» — верный ответ и бесполезный: причин у нуля три, и человек
        не может отличить их друг от друга. Либо поле не заполнено ни у кого,
        либо территории на все города уже заведены, либо магазины и так
        разложены. В каждом случае делать надо разное, а экран молчал.

        Поэтому вместе с итогом приходят слагаемые.
      */
      return {
        items,
        toCreate: items.filter(i => !i.exists).length,
        toAssign: items.reduce((n, i) => n + i.free, 0),
        limit: MAX_NEW_TERRITORIES,
        totalShops,
        withoutPlace,
        alreadyAssigned,
        existingTerritories: existing.length,
      };
    }),

  createFromShops: supervisorQuery
    .input(z.object({ by: z.enum(["city", "district"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const { groups } = await groupShopsByPlace(db, tenantId, input.by);

      if (groups.size === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: input.by === "city"
            ? "Ни у одного магазина не заполнен город — группировать нечего"
            : "Ни у одного магазина не заполнен район — группировать нечего",
        });
      }

      /*
        Territория с таким именем уже есть — берём её, а не заводим вторую.
        Иначе второе нажатие кнопки удвоило бы справочник, а нажимают её
        обычно дважды: первый раз чтобы посмотреть, второй — «кажется, не
        сработало».
      */
      const existing = await db.select({ id: territories.id, name: territories.name })
        .from(territories).where(eq(territories.tenantId, tenantId));
      const byKey = new Map(existing.map(t => [placeKey(t.name), Number(t.id)]));

      const fresh = [...groups.entries()].filter(([key]) => !byKey.has(key));
      if (fresh.length > MAX_NEW_TERRITORIES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Получилось бы ${fresh.length} новых территорий при пределе ${MAX_NEW_TERRITORIES}. `
            + `Похоже, поле «${input.by === "city" ? "город" : "район"}» заполнено разнобоем — `
            + "проверьте справочник магазинов, иначе разнобой переедет в территории.",
        });
      }

      let created = 0;
      let assigned = 0;
      let colorAt = existing.length;

      for (const [key, group] of groups) {
        let territoryId = byKey.get(key);

        if (territoryId === undefined) {
          const [result] = await db.insert(territories).values({
            tenantId,
            name: group.name,
            color: TERRITORY_COLORS[colorAt % TERRITORY_COLORS.length],
          });
          territoryId = Number(result.insertId);
          byKey.set(key, territoryId);
          colorAt++;
          created++;
        }

        /*
          Привязываем только магазины БЕЗ территории.

          Тот, кого уже отнесли куда-то руками, отнесли осознанно: может быть,
          точка стоит на границе районов и её сознательно отдали соседу. Кнопка
          «собрать из магазинов» не должна переигрывать чужое решение — она
          заполняет пустое, а не переписывает заполненное.
        */
        if (group.freeShopIds.length > 0) {
          await assignShopsToTerritory(db, tenantId, territoryId, group.freeShopIds);
          assigned += group.freeShopIds.length;
        }
      }

      return { created, assigned, groups: groups.size };
    }),

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

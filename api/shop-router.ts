import { z } from "zod";
import { isSafePhotoValue, PHOTO_VALUE_ERROR } from "./lib/photo-value";
import { createRouter, operatorQuery, supervisorQuery, managementQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { receivablesAging } from "./services/receivables";
import { shops, users, orders, payments, territories } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { PaymentService } from "./services/payment";
import { cache, withCache, CacheKeys, CacheTTL } from "./lib/cache";
import { parseLocationFromUrl } from "./lib/parse-location";
import { haversineKm } from "./lib/geo";
import { photoRef } from "./lib/photo-url";
import { shopScores } from "./services/shop-scoring";
import {
  archiveShops, restoreShop, deleteShopForever, shopTrace,
  ShopHasHistoryError,
} from "./services/shop-archive";
import { shopStatement } from "./services/shop-statement";

/**
 * Проверить, что чужие идентификаторы в запросе принадлежат этой организации.
 *
 * Магазин ссылается на агента и на территорию, и оба идентификатора приходят
 * от клиента. Раньше они записывались как есть: достаточно было указать своему
 * магазину чужой agentId, открыть карточку — и чтение отдавало имя и почту
 * пользователя другой компании. Перебором так выгружалась вся база
 * пользователей платформы, включая суперадминов.
 *
 * Проверка на записи — первая половина защиты. Вторая, обязательная, стоит на
 * чтении: соединения с users и territories несут условие по организации,
 * потому что в базе уже могут лежать ссылки, записанные до этой правки, и
 * молча их доверять нельзя.
 */
async function assertTenantOwnsRefs(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  refs: { agentId?: number | null; territoryId?: number | null },
): Promise<void> {
  if (refs.agentId != null) {
    const [row] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, refs.agentId), eq(users.tenantId, tenantId))).limit(1);
    if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Сотрудник не найден в вашей организации" });
  }
  if (refs.territoryId != null) {
    const [row] = await db.select({ id: territories.id }).from(territories)
      .where(and(eq(territories.id, refs.territoryId), eq(territories.tenantId, tenantId))).limit(1);
    if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Территория не найдена в вашей организации" });
  }
}


export const shopRouter = createRouter({
  /**
   * Долг магазинов, разложенный по возрасту.
   *
   * Наш долг перед поставщиком система знала подробно — у поставки есть срок
   * оплаты и считается просрочка. А чужой долг нам был одним числом, и
   * отличить недельный от полугодового было нечем, хотя решение принимается
   * именно из этого различия.
   *
   * operatorQuery, как и сводка по поставщикам рядом: собирают долг оператор
   * и владелец, и обе стороны расчётов им нужны в одном месте.
   */
  receivablesAging: operatorQuery.query(async ({ ctx }) => {
    return receivablesAging(getDb(), ctx.tenant.id);
  }),

  // Территории нужны фильтру на самом списке магазинов.
  territories: managementQuery.query(async ({ ctx }) => {
    const rows = await getDb().select({
      id: territories.id,
      name: territories.name,
      color: territories.color,
      shopCount: sql<number>`count(${shops.id})`,
      totalDebt: sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL(15,2))), 0)`,
    })
      .from(territories)
      .leftJoin(shops, and(eq(territories.id, shops.territoryId), eq(shops.tenantId, ctx.tenant.id)))
      .where(eq(territories.tenantId, ctx.tenant.id))
      .groupBy(territories.id)
      .orderBy(sql`count(${shops.id}) DESC`);
    return rows;
  }),

  /**
   * Магазины с оценкой: сколько принесли за всю историю и как платят.
   *
   * Одна процедура на две задачи, потому что обе спрашивают про один и тот же
   * список: карта раскрашивает точки по платёжному поведению, отчёт LTV
   * сортирует их по принесённым деньгам. Считать это двумя запросами значило
   * бы дважды пройти по всем заказам организации.
   *
   * supervisorQuery — как у карты трекинга: цвет магазина строится на его
   * долге и истории платежей, это не та цифра, которую показывают рядовому
   * агенту чужого участка.
   */
  scores: supervisorQuery
    .input(z.object({ limit: z.number().int().min(1).max(2000).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 500;
      return withCache(
        CacheKeys.shopScores(ctx.tenant.id, limit),
        CacheTTL.shops,
        () => shopScores(getDb(), ctx.tenant.id, limit),
      );
    }),

  /*
    Чтение магазинов доступно и оператору.

    Здесь стоял supervisorQuery — только руководитель и супервайзер. При этом
    ниже в этом же файле оператор МОЖЕТ создать магазин (create), изменить его
    (update) и внести оплату (addPayment): всё это operatorQuery. Открыть
    список он не мог — то есть правил и платил вслепую.

    На экране это выглядело так: у оператора «Магазины» стоят и в нижней
    панели, и в боковом меню, он туда нажимает и получает «не удалось
    загрузить», а «Повторить» повторяет тот же отказ — запрос отклонён не
    сбоем, а правами. Ровно та же беда, что была у оператора на главной.

    managementQuery добавляет к прежнему набору ровно оператора и ничего
    больше. Новых возможностей это ему не даёт: писать он и так мог.
  */
  list: managementQuery
    .input(z.object({
      page:     z.number().default(1),
      // Capped at 500 for a paginated screen, but an export has to be able to
      // ask for everything: a report that silently stops at row 500 says
      // nothing on the sheet about the rows it dropped. The default is
      // unchanged, so only a caller that deliberately asks gets more.
      pageSize: z.number().min(1).max(10000).default(25),
      search:     z.string().optional(),
      city:       z.string().optional(),
      district:   z.string().optional(),
      agentId:    z.number().optional(),
      territoryId: z.number().optional(),
      onlyDebtors: z.boolean().optional(),
      /*
        Что показывать: работающие точки, архив или всё вместе.

        Раньше выбора не было, и список отдавал всё подряд. Убранная точка
        стояла в нём рядом с живой, отличаясь только словом в столбце статуса,
        — и попадала в поиск, в выбор магазина, в глаза. По умолчанию теперь
        живые: справочник — это то, с чем работают сегодня.
      */
      archived: z.enum(["hide", "only", "all"]).default("hide"),
      sortBy: z.enum(["newest", "debtDesc", "debtAsc"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;
      const sortBy   = input?.sortBy ?? "newest";

      const archived = input?.archived ?? "hide";

      const cacheKey = CacheKeys.shopList(tenantId, page, pageSize, input?.search, input?.city, input?.district, input?.agentId, input?.territoryId, input?.onlyDebtors, sortBy, archived);
      return withCache(cacheKey, CacheTTL.shops, async () => {
      const conditions = [eq(shops.tenantId, tenantId)];
      if (input?.search)   conditions.push(like(shops.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.city)     conditions.push(eq(shops.city, input.city));
      if (input?.district) conditions.push(eq(shops.district, input.district));
      if (input?.agentId)    conditions.push(eq(shops.agentId, input.agentId));
      if (input?.territoryId) conditions.push(eq(shops.territoryId, input.territoryId));
      if (input?.onlyDebtors) conditions.push(sql`CAST(${shops.debt} AS DECIMAL(15,2)) > 0`);
      /*
        Сводка считается ПО ВСЕМ точкам, страница — по выбранным.

        Иначе «общий долг» менялся бы от того, куда переключён вид: спрятал
        архив — сумма упала, и выглядит это как погашение. Долг убранной точки
        никуда не делся, она остаётся в дебиторке; см. services/shop-archive.ts.
        Отсюда два набора условий: одинаковые во всём, кроме признака архива.
      */
      const whereAll = and(...conditions);
      if (archived === "hide") conditions.push(eq(shops.status, "active"));
      if (archived === "only") conditions.push(eq(shops.status, "inactive"));
      const where = and(...conditions);

      const orderBy = sortBy === "debtDesc" ? desc(sql`CAST(${shops.debt} AS DECIMAL(15,2))`)
        : sortBy === "debtAsc" ? sql`CAST(${shops.debt} AS DECIMAL(15,2)) ASC`
        : desc(shops.createdAt);

      const [data, countResult] = await Promise.all([
        db.select({
          id:        shops.id,
          name:      shops.name,
          ownerName: shops.ownerName,
          phone:     shops.phone,
          address:   shops.address,
          city:      shops.city,
          district:  shops.district,
          photoUrl:  photoRef("shop", shops.id, shops.photoUrl, shops.updatedAt),
          gpsLat:    shops.gpsLat,
          gpsLng:    shops.gpsLng,
          debt:      shops.debt,
          status:    shops.status,
          archivedAt:    shops.archivedAt,
          archiveReason: shops.archiveReason,
          createdAt: shops.createdAt,
          agentName: users.name,
        })
          .from(shops)
          .leftJoin(users, and(eq(shops.agentId, users.id), eq(users.tenantId, tenantId)))
          .where(where)
          .limit(pageSize)
          .offset(offset)
          .orderBy(orderBy),
        // Сводка считается здесь, а не на клиенте.
        //
        // Карточки наверху страницы («активные», «с долгом», «общий долг»)
        // складывались из data — то есть из ОДНОЙ страницы в 25 магазинов, при
        // том что «всего магазинов» рядом показывало настоящее число с сервера.
        // Получалась карточка, которая уверенно называет сумму долга по всей
        // сети, а на деле сложила первые двадцать пять строк: чем дальше
        // листаешь, тем другие числа. Незаметно ровно до того момента, когда по
        // ним примут решение.
        //
        // Отдельного запроса это не стоит: те же условия, тот же проход, что и
        // у count(*), просто с тремя дополнительными столбцами.
        db.select({
          activeCount:   sql<number>`SUM(CASE WHEN ${shops.status} = 'active' THEN 1 ELSE 0 END)`,
          archivedCount: sql<number>`SUM(CASE WHEN ${shops.status} = 'inactive' THEN 1 ELSE 0 END)`,
          debtCount:     sql<number>`SUM(CASE WHEN CAST(${shops.debt} AS DECIMAL(15,2)) > 0 THEN 1 ELSE 0 END)`,
          totalDebt:     sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL(15,2))), 0)`,
        }).from(shops).where(whereAll),
      ]);

      const итоги = countResult[0];
      const activeCount   = Number(итоги?.activeCount ?? 0);
      const archivedCount = Number(итоги?.archivedCount ?? 0);

      return {
        data,
        /*
          Отдельного count(*) для страницы не нужно: статусов всего два, и
          число строк в выбранном виде складывается из тех же двух слагаемых,
          что уже посчитаны.
        */
        total: archived === "hide" ? activeCount
             : archived === "only" ? archivedCount
             : activeCount + archivedCount,
        // Number() обязателен: MySQL отдаёт SUM по DECIMAL строкой, и без
        // приведения «общий долг» сложился бы склейкой строк.
        totals: {
          activeCount,
          archivedCount,
          debtCount:   Number(итоги?.debtCount ?? 0),
          totalDebt:   Number(итоги?.totalDebt ?? 0),
        },
        page,
        pageSize,
      };
      });
    }),

  // Чтение карточки — по тому же правилу, что и список выше.
  getById: managementQuery
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
          .from(users).where(and(eq(users.id, shop.agentId ?? 0), eq(users.tenantId, tenantId))).limit(1),
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
      photoUrl: z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").refine(isSafePhotoValue, PHOTO_VALUE_ERROR).optional(),
      gpsLat:   z.preprocess(v => (v === "" ? undefined : v), z.string().optional()),
      gpsLng:   z.preprocess(v => (v === "" ? undefined : v), z.string().optional()),
      telegramLink: z.string().optional(),
      agentId:  z.number().optional(),
      territoryId: z.number().optional(),
      notes:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await assertTenantOwnsRefs(db, ctx.tenant.id, { agentId: input.agentId, territoryId: input.territoryId });

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
      const shopId = Number(result.insertId);

      // Auto-assign territory by GPS if no territoryId was provided
      if (gpsLat && gpsLng && !input.territoryId) {
        const allTerritories = await db.select({
          id: territories.id,
          centerLat: territories.centerLat,
          centerLng: territories.centerLng,
          radiusKm: territories.radiusKm,
        }).from(territories).where(eq(territories.tenantId, ctx.tenant.id));

        for (const terr of allTerritories) {
          if (!terr.centerLat || !terr.centerLng) continue;
          const dist = haversineKm(Number(gpsLat), Number(gpsLng), Number(terr.centerLat), Number(terr.centerLng));
          if (dist <= Number(terr.radiusKm ?? 10)) {
            await db.update(shops).set({ territoryId: terr.id }).where(eq(shops.id, shopId));
            break;
          }
        }
      }

      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
      cache.invalidate(CacheKeys.shopCities(ctx.tenant.id));
      return { id: shopId };
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
      photoUrl: z.string().max(2_800_000, "Файл слишком большой (макс. 2 МБ)").refine(isSafePhotoValue, PHOTO_VALUE_ERROR).nullable().optional(),
      gpsLat:   z.preprocess(v => (v === "" ? undefined : v), z.string().optional()),
      gpsLng:   z.preprocess(v => (v === "" ? undefined : v), z.string().optional()),
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

      await assertTenantOwnsRefs(getDb(), ctx.tenant.id, { agentId: data.agentId, territoryId: data.territoryId });

      await getDb().update(shops).set(sanitized)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id)));
      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
      cache.invalidate(CacheKeys.shopCities(ctx.tenant.id));
      return { success: true };
    }),

  // SECURITY FIX 1.4: Block deletion if shop has linked orders or payments
  //
  // Nine tables carry a restrict FK on shops.id (orders, payments,
  // dailyPlans, returns, visitSchedules, salesTargets, priceListAssignments,
  // visitReports, debtReminders), and pre-checking each by name is exactly
  // the kind of list that goes stale the next time someone adds a table that
  // references a shop. Attempt the hard delete and let MySQL's own FK
  // constraint be the source of truth — same pattern as product-router.ts's
  // delete — falling back to soft-delete only on a genuine FK violation.
  /*
    Акт сверки: откуда взялось число долга.

    Прежде на этот вопрос отвечать было нечем. В карточке стоял блок «История
    платежей» — пять строк из таблицы payments, без отгрузок, без возвратов и
    без остатка после каждой строки. Спор о долге решается бумагой, которую
    подписывают обе стороны; у поставщиков такая бумага в системе была, у
    магазинов — нет.

    Права те же, что у чтения карточки: акт показывает ровно то, что и так
    видно в ней, только собранным в документ.
  */
  statement: managementQuery
    .input(z.object({
      shopId: z.number(),
      from: z.string().optional(),
      to: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const parse = (v?: string) => {
        if (!v) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const result = await shopStatement(ctx.tenant.id, input.shopId, parse(input.from), parse(input.to));
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден" });
      return result;
    }),

  /*
    Что за точкой числится — чтобы окно подтверждения говорило правду.

    Раньше оно обещало «данные будут удалены безвозвратно» независимо от того,
    что произойдёт на самом деле, а произойти могло одно из двух. Теперь экран
    спрашивает заранее и показывает, чем именно рискует человек.
  */
  trace: managementQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const trace = await shopTrace(ctx.tenant.id, input.id);
      if (!trace) throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден" });
      return trace;
    }),

  /** Убрать точки из работы. История цела, долг цел, действие обратимо. */
  archive: operatorQuery
    .input(z.object({
      ids: z.array(z.number()).min(1).max(500),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const result = await archiveShops(tenantId, input.ids, ctx.user.id, input.reason);
      cache.invalidatePrefix(`shops:${tenantId}`);
      cache.invalidate(CacheKeys.shopCities(tenantId));
      return result;
    }),

  /** Вернуть точку в работу. */
  restore: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const ok = await restoreShop(tenantId, input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден или уже в работе" });
      cache.invalidatePrefix(`shops:${tenantId}`);
      cache.invalidate(CacheKeys.shopCities(tenantId));
      return { success: true };
    }),

  /*
    Стереть точку насовсем — исправление ошибки ввода, а не житейское событие.

    Разрешено ровно тогда, когда стирать нечего: на точку не ссылается ни одна
    запись. Так убирают дубли, наплодившиеся от повторного тапа по «Создать» до
    появления ключа попытки, — и только их.
  */
  deleteForever: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      try {
        await deleteShopForever(tenantId, input.id);
      } catch (err) {
        if (err instanceof ShopHasHistoryError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        throw err;
      }
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
      // Метка одной попытки оплаты, одинаковая у всех её повторов. Клиент
      // выдаёт её один раз на открытую форму, поэтому повторная отправка —
      // сорванная связь, второй клик, две вкладки — приходит с той же меткой
      // и не списывает долг второй раз.
      idempotencyKey: z.string().min(8).max(100).optional(),
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
      dataUrl: z.string().refine(isSafePhotoValue, PHOTO_VALUE_ERROR).max(5_000_000, "Файл слишком большой (макс. 4 МБ)"),
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

  cities: supervisorQuery.query(async ({ ctx }) => {
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

  districts: supervisorQuery
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

  // ── Debt Details (for invoice printing) ─────────────────────────────────────
  getDebtDetails: supervisorQuery
    .input(z.object({ shopId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const [shop] = await db.select({
        id: shops.id, name: shops.name, debt: shops.debt,
      }).from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId)))
        .limit(1);
      if (!shop) throw new Error("Магазин не найден");

      const paymentHistory = await PaymentService.getPaymentHistoryRange(db, tenantId, input.shopId, 30);

      const debtAmount = Number(shop.debt);
      let debtStatus: "paid" | "low" | "medium" | "high" | "critical" = "paid";
      if (debtAmount > 1_000_000) debtStatus = "critical";
      else if (debtAmount > 500_000) debtStatus = "high";
      else if (debtAmount > 0) debtStatus = "low";

      return {
        shopId: shop.id,
        shopName: shop.name,
        currentDebt: shop.debt,
        debtAmount,
        debtStatus,
        paymentHistory,
      };
    }),

  // ── Debt Report ─────────────────────────────────────────────────────────────
  debtReport: supervisorQuery.query(async ({ ctx }) => {
    return getDb().select({
      shopName: shops.name,
      city: shops.city,
      debt: shops.debt,
      agentName: users.name,
    })
      .from(shops).leftJoin(users, and(eq(shops.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
      .where(and(eq(shops.tenantId, ctx.tenant.id), sql`${shops.debt} != 0`))
      .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL(15,2))`));
  }),
});

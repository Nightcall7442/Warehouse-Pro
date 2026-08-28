import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, fieldSalesQuery, merchVisitQuery, supervisorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentLocations, dailyPlans, shops, users, agentTerritories, territories } from "@db/schema";
import { eq, and, sql, desc, gte, lte , inArray } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "./lib/order-status";
import { sseBus } from "./lib/sse";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { cache, withCache, CacheTTL } from "./lib/cache";
import { verifyVisit } from "./services/anti-fraud";
import { haversineKm } from "./lib/geo";
import { onDate } from "./lib/date-range";
import { photoRef } from "./lib/photo-url";
import { isDuplicateEntry } from "./lib/db-errors";


/**
 * Принять время съёмки от устройства — или отбросить его, оставив точку.
 *
 * Время приходит от клиента, и проверить его нечем: часы на телефоне ставит
 * владелец телефона. Поэтому здесь не «доверять или нет», а «в каких пределах
 * это вообще осмысленно».
 *
 * Из будущего — отбрасывается: точка не может быть снята позже, чем принята.
 * Небольшой запас оставлен на расхождение часов, оно бывает у всех.
 *
 * Старше недели — тоже отбрасывается: буфер устройства столько не живёт, и
 * такое значение говорит о сбитых часах, а не о долгом отсутствии связи.
 *
 * Негодное время НЕ отменяет саму точку. Координата — это факт, зафиксированный
 * устройством, и терять её из-за неверных часов хуже, чем потерять точность
 * времени: created_at всё равно останется, и на карте точка будет видна.
 */
function sanitizeRecordedAt(value?: string): Date | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return undefined;

  const now = Date.now();
  const CLOCK_SKEW_MS = 5 * 60_000;
  const MAX_BUFFER_AGE_MS = 7 * 24 * 60 * 60_000;

  if (at.getTime() > now + CLOCK_SKEW_MS) return undefined;
  if (at.getTime() < now - MAX_BUFFER_AGE_MS) return undefined;
  return at;
}

/**
 * Проверить, что территории из запроса принадлежат этой организации.
 *
 * territories общая для всей платформы, а territoryId приходит от клиента и
 * записывался как есть. Супервайзер организации A звал setWorkZones с
 * диапазоном идентификаторов — строки ложились с его tenant_id и чужими
 * territory_id, — а затем listWorkZones (или сам агент через myWorkZones)
 * возвращал name и color этих территорий: перебором выгружалась структура
 * районов и названия филиалов всех клиентов платформы. Тем же путём чужой
 * territoryId попадал в магазин через createShop и updateMyShop и всплывал
 * названием чужой компании в строке заказа.
 *
 * Одним запросом на весь список, а не по запросу на территорию: в рабочие зоны
 * приходят десятки идентификаторов, и цикл с отдельным SELECT сделал бы защиту
 * самой медленной частью операции — то есть первым кандидатом на удаление при
 * жалобе на скорость.
 *
 * Это половина защиты. Вторая — условие по организации в соединениях на чтении:
 * в базе уже лежат ссылки, записанные до этой правки. Идентификаторов чужих
 * территорий в тексте ошибки нет: иначе сообщение само стало бы каналом утечки.
 */
async function assertTenantOwnsTerritories(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  territoryIds: number[],
): Promise<void> {
  const unique = [...new Set(territoryIds)];
  if (unique.length === 0) return;

  const found = await db.select({ id: territories.id }).from(territories)
    .where(and(inArray(territories.id, unique), eq(territories.tenantId, tenantId)));

  if (found.length !== unique.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: unique.length === 1
        ? "Территория не найдена в вашей организации"
        : "Часть территорий не найдена в вашей организации",
    });
  }
}

/**
 * Проверить, что сотрудник из запроса принадлежит этой организации.
 *
 * Тот же изъян, что и с территориями: agentId приходит от клиента, users общая
 * для платформы. Без проверки рабочие зоны навешивались на чужого сотрудника —
 * и он же оказывался в выдаче listWorkZones этой организации.
 */
async function assertTenantOwnsUser(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  userId: number,
): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Сотрудник не найден в вашей организации" });
  }
}

/**
 * Справочник магазинов для пикеров: поиск и окно на сервере.
 *
 * Раньше и availableShops, и listAllShops отдавали ВСЕ активные магазины
 * организации — у крупного клиента это около трёх тысяч строк — без окна и без
 * кэша. Агент открывал экран создания заказа в поле, на медленном канале ждал
 * десятки секунд, и после каждой правки любого магазина react-query сбрасывал
 * ключ и всё повторялось; несколько агентов одновременно давали один и тот же
 * полный запрос снова и снова.
 *
 * Поля необязательные, потому что оба маршрута зовёт мобильное приложение без
 * аргументов: подпись сохранена, ответ по-прежнему массив.
 *
 * Умолчания limit нет намеренно. Молча обрезанный справочник в пикере заказа —
 * это магазин, для которого агент физически не может оформить заказ, и такую
 * поломку в поле не с чем связать. Клиент сужает выборку через search, а
 * повторные запросы снимает кэш ниже.
 */
const shopDirectoryInput = z.object({
  search: z.string().max(255).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  offset: z.number().int().min(0).optional(),
}).optional();

type ShopDirectoryInput = z.infer<typeof shopDirectoryInput>;

/**
 * Одна выборка активных магазинов на два маршрута.
 *
 * Ключ кэша начинается с `shops:<tenantId>` не случайно: shop-router и
 * import-router уже сбрасывают весь этот префикс после любой правки магазина,
 * поэтому справочник инвалидируется вместе с постраничным списком, и заводить
 * второй, забываемый механизм не пришлось.
 */
async function listActiveShops(tenantId: number, input: ShopDirectoryInput) {
  const search = input?.search?.trim();
  const cacheKey = `shops:${tenantId}:directory:${search ?? ""}:${input?.limit ?? ""}:${input?.offset ?? ""}`;

  return withCache(cacheKey, CacheTTL.shops, async () => {
    const conditions = [eq(shops.tenantId, tenantId), eq(shops.status, "active")];
    if (search) {
      const pattern = `%${sanitizeSearch(search)}%`;
      conditions.push(sql`(${shops.name} LIKE ${pattern} OR ${shops.ownerName} LIKE ${pattern} OR ${shops.phone} LIKE ${pattern})`);
    }

    const query = getDb().select({
      id: shops.id, name: shops.name, ownerName: shops.ownerName,
      phone: shops.phone, address: shops.address, city: shops.city,
      district: shops.district, status: shops.status,
      photoUrl: photoRef("shop", shops.id, shops.photoUrl, shops.updatedAt),
      debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
    })
      .from(shops)
      .where(and(...conditions))
      // Порядок задан явно: без него limit/offset выбирали бы каждый раз
      // случайное подмножество, и вторая страница могла повторить первую.
      .orderBy(shops.name);

    if (input?.limit !== undefined) return query.limit(input.limit).offset(input.offset ?? 0);
    return query;
  });
}

/** Роли, которым положено видеть планы всей команды, а не только свои. */
const PLAN_SUPERVISORS = ["ceo", "supervisor", "superadmin"];

/**
 * Чьи планы визитов показывать.
 *
 * Здесь стояло:
 *
 *     const agentId = input?.agentId ?? (isPrivileged ? undefined : ctx.user.id);
 *
 * Оператор `??` подставляет своё значение только когда agentId НЕ прислан.
 * Прислали — берётся присланное, кем бы ни был спрашивающий. То есть агент,
 * мерчандайзер или курьер, подставив чужой agentId, получал его план визитов
 * целиком: названия магазинов, адреса, города и поле shops.debt — сумму долга
 * торговой точки. Идентификаторы идут по порядку, так что за десяток запросов
 * выгружалась коммерческая карта всей компании.
 *
 * Отказ, а не тихая подмена на свой идентификатор. Подмена скрыла бы попытку:
 * запросивший чужие планы получил бы свои и не понял, что произошло, — а в
 * журнале не осталось бы и следа. FORBIDDEN называет вещи своими именами.
 *
 * Тот же вопрос двумя десятками строк ниже (updatePlanStatus, saveVisitPhoto)
 * решён верно — через `if (!isPrivileged) conditions.push(...)`. Значит здесь
 * был недосмотр, а не замысел.
 */
function resolvePlanAgentFilter(
  ctx: { user: { id: number; role: string } },
  requestedAgentId: number | undefined,
): number | undefined {
  if (PLAN_SUPERVISORS.includes(ctx.user.role)) {
    return requestedAgentId; // undefined — значит вся команда
  }
  if (requestedAgentId !== undefined && requestedAgentId !== ctx.user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Можно смотреть только свои планы визитов.",
    });
  }
  return ctx.user.id;
}

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

  /** All agents with their assigned territories in one query */
  listAgentsWithZones: supervisorQuery.query(async ({ ctx }) => {
    const db = getDb();
    const agents = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "agent"), eq(users.status, "active")))
      .limit(500);

    if (agents.length === 0) return [];

    const rows = await db.select({
      agentId:     agentTerritories.agentId,
      territoryId: territories.id,
      name:        territories.name,
      color:       territories.color,
    })
      .from(agentTerritories)
      .innerJoin(territories, eq(agentTerritories.territoryId, territories.id))
      .where(eq(agentTerritories.tenantId, ctx.tenant.id));

    const zoneMap = new Map<number, { id: number; name: string; color: string | null }[]>();
    for (const r of rows) {
      const list = zoneMap.get(r.agentId) ?? [];
      list.push({ id: r.territoryId, name: r.name, color: r.color });
      zoneMap.set(r.agentId, list);
    }

    return agents.map((a) => ({
      ...a,
      zones: zoneMap.get(a.id) ?? [],
    }));
  }),

  // Same reasoning as listAgents — supervisor only needs name+city for the
  // shop picker, not the full shop.list (operator-only) response.
  listShopsForPlan: supervisorQuery.query(async ({ ctx }) => {
    return getDb().select({ id: shops.id, name: shops.name, city: shops.city })
      .from(shops)
      .where(and(eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active")));
  }),

  // Supervisor: full shop list for the Shops tab (same fields as agent.myShops)
  listAllShops: supervisorQuery
    .input(shopDirectoryInput)
    .query(async ({ input, ctx }) => {
      return listActiveShops(ctx.tenant.id, input);
    }),

  // Agent: list shops assigned to this agent
  myShops: fieldSalesQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: shops.id, name: shops.name, ownerName: shops.ownerName,
      phone: shops.phone, address: shops.address, city: shops.city,
      district: shops.district, status: shops.status,
      photoUrl: photoRef("shop", shops.id, shops.photoUrl, shops.updatedAt),
      debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
    })
      .from(shops)
      .where(and(eq(shops.tenantId, ctx.tenant.id), eq(shops.status, "active"), eq(shops.agentId, ctx.user.id)));
  }),

  // All active shops in tenant — for order creation & shop picker
  availableShops: fieldSalesQuery
    .input(shopDirectoryInput)
    .query(async ({ input, ctx }) => {
      return listActiveShops(ctx.tenant.id, input);
    }),

  saveLocation: fieldSalesQuery
    .input(z.object({
      lat: z.string().refine(v => { const n = Number(v); return v.trim() !== "" && Number.isFinite(n) && n >= -90 && n <= 90; }, "Широта должна быть от -90 до 90"),
      lng: z.string().refine(v => { const n = Number(v); return v.trim() !== "" && Number.isFinite(n) && n >= -180 && n <= 180; }, "Долгота должна быть от -180 до 180"),
      accuracy: z.string().optional(),
      batteryLevel: z.number().optional(),
      // Когда точка снята устройством. Приходит у точек, пролежавших в буфере
      // без связи; у отправленных сразу его нет и оно не нужно.
      recordedAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await getDb().insert(agentLocations).values({
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,
        lat:      input.lat,
        lng:      input.lng,
        accuracy: input.accuracy,
        batteryLevel: input.batteryLevel,
        recordedAt: sanitizeRecordedAt(input.recordedAt),
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
    
    // Окно в сутки.
    //
    // Раньше условия по времени тут не было, и max(id) на агента считался по
    // всему диапазону индекса tenant_id. За год у клиента с тридцатью агентами
    // в agent_locations накапливается порядка 2,4 млн строк (точка раз в две
    // минуты × рабочий день × тридцать агентов), удалять их нечему. Экран
    // трекинга опрашивает этот маршрут каждые 15 секунд с мобильного и каждые
    // 30 с веба: два открытых экрана — примерно шесть полных проходов в минуту,
    // непрерывно.
    //
    // Сутки, а не час: агент мог не выходить на связь с вечера, и вчерашняя
    // точка на карте «где все сейчас» ещё что-то значит. Точка старше суток не
    // значит уже ничего, зато условие по created_at ложится на существующий
    // idx_locations_tenant_created и превращает полный проход в короткий срез.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // First get the max IDs per agent
    const maxIds = await db.select({
      agentId: agentLocations.agentId,
      maxId: sql<number>`max(${agentLocations.id})`,
    })
      .from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, ctx.tenant.id),
        gte(agentLocations.createdAt, since),
      ))
      .groupBy(agentLocations.agentId);

    if (maxIds.length === 0) return [];

    const ids = maxIds.map(m => m.maxId);

    // Then get the full records for those IDs
    const results = await db.select({
      id: agentLocations.id, agentId: agentLocations.agentId,
      lat: agentLocations.lat, lng: agentLocations.lng,
      accuracy: agentLocations.accuracy, batteryLevel: agentLocations.batteryLevel,
      createdAt: agentLocations.createdAt,
      recordedAt: agentLocations.recordedAt,
      // Время съёмки, если оно известно, иначе время получения сервером. У
      // точек, пролежавших в буфере без связи, это разные вещи: карта должна
      // показывать, когда агент там был, а не когда телефон дозвонился.
      at: sql<Date>`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`,
      agentName: users.name,
    })
      .from(agentLocations)
      .leftJoin(users, and(eq(agentLocations.agentId, users.id), eq(users.tenantId, ctx.tenant.id)))
      .where(sql`${agentLocations.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(sql`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`));

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
        recordedAt: agentLocations.recordedAt,
      // Время съёмки, если оно известно, иначе время получения сервером. У
      // точек, пролежавших в буфере без связи, это разные вещи: карта должна
      // показывать, когда агент там был, а не когда телефон дозвонился.
        at: sql<Date>`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`,
      })
        .from(agentLocations)
        .where(and(
          eq(agentLocations.tenantId, ctx.tenant.id),
          eq(agentLocations.agentId, input.agentId),
          // Границы периода тоже по времени съёмки: иначе точка, снятая в два
          // часа дня и залитая в шесть вечера, не попала бы в запрос за
          // дневной отрезок — то есть именно тот случай, ради которого поле и
          // заведено.
          sql`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt}) >= ${start}`,
          sql`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt}) <= ${end}`,
        ))
        .orderBy(sql`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`);
    }),

  getPlans: fieldSalesQuery
    .input(z.object({ agentId: z.number().optional(), date: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const dateStr = input?.date ?? new Date().toISOString().split("T")[0];
      const agentId = resolvePlanAgentFilter(ctx, input?.agentId);

      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        onDate(dailyPlans.planDate, dateStr),
      ];
      if (agentId !== undefined) {
        conditions.push(eq(dailyPlans.agentId, agentId));
      }

      return getDb().select({
        // photoUrl is deliberately not selected: visit photos are base64 blobs of up
        // to 5 MB and nothing in the plan list renders them.
        id: dailyPlans.id, planDate: dailyPlans.planDate, status: dailyPlans.status,
        notes: dailyPlans.notes, createdAt: dailyPlans.createdAt,
        shopName: shops.name, shopAddress: shops.address, shopDebt: shops.debt,
        shopCity: shops.city, agentName: users.name, shopId: dailyPlans.shopId,
        // Без agentId экран супервайзера складывал планы ВСЕХ агентов в одну
        // группу: он группирует по p.agentId, а поле не приезжало, и
        // `p.agentId ?? 0` давало ноль для каждой строки. Заметить было нечем —
        // вывод типов на клиенте был сломан и отдавал {} (см. lib/cache.ts).
        agentId: dailyPlans.agentId,
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
      const agentId = resolvePlanAgentFilter(ctx, input.agentId);

      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        onDate(dailyPlans.planDate, dateStr),
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
      const withDistance = plans.map(p => {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!lat || !lng) return { ...p, distance: 9999 };

        const distance = haversineKm(input.currentLat, input.currentLng, lat, lng);
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

          const dist = haversineKm(currentLat, currentLng, lat, lng);

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

      // Calculate total distance (inter-stop distances, not from origin)
      let totalDistance = 0;
      let prevLat = input.currentLat;
      let prevLng = input.currentLng;
      let noGpsCount = 0;
      for (let i = 0; i < sorted.length; i++) {
        const lat = Number(sorted[i].lat);
        const lng = Number(sorted[i].lng);
        if (!lat || !lng) { noGpsCount++; continue; }
        totalDistance += haversineKm(prevLat, prevLng, lat, lng);
        prevLat = lat;
        prevLng = lng;
      }

      return {
        plans: sorted,
        totalDistance: Math.round(totalDistance * 10) / 10,
        totalStops: sorted.length,
        noGpsCount,
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
      // Stamped only on the way in to "visited", and cleared if the plan is
      // moved back — a stale timestamp on a plan that is no longer visited
      // would show up in the report as a visit that never happened.
      await getDb().update(dailyPlans)
        .set({
          status: input.status,
          visitedAt: input.status === "visited" ? new Date() : null,
        })
        .where(and(...conditions));
      return { success: true };
    }),

  // ── Visit Photo Proof ───────────────────────────────────────────────────────
  saveVisitPhoto: merchVisitQuery
    .input(z.object({ planId: z.number(), photoUrl: z.string().url().or(z.string().startsWith("data:image/")).refine(v => v.length <= 5_000_000, "Файл слишком большой (макс. 5 МБ)"), notes: z.string().optional() }))
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
      const db = getDb();

      // Run fraud check before saving visit
      if (!isPrivileged) {
        const [plan] = await db.select({ agentId: dailyPlans.agentId, planDate: dailyPlans.planDate })
          .from(dailyPlans).where(and(eq(dailyPlans.id, input.planId), eq(dailyPlans.tenantId, ctx.tenant.id)))
          .limit(1);
        if (plan) {
          const dayStart = new Date(new Date(plan.planDate).toISOString().slice(0, 10));
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const gpsPings = await db.select({
            lat: agentLocations.lat,
            lng: agentLocations.lng,
            createdAt: agentLocations.createdAt,
          }).from(agentLocations)
            .where(and(
              eq(agentLocations.tenantId, ctx.tenant.id),
              eq(agentLocations.agentId, plan.agentId!),
              gte(agentLocations.createdAt, dayStart),
              lte(agentLocations.createdAt, dayEnd),
            ))
            .orderBy(agentLocations.createdAt);

          const check = await verifyVisit(db, input.planId, ctx.tenant.id, gpsPings, input.photoUrl);
          if (check.fraudScore >= 70) {
            throw new Error(`Визит заблокирован системой фрод-мониторинга: ${check.reasons.join("; ")}`);
          }
        }
      }

      await db.update(dailyPlans).set({
        status: "visited",
        photoUrl: input.photoUrl,
        notes: input.notes ?? undefined,
      }).where(and(...conditions));
      return { success: true };
    }),

  createPlan: supervisorQuery
    .input(z.object({ agentId: z.number(), shopId: z.number(), planDate: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // Validate that agentId belongs to this tenant
      const [agent] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.agentId), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (!agent) throw new Error("Агент не найден в вашем тенанте");

      // Validate that shopId belongs to this tenant
      const [shop] = await db.select({ id: shops.id }).from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id))).limit(1);
      if (!shop) throw new Error("Магазин не найден в вашем тенанте");

      // Check for duplicate plan (same agent + shop + date)
      const [existing] = await db.select({ id: dailyPlans.id }).from(dailyPlans)
        .where(and(
          eq(dailyPlans.tenantId, ctx.tenant.id),
          eq(dailyPlans.agentId, input.agentId),
          eq(dailyPlans.shopId, input.shopId),
          eq(dailyPlans.planDate, new Date(input.planDate)),
        )).limit(1);
      if (existing) throw new Error("План для этого агента и магазина на эту дату уже существует");

      const [result] = await db.insert(dailyPlans).values({
        tenantId:  ctx.tenant.id,
        agentId:   input.agentId,
        shopId:    input.shopId,
        planDate:  new Date(input.planDate),
        notes:     input.notes ? sanitizeString(input.notes) : null,
        createdBy: ctx.user.id,
      });
      return { id: Number(result.insertId) };
    }),

  /**
   * Назначить план сразу по нескольким магазинам — обычно по целой территории.
   *
   * Оба клиента раньше звали createPlan в цикле, по вызову на магазин. Район на
   * сорок магазинов — сорок мутаций подряд, и это ломалось двумя способами.
   * Первый: у любого уже запланированного магазина createPlan бросает ошибку,
   * цикл обрывается на середине, часть планов создана, супервайзер видит только
   * отказ и не знает, что именно записалось. Второй: сорок мутаций за секунды
   * съедают лимит мутаций, и вторая территория за смену просто не назначается.
   *
   * Здесь один вызов: проверка принадлежности арендатору одним запросом,
   * поиск уже существующих планов одним запросом, вставка остальных одной
   * вставкой. Уже назначенный магазин — не ошибка, а пропуск: назначить
   * территорию, где часть точек уже в плане, это нормальное действие, а не
   * промах пользователя. Сколько записано и сколько пропущено, возвращается,
   * чтобы клиент мог сказать это словами.
   */
  createPlans: supervisorQuery
    .input(z.object({
      agentId: z.number(),
      shopIds: z.array(z.number()).min(1).max(500),
      planDate: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const planDate = new Date(input.planDate);
      // TRPCError, а не throw new Error: обработчик ошибок подменяет текст у
      // INTERNAL_SERVER_ERROR на «Внутренняя ошибка сервера», и отказ по делу
      // становится неотличим от падения — ни пользователю, ни в разборе.
      if (Number.isNaN(planDate.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Некорректная дата плана" });
      }

      const [agent] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.agentId), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Агент не найден в вашей организации" });
      }

      // Принадлежность проверяется по всем магазинам сразу, и дальше в работу
      // идут только подтверждённые: чужой id из списка молча отбрасывается,
      // а не создаёт план на магазин другого арендатора.
      const uniqueShopIds = [...new Set(input.shopIds)];
      const ownShops = await db.select({ id: shops.id }).from(shops)
        .where(and(inArray(shops.id, uniqueShopIds), eq(shops.tenantId, ctx.tenant.id)));
      if (ownShops.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ни один из выбранных магазинов не найден в вашей организации" });
      }

      const existing = await db.select({ shopId: dailyPlans.shopId }).from(dailyPlans)
        .where(and(
          eq(dailyPlans.tenantId, ctx.tenant.id),
          eq(dailyPlans.agentId, input.agentId),
          eq(dailyPlans.planDate, planDate),
          inArray(dailyPlans.shopId, ownShops.map(s => s.id)),
        ));
      const alreadyPlanned = new Set(existing.map(e => e.shopId));

      const toInsert = ownShops
        .filter(s => !alreadyPlanned.has(s.id))
        .map(s => ({
          tenantId:  ctx.tenant.id,
          agentId:   input.agentId,
          shopId:    s.id,
          planDate,
          notes:     input.notes ? sanitizeString(input.notes) : null,
          createdBy: ctx.user.id,
        }));

      if (toInsert.length > 0) await db.insert(dailyPlans).values(toInsert);

      return {
        created: toInsert.length,
        skipped: alreadyPlanned.size,
        // Сколько id клиент прислал зря — чужие или несуществующие.
        notFound: uniqueShopIds.length - ownShops.length,
      };
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
      gpsLat:    z.preprocess(v => (v === "" ? undefined : v), z.string().refine(v => { const n = Number(v); return Number.isFinite(n) && n >= -90 && n <= 90; }, "Широта должна быть от -90 до 90").optional()),
      gpsLng:    z.preprocess(v => (v === "" ? undefined : v), z.string().refine(v => { const n = Number(v); return Number.isFinite(n) && n >= -180 && n <= 180; }, "Долгота должна быть от -180 до 180").optional()),
      notes:     z.string().optional(),
      territoryId: z.number().optional(),
      idempotencyKey: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      if (input.territoryId != null) {
        await assertTenantOwnsTerritories(db, tenantId, [input.territoryId]);
      }

      // Тот же приём, что защищает заказ, и по той же причине. Агент нажимает
      // «Создать», строка коммитится, ответ не доходит — связь оборвалась, — он
      // нажимает снова. Без ключа в справочнике появляется второй магазин; с
      // ключом повтор возвращает тот же id, и агент видит успех вместо
      // непонятной ошибки.
      if (input.idempotencyKey) {
        const [existing] = await db.select({ id: shops.id })
          .from(shops)
          .where(and(eq(shops.tenantId, tenantId), eq(shops.idempotencyKey, input.idempotencyKey)))
          .limit(1);
        if (existing) return { id: Number(existing.id), idempotent: true };
      }

      const values = {
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
        territoryId: input.territoryId,
        tenantId,
        agentId:  ctx.user.id,   // автоматически привязываем к агенту
        debt:     "0.00",
        status:   "active" as const,
        idempotencyKey: input.idempotencyKey ?? null,
      };

      try {
        const [result] = await db.insert(shops).values(values);
        // Справочник магазинов теперь отдаётся из кэша с ключом
        // `shops:<tenantId>:…`; без сброса агент, только что создавший точку,
        // не нашёл бы её в пикере заказа до истечения TTL — и решил бы, что
        // магазин не сохранился. Тот же префикс сбрасывают shop-router и
        // import-router.
        cache.invalidatePrefix(`shops:${tenantId}`);
        return { id: Number(result.insertId), idempotent: false };
      } catch (err: unknown) {
        // Проверка выше не закрывает гонку: два ретрая, отправленные почти
        // одновременно, оба видят пусто и оба вставляют. Второго отклоняет
        // уникальный индекс — и это не ошибка, а сообщение «магазин уже создан»,
        // поэтому возвращаем существующий id вместо отказа.
        // Читается по всей цепочке cause: ошибку драйвера drizzle заворачивает
        // в свою, и у обёртки нет ни code, ни sqlMessage.
        if (input.idempotencyKey && isDuplicateEntry(err)) {
          const [existing] = await db.select({ id: shops.id })
            .from(shops)
            .where(and(eq(shops.tenantId, tenantId), eq(shops.idempotencyKey, input.idempotencyKey)))
            .limit(1);
          if (existing) return { id: Number(existing.id), idempotent: true };
        }
        throw err;
      }
    }),

  nearbyShops: fieldSalesQuery
    .input(z.object({ lat: z.number(), lng: z.number(), radius: z.number().default(5) }))
    .query(async ({ input, ctx }) => {
      // Явная проекция вместо select(). Раньше отсюда уезжали ВСЕ колонки, в
      // том числе photo_url типа mediumtext — фотографии магазинов в base64, до
      // 2.8 МБ каждая. Их тянули по сети со всех магазинов агента только чтобы
      // отфильтровать точки по расстоянию, а сами фотографии не использовались
      // ни здесь, ни на экране. photoRef отдаёт ссылку вместо тела картинки —
      // тот же приём, что в myShops и availableShops рядом.
      const agentShops = await getDb().select({
        id: shops.id, name: shops.name, ownerName: shops.ownerName,
        phone: shops.phone, address: shops.address, city: shops.city,
        district: shops.district, status: shops.status,
        photoUrl: photoRef("shop", shops.id, shops.photoUrl, shops.updatedAt),
        debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
      }).from(shops)
        .where(and(eq(shops.agentId, ctx.user.id), eq(shops.tenantId, ctx.tenant.id)));
      return agentShops.filter((shop) => {
        if (!shop.gpsLat || !shop.gpsLng) return false;
        const dist = haversineKm(input.lat, input.lng, Number(shop.gpsLat), Number(shop.gpsLng));
        return dist <= input.radius;
      });
    }),

  // Мобильное приложение: агент смотрит детали любого магазина в тенанте
  getShopById: fieldSalesQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [shop] = await db.select().from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, ctx.tenant.id)))
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
      territoryId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, ...rest } = input;

      if (rest.territoryId != null) {
        await assertTenantOwnsTerritories(db, ctx.tenant.id, [rest.territoryId]);
      }

      const sanitized: Record<string, unknown> = { ...rest };
      if (typeof rest.name === "string") sanitized.name = sanitizeString(rest.name);
      if (typeof rest.ownerName === "string") sanitized.ownerName = sanitizeString(rest.ownerName);
      if (typeof rest.address === "string") sanitized.address = sanitizeString(rest.address);
      if (typeof rest.city === "string") sanitized.city = sanitizeString(rest.city);
      if (typeof rest.district === "string") sanitized.district = sanitizeString(rest.district);
      if (typeof rest.notes === "string") sanitized.notes = sanitizeString(rest.notes);
      if (typeof rest.territoryId === "number") sanitized.territoryId = rest.territoryId;

      // Skip update if no fields to set
      if (Object.keys(sanitized).length === 0) return { success: true };

      await db.update(shops).set(sanitized)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      // Тот же сброс, что и в createShop: иначе агент видел бы в пикере старое
      // название своего магазина до истечения TTL.
      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
      return { success: true };
    }),

  // Мобильное приложение: агент загружает фото ТОЛЬКО своего магазина
  uploadMyShopPhoto: fieldSalesQuery
    .input(z.object({ shopId: z.number(), dataUrl: z.string().url().or(z.string().startsWith("data:image/")).refine(v => v.length <= 2_800_000, "Файл слишком большой (макс. 2 МБ)") }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(shops).set({ photoUrl: input.dataUrl })
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id), eq(shops.agentId, ctx.user.id)));
      // Ссылка на фото в справочнике несёт метку времени updatedAt — без сброса
      // кэша агент после загрузки продолжал бы видеть старую картинку.
      cache.invalidatePrefix(`shops:${ctx.tenant.id}`);
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
      .leftJoin(orders, and(eq(orders.agentId, users.id), sql`${orders.createdAt} >= ${weekAgo}`, inArray(orders.status, REVENUE_ORDER_STATUSES)))
      .leftJoin(dailyPlans, and(eq(dailyPlans.agentId, users.id), sql`${dailyPlans.planDate} >= ${weekAgo}`, eq(dailyPlans.status, "visited")))
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active")))
      .groupBy(users.id)
      .orderBy(desc(sql`count(DISTINCT ${orders.id})`))
      .limit(10);

    // Current user's stats
    const [myStats] = await db.select({
      weeklyOrders: sql<number>`count(DISTINCT ${orders.id})`,
      weeklyRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      monthlyOrders: sql<number>`(SELECT count(*) FROM ${orders} WHERE agent_id = ${ctx.user.id} AND created_at >= ${monthAgo} AND status = 'delivered')`,
    })
      .from(orders)
      .where(and(eq(orders.agentId, ctx.user.id), sql`${orders.createdAt} >= ${weekAgo}`, inArray(orders.status, REVENUE_ORDER_STATUSES)));

    // Calculate streak: consecutive days with at least 1 completed order
    const streakData = await db.select({
      day: sql<string>`DATE(${orders.createdAt})`,
      count: sql<number>`count(*)`,
    })
      .from(orders)
      .where(and(
        eq(orders.agentId, ctx.user.id),
        inArray(orders.status, REVENUE_ORDER_STATUSES),
        sql`${orders.createdAt} >= ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()}`,
      ))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(desc(sql`DATE(${orders.createdAt})`));

    let streak = 0;
    // Start from the most recent active day, not necessarily today
    for (let i = 0; i < streakData.length; i++) {
      const expectedDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      if (streakData[i]?.day === expectedDate && Number(streakData[i]?.count) > 0) {
        streak++;
      } else if (i === 0 && streakData[0]?.day !== expectedDate) {
        // Today has no orders yet — check if yesterday started a streak
        // Skip the gap and start counting from the last active day
        continue;
      } else {
        break;
      }
    }

    // Achievements
    const achievements = [];
    const totalAllTime = await db.select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.agentId, ctx.user.id), inArray(orders.status, REVENUE_ORDER_STATUSES)));

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
      .leftJoin(orders, and(eq(orders.agentId, users.id), sql`${orders.createdAt} >= ${monthAgo}`, inArray(orders.status, REVENUE_ORDER_STATUSES)))
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

  /** Get work zones (territories) for a specific agent */
  listWorkZones: supervisorQuery
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input, ctx }) => {
      return getDb().select({
        id: territories.id,
        name: territories.name,
        color: territories.color,
      })
        .from(agentTerritories)
        // Условие по организации в самом соединении. Строка agent_territories
        // несёт свой tenant_id, но territory_id в ней мог быть чужим — и тогда
        // соединение отдавало name и color территории другой компании. Здесь
        // соединение внутреннее, поэтому такая строка просто выпадает из
        // выдачи: показать её нечем и показывать нечего.
        .innerJoin(territories, and(
          eq(agentTerritories.territoryId, territories.id),
          eq(territories.tenantId, ctx.tenant.id),
        ))
        .where(and(
          eq(agentTerritories.agentId, input.agentId),
          eq(agentTerritories.tenantId, ctx.tenant.id),
        ))
        .orderBy(territories.name);
    }),

  /** Set work zones for an agent (replaces all) */
  setWorkZones: supervisorQuery
    .input(z.object({
      agentId: z.number(),
      territoryIds: z.array(z.number()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Проверки до удаления старых зон: иначе запрос с чужими территориями
      // сначала стирал у агента реальные рабочие зоны, а потом падал на
      // вставке — и агент оставался вообще без зон.
      await assertTenantOwnsUser(db, ctx.tenant.id, input.agentId);
      await assertTenantOwnsTerritories(db, ctx.tenant.id, input.territoryIds);

      // Remove existing
      await db.delete(agentTerritories)
        .where(and(
          eq(agentTerritories.agentId, input.agentId),
          eq(agentTerritories.tenantId, ctx.tenant.id),
        ));
      // Insert new
      if (input.territoryIds.length > 0) {
        await db.insert(agentTerritories).values(
          input.territoryIds.map(tid => ({
            tenantId: ctx.tenant.id,
            agentId: input.agentId,
            territoryId: tid,
          })),
        );
      }
      return { success: true, count: input.territoryIds.length };
    }),

  /** Agent views own work zones */
  myWorkZones: fieldSalesQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: territories.id,
      name: territories.name,
      color: territories.color,
    })
      .from(agentTerritories)
      // То же условие, что и в listWorkZones: сам агент открывал свои рабочие
      // зоны и получал названия территорий чужой организации, если ему их
      // успели навесить до появления проверки на записи.
      .innerJoin(territories, and(
        eq(agentTerritories.territoryId, territories.id),
        eq(territories.tenantId, ctx.tenant.id),
      ))
      .where(and(
        eq(agentTerritories.agentId, ctx.user.id),
        eq(agentTerritories.tenantId, ctx.tenant.id),
      ))
      .orderBy(territories.name);
  }),
});

// Supervisor: list all agent plans (not just own)

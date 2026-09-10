/* ═══════════════════════════════════════════════════════════════════════════
   GET /api/v1/orders — выгрузка заказов наружу.

   Написано под техническое задание BEKDRINKS (интеграция с супервайзером
   ASTRA). Правила листания, снимка и набора полей — оттуда, и менять их в
   одностороннем порядке нельзя: по ним другая сторона считает долги и срывы.

   ── Два режима, и они разные ────────────────────────────────────────────────

   ПОЛНАЯ ВЫГРУЗКА (раз в сутки, сверка). Набор строк фиксируется снимком —
   «идентификатор не больше такого-то», — и листается курсором по тому же
   полю. Ни одна строка не потеряется и не задвоится, сколько бы заказов ни
   пришло во время выгрузки.

   ЧТО ИЗМЕНИЛОСЬ (каждые пять минут). Отбор по `updated_at >= since`, порядок
   тот же — по идентификатору. Здесь снимка нет по смыслу: смысл режима как раз
   в том, чтобы увидеть новое. Строка, изменившаяся посреди листания, может
   прийти дважды — это доставка «не реже одного раза», и на той стороне она
   складывается по order_id. Сказано в документации прямым текстом.

   Удалённые заказы приходят ТОЛЬКО во втором режиме и с `deleted_at`: в
   полной выгрузке их нет, потому что их нет и в ERP. Без этой метки заказ,
   удалённый после первой сверки, остался бы у получателя навсегда — и долг по
   нему тоже.
   ═══════════════════════════════════════════════════════════════════════════ */
import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { orders, shops, users, territories, warehouses, settings } from "../../db/schema";
import { eq, and, sql, isNull, inArray, gt, lte, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { ORDER_STATUS_LABELS, OPEN_ORDER_STATUSES, REVENUE_ORDER_STATUSES } from "../lib/order-status";
import {
  encodeSnapshot, decodeSnapshot, encodeCursor, decodeCursor,
  parseLimit, parseDayBound, parseStatuses, money, iso,
  MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
  type ExportedOrder,
} from "./order-export";

type Vars = { tenantId: number; scopes: string[] };

export const ordersV1 = new Hono<{ Variables: Vars }>();

const KNOWN_STATUSES = Object.keys(ORDER_STATUS_LABELS);

/** Деньги и склад организации — одним запросом на выгрузку, а не на строку. */
async function tenantMeta(tenantId: number) {
  const db = getDb();
  const [cfg] = await db.select({ currency: settings.currency })
    .from(settings).where(eq(settings.tenantId, tenantId)).limit(1);

  /*
    Склада у заказа нет: в этом продукте продают только с основного склада —
    решение владельца, а не упущение. ТЗ просит warehouse_id, и честный ответ
    здесь — идентификатор того склада, с которого товар и уходит. Склада нет
    вовсе — null, а не выдуманный ноль.
  */
  const [wh] = await db.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .limit(1);

  return { currency: cfg?.currency ?? "UZS", warehouseId: wh?.id ?? null };
}

/**
 * Условия отбора — ОДИН набор на все три запроса страницы.
 *
 * Строки, счёт и сумма обязаны считаться по одному и тому же множеству: разойдись
 * они хоть в одном условии, сверка сумм на той стороне не сойдётся, а причину
 * будут искать в ERP. Ровно поэтому набор собирается здесь, а не переписывается
 * трижды.
 */
function baseConditions(opts: {
  tenantId: number;
  maxId: number | null;
  statuses: string[] | null;
  createdFrom: string | null;
  createdTo: string | null;
  updatedSince: string | null;
  includeDeleted: boolean;
}) {
  const c = [eq(orders.tenantId, opts.tenantId)];
  if (opts.maxId !== null) c.push(lte(orders.id, opts.maxId));
  if (opts.statuses) c.push(inArray(orders.status, opts.statuses as never));
  if (opts.createdFrom) c.push(sql`${orders.createdAt} >= ${opts.createdFrom}`);
  if (opts.createdTo) c.push(sql`${orders.createdAt} <= ${opts.createdTo}`);
  if (opts.updatedSince) c.push(sql`${orders.updatedAt} >= ${opts.updatedSince}`);
  // Удалённые — только там, где их просили: см. разбор в шапке файла.
  if (!opts.includeDeleted) c.push(isNull(orders.deletedAt));
  return c;
}

ordersV1.get("/", async (c) => {
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
  if (!(scopes.includes("read") || scopes.includes("orders"))) {
    return c.json({ error: "Scope 'orders' required" }, 403);
  }

  const db = getDb();
  const q = (name: string) => c.req.query(name) ?? undefined;
  const limit = parseLimit(q("limit"));

  // ── Разбор фильтров ────────────────────────────────────────────────────
  const statuses = parseStatuses(q("status"), KNOWN_STATUSES);
  if (statuses === "invalid") {
    return c.json({
      error: "Unknown status. See GET /api/v1/orders/statuses",
      known: KNOWN_STATUSES,
    }, 400);
  }

  const createdFrom = parseDayBound(q("created_from"), "from");
  const createdTo = parseDayBound(q("created_to"), "to");
  if ((q("created_from") && !createdFrom) || (q("created_to") && !createdTo)) {
    return c.json({ error: "created_from / created_to must be YYYY-MM-DD or ISO 8601" }, 400);
  }

  const updatedSinceRaw = q("updated_since");
  if (updatedSinceRaw && Number.isNaN(Date.parse(updatedSinceRaw))) {
    return c.json({ error: "updated_since must be ISO 8601" }, 400);
  }

  /*
    Склад проверяется, даже если он у заказа один.

    Прислать чужой идентификатор нельзя было и раньше — организация берётся из
    ключа, — но молча принять НЕСУЩЕСТВУЮЩИЙ склад и отдать по нему все заказы
    значит ответить не на тот вопрос. Пункт 5 ТЗ про это прямо.
  */
  const meta = await tenantMeta(tenantId);
  const askedWarehouse = q("warehouse_id");
  if (askedWarehouse !== undefined) {
    const asked = Number(askedWarehouse);
    const [own] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, asked), eq(warehouses.tenantId, tenantId))).limit(1);
    if (!own) return c.json({ error: "Unknown warehouse_id for this company" }, 404);
  }

  // ── Режим и снимок ─────────────────────────────────────────────────────
  const incremental = Boolean(updatedSinceRaw);
  const cursorRaw = q("cursor");
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return c.json({ error: "Malformed cursor" }, 400);

  let snapshotId = q("snapshot_id") ?? cursor?.snapshotId ?? "";
  let snapshot = snapshotId ? decodeSnapshot(snapshotId) : null;
  if (snapshotId && !snapshot) return c.json({ error: "Malformed snapshot_id" }, 400);

  /*
    Курсор принадлежит своему снимку, и чужой не принимается.

    Подставь курсор от вчерашней выгрузки в сегодняшнюю — и набор поедет: часть
    заказов не придёт вовсе, а выглядеть это будет как пропажа данных на нашей
    стороне. ТЗ требует привязки прямым текстом (пункт 10).
  */
  if (cursor && snapshotId && cursor.snapshotId !== snapshotId) {
    return c.json({ error: "Cursor belongs to another snapshot_id" }, 400);
  }

  if (!incremental && !snapshot) {
    // Новая полная выгрузка: фиксируем границу набора здесь и сейчас.
    const [row] = await db.select({ maxId: sql<number>`COALESCE(MAX(${orders.id}), 0)` })
      .from(orders).where(eq(orders.tenantId, tenantId));
    snapshot = { maxId: Number(row?.maxId ?? 0), asOf: new Date().toISOString() };
    snapshotId = encodeSnapshot(snapshot);
  }

  const conditions = baseConditions({
    tenantId,
    maxId: incremental ? null : snapshot!.maxId,
    statuses: statuses ?? null,
    createdFrom,
    createdTo,
    updatedSince: updatedSinceRaw ?? null,
    // Удалённые нужны только режиму изменений — иначе получатель не узнает,
    // что заказ исчез, и продолжит считать по нему долг.
    includeDeleted: incremental,
  });

  // ── Страница ───────────────────────────────────────────────────────────
  const agent = alias(users, "agent");
  const courier = alias(users, "courier");

  const page = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    total: orders.total,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
    deliveredAt: orders.deliveredAt,
    deletedAt: orders.deletedAt,
    shopId: orders.shopId,
    shopName: shops.name,
    territoryId: shops.territoryId,
    territoryName: territories.name,
    agentId: orders.agentId,
    agentName: agent.name,
    courierId: orders.courierId,
    courierName: courier.name,
  })
    .from(orders)
    /*
      Соединения ЛЕВЫЕ и с проверкой организации во втором доводе.

      Внутреннее соединение выкинуло бы заказ, у которого магазин или сотрудник
      удалён, — то есть данные молча не сошлись бы с ERP по числу строк, а это
      первый пункт приёмки. Условие по организации внутри соединения, а не в
      WHERE: без него имя пришло бы из чужой организации, а перенос условия в
      WHERE выкинул бы строку целиком.
    */
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .leftJoin(territories, and(eq(shops.territoryId, territories.id), eq(territories.tenantId, tenantId)))
    .leftJoin(agent, and(eq(orders.agentId, agent.id), eq(agent.tenantId, tenantId)))
    .leftJoin(courier, and(eq(orders.courierId, courier.id), eq(courier.tenantId, tenantId)))
    .where(and(...conditions, gt(orders.id, cursor?.lastId ?? 0)))
    // По идентификатору: он не меняется никогда, а created_at у заказа второго
    // круга двигается (services/order-reopen.ts) — порядок по нему поехал бы.
    .orderBy(asc(orders.id))
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;

  const data: ExportedOrder[] = rows.map(r => ({
    order_id: Number(r.id),
    order_number: r.orderNumber,
    company_id: tenantId,
    warehouse_id: meta.warehouseId,
    created_at: iso(r.createdAt)!,
    updated_at: iso(r.updatedAt)!,
    status: r.status,
    amount: money(r.total),
    currency: meta.currency,
    shop_id: Number(r.shopId),
    sales_agent_id: r.agentId == null ? null : Number(r.agentId),

    shop_name: r.shopName ?? null,
    sales_agent_name: r.agentName ?? null,
    territory_id: r.territoryId == null ? null : Number(r.territoryId),
    territory_name: r.territoryName ?? null,

    courier_id: r.courierId == null ? null : Number(r.courierId),
    courier_name: r.courierName ?? null,
    // Поля в системе нет — см. разбор в ExportedOrder. Догадку не подставляем.
    promised_delivery_at: null,
    delivered_at: iso(r.deliveredAt),

    ...(incremental ? { deleted_at: iso(r.deletedAt) } : {}),
  }));

  // ── Итоги по ТОМУ ЖЕ набору ────────────────────────────────────────────
  /*
    Счёт, суммы и разбивка по статусам считаются без курсора: они относятся ко
    ВСЕЙ выгрузке, а не к странице. По ним другая сторона и сверяется — пункт
    11 ТЗ.
  */
  const [totals] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
  }).from(orders).where(and(...conditions));

  const byStatus = await db.select({
    status: orders.status,
    count: sql<number>`count(*)`,
  }).from(orders).where(and(...conditions)).groupBy(orders.status);

  const statusCounts: Record<string, number> = {};
  for (const s of KNOWN_STATUSES) statusCounts[s] = 0;
  for (const r of byStatus) statusCounts[r.status] = Number(r.count);

  const nextCursor = hasMore && rows.length > 0
    ? encodeCursor({
        lastId: Number(rows[rows.length - 1].id),
        snapshotId,
        updatedSince: updatedSinceRaw,
      })
    : null;

  return c.json({
    // Время сервера — чтобы получатель мог назначить следующий updated_since
    // от НАШИХ часов, а не от своих: расхождение в минуту теряет заказы.
    server_time: new Date().toISOString(),
    mode: incremental ? "changes" : "snapshot",
    snapshot_id: incremental ? null : snapshotId,
    as_of: incremental ? null : snapshot!.asOf,
    updated_since: updatedSinceRaw ?? null,

    data,
    next_cursor: nextCursor,
    has_more: hasMore,
    total_count: Number(totals?.count ?? 0),
    status_counts: statusCounts,
    orders_amount_total: money(totals?.amount),
    currency: meta.currency,
  });
});

/**
 * Словарь статусов — пункт 9 ТЗ.
 *
 * Отдаётся машиной, а не пересказывается в переписке: список статусов у
 * продукта меняется, и документ, живущий отдельно, устаревает молча.
 */
ordersV1.get("/statuses", (c) => {
  return c.json({
    statuses: KNOWN_STATUSES.map(code => ({
      code,
      name_ru: ORDER_STATUS_LABELS[code as keyof typeof ORDER_STATUS_LABELS],
      /*
        «Активный» — заказ, по которому товар ещё в игре: он числится за
        складом и может уехать. Это НЕ значит «просрочен»: просрочка меряется
        обещанным сроком, которого в системе нет (пункт 9 ТЗ).
      */
      active: (OPEN_ORDER_STATUSES as readonly string[]).includes(code),
      /* Выручкой считается только доставленный — тем же правилом, что и во
         всех денежных отчётах продукта. */
      counts_as_revenue: (REVENUE_ORDER_STATUSES as readonly string[]).includes(code),
    })),
    active_statuses: [...OPEN_ORDER_STATUSES],
    notes: {
      lateness: "promised_delivery_at is not stored by this ERP and is always null; lateness cannot be derived",
      agent_vs_courier: "sales_agent_id and courier_id are different people and may both be set",
      deleted: "deleted orders appear only with updated_since, carrying deleted_at",
    },
    page_size: { default: DEFAULT_PAGE_SIZE, max: MAX_PAGE_SIZE },
  });
});

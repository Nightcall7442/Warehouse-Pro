import { TRPCError } from "@trpc/server";
import { and, eq, ne, or, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  products, warehouseStock, warehouses, users, settings, orders, orderItems,
  purchaseOrders, purchaseOrderItems, arrivals, arrivalItems, suppliers,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { sseBus } from "../lib/sse";
import { markLowStockAlerted } from "./stock-ledger";
import { inTransitByProduct } from "./stock-transfer";

/*
  Точка заказа — одна.

  ── Что было ────────────────────────────────────────────────────────────────

  Три формулы. Порог на товаре (products.reorder_point) — его писала карточка,
  читала половина экранов: где-то `<`, где-то `<=`. Порог на строке склада
  (warehouse_stock.reorder_point) — не писал никто, читали бот в Telegram
  («что заканчивается» отвечал только про нули) и отчёт дозаказа. И третья —
  «динамическая», из скорости продаж за 30 дней, в том же отчёте.

  Уведомление «остаток ниже точки» посылалось только при РУЧНОМ списании
  (StockService.adjust). Главный путь вниз — отгрузка по заказу — молчал.

  ── Как теперь ──────────────────────────────────────────────────────────────

  Правило одно: товар заканчивается, когда на ОСНОВНОМ складе
  available <= reorder_point и reorder_point > 0. Порог — на товаре, в
  карточке; скорость продаж остаётся подсказкой «рекомендуемый порог» в
  отчёте, а не вторым правилом. Основной склад — потому что продают только с
  него (ADR 0008): сумма по всем складам обещала бы товар, которого на
  отгрузке нет.

  Уведомление — кроном раз в полчаса, по факту пересечения точки, с какого
  бы пути остаток ни ушёл вниз; ровно одно на пересечение
  (warehouse_stock.low_stock_alerted_at), и сбрасывается, когда остаток
  вернулся выше точки.
*/

type Db = ReturnType<typeof getDb>;

/**
 * Порог для нового товара, если в карточке не указали: из настроек
 * организации (settings.defaultReorderPoint), иначе 10. Настройка была
 * заведена и не читалась нигде — то есть не действовала.
 */
export async function defaultReorderPoint(db: Db, tenantId: number): Promise<string> {
  const [row] = await db.select({ v: settings.defaultReorderPoint }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  const n = Number(row?.v ?? 0);
  return n > 0 ? n.toFixed(2) : "10.00";
}

/** Условие «заканчивается» — одно на все экраны, отчёты, бота и крон. */
export function lowStockCondition() {
  return and(
    sql`${products.reorderPoint} > 0`,
    sql`${warehouseStock.available} <= ${products.reorderPoint}`,
  );
}

/**
 * Условие «на основном складе» — для строк warehouse_stock.
 *
 * Экраны, бот и сводка «что заканчивается» остаются на основном складе и при
 * точках продаж (ADR 0012): их ответ — список товаров, и строка на каждый
 * склад задвоила бы товар без имени склада (мобилка читает reorderAlerts
 * этой же формы). Тревога крона ниже — по каждому складу продаж.
 */
export function onDefaultWarehouse(tenantId: number) {
  return sql`${warehouseStock.warehouseId} IN (SELECT id FROM ${warehouses} WHERE ${warehouses.tenantId} = ${tenantId} AND ${warehouses.isDefault} = 1)`;
}

export interface LowStockRow {
  tenantId: number;
  stockId: number;
  productId: number;
  productName: string;
  unit: string;
  available: string;
  reorderPoint: string;
}

/** Что заканчивается у организации — на основном складе, по одному правилу. */
export async function lowStockRows(db: Db, tenantId: number, limit = 100): Promise<LowStockRow[]> {
  return db.select({
    tenantId: warehouseStock.tenantId,
    stockId: warehouseStock.id,
    productId: products.id,
    productName: products.name,
    unit: products.unit,
    available: warehouseStock.available,
    reorderPoint: products.reorderPoint,
  })
    .from(warehouseStock)
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(warehouseStock.tenantId, tenantId), eq(products.status, "active"), onDefaultWarehouse(tenantId), lowStockCondition()))
    .orderBy(sql`${warehouseStock.available} / NULLIF(${products.reorderPoint}, 0)`)
    .limit(limit);
}

/*
  Сколько дозаказать — «Дозаказ» на складе и черновики заказов поставщикам.

  ── Что было ────────────────────────────────────────────────────────────────

  reorderSuggestions считал «2 × порог − остаток» по ФИЗИЧЕСКОМУ остатку и
  по всем складам сразу, если склад не выбран: один товар приходил строкой
  на каждый склад, а зарезервированное под заказы магазинов считалось
  лежащим на полке. И не знал, что уже едет: заказ поставщику, согласованный
  вчера, предлагался снова — и его заказывали дважды.

  ── Как теперь ──────────────────────────────────────────────────────────────

  Склад — выбранный, иначе основной (с него продают, ADR 0008). Какие
  товары — то же одно правило lowStockCondition(). Сколько:

      цель           = максимум запаса товара, а если не задан — 2 × точка;
      в пути         = неполученный остаток согласованных заказов поставщикам
                       на этот склад (согласован, принят частично) + приходы
                       без заказа, ещё не проведённые, на этот склад +
                       перемещения «в пути» на этот склад;
      не согласовано = количество в черновиках и заказах на согласовании на
                       этот склад — с номерами заказов;
      заказать       = цель − свободно − в пути − не согласовано, не меньше
                       нуля, вверх до целой упаковки (если тара задана),
                       иначе до целой единицы у штучных и до сотых у весовых.

  Приход по заказу в «в пути» отдельно не считается: он уже сидит в остатке
  заказа и уменьшит его при проведении — иначе тот же товар считался бы
  дважды.

  Перемещение «в пути» (отправлено, не принято) — тоже едет на склад: с
  отправителя товар уже списан, на получателе ещё не числится. Без него
  филиал, к которому основной склад везёт машину сахара, видел бы нехватку
  и заказывал тот же сахар у завода второй раз.

  Продажи в день — по заказам этого склада (ADR 0012: у заказа свой склад,
  старые заказы без склада — основного). Продажи филиала не торопят
  основной склад, и наоборот; со склада хранения не продают — его «дней до
  нуля» нет.

  Черновик и заказ на согласовании — ещё не «в пути»: товар никто не везёт,
  и так его и не называем. Но и предлагать его снова нельзя: созданные
  отсюда же черновики тут же предлагались бы второй раз, и их заказывали бы
  дважды. Поэтому вычитаются отдельным числом и с номерами заказов: брошенный
  черновик видно, его отменяют — и товар снова предлагается (ADR 0014).

  Поставщик строки — поставщик товара по умолчанию, если он действует;
  иначе тот, кто привёз товар последним (по проведённым приходам с
  поставкой); иначе никто — человек выберет сам.
*/

/** Штучные единицы: дозаказ — целым числом. Вес, объём и длина — до сотых. */
const COUNTABLE_UNITS = new Set(["pcs", "box", "pack", "block"]);

/** Заказ согласован и ещё ждёт товар — его остаток «в пути». */
const INBOUND_PO_STATUSES = ["approved", "partially_received"] as const;
/** Заказ ещё не согласован — его количество «не согласовано»: не едет, но и второй раз не предлагается. */
const UNAPPROVED_PO_STATUSES = ["draft", "pending_approval"] as const;

export interface ReorderQuantityInput {
  point: number;
  /** Максимум запаса; null — не задан. */
  max: number | null;
  available: number;
  inbound: number;
  /** Сколько единиц в упаковке; null или 0 — тары нет. */
  packSize: number | null;
  unit: string | null;
}

/** Цель и сколько заказать — чистая арифметика, в сотых, чтобы 0,1 + 0,2 не давали хвоста. */
export function reorderQuantity(i: ReorderQuantityInput): { target: number; suggested: number } {
  const cents = (n: number) => Math.round(n * 100);
  const target = i.max != null && i.max > 0 ? i.max : i.point * 2;
  const need = cents(target) - cents(i.available) - cents(i.inbound);
  if (need <= 0) return { target, suggested: 0 };
  const pack = i.packSize != null && i.packSize > 0 ? cents(i.packSize) : 0;
  const step = pack > 0 ? pack : COUNTABLE_UNITS.has(i.unit ?? "pcs") ? 100 : 1;
  return { target, suggested: (Math.ceil(need / step) * step) / 100 };
}

export type SupplierSource = "default" | "last";

// Тип, а не interface: строки уходят в выгрузку Excel как Record<string, unknown>.
export type ReorderPlanRow = {
  productId: number;
  productName: string;
  productCode: string;
  unit: string | null;
  packSize: string | null;
  currentStock: string;
  available: string;
  reorderPoint: string;
  reorderMax: string | null;
  unitPrice: string;
  costPrice: string;
  /** Продажи в день за 30 дней — строкой с одним знаком, как раньше. */
  avgDailySales: string;
  /** По свободному остатку; 999 — продаж не было. */
  daysUntilStockout: number;
  target: number;
  /** В пути: согласованные заказы, приходы без заказа и перемещения на этот склад. */
  inbound: number;
  /** В черновиках и на согласовании — вычтено из «заказать», но не «в пути». */
  unapproved: number;
  /** Какие заказы держат «не согласовано»: их открывают и отменяют брошенные. */
  unapprovedOrders: Array<{ id: number; number: string; status: string; qty: number }>;
  suggestedQty: number;
  suggestedCost: number;
  supplierId: number | null;
  supplierName: string | null;
  /** Откуда поставщик: из карточки товара или по последнему приходу. */
  supplierSource: SupplierSource | null;
  warehouseId: number;
};

type ResultRows<T> = [T[], unknown];

/**
 * План дозаказа склада (см. разбор выше). Пустой список — у организации нет
 * основного склада; чужой склад — «не найден».
 */
export async function reorderPlan(db: Db, tenantId: number, warehouseId?: number): Promise<ReorderPlanRow[]> {
  const whCols = { id: warehouses.id, isDefault: warehouses.isDefault };
  const [defaultWh] = await db.select(whCols).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  let wh = defaultWh;
  if (warehouseId) {
    [wh] = await db.select(whCols).from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
    if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });
  }
  if (!wh) return [];
  const whId = Number(wh.id);
  const defaultWhId = defaultWh ? Number(defaultWh.id) : null;

  const days30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = await db.select({
    productId: products.id,
    productName: products.name,
    productCode: products.code,
    unit: products.unit,
    packSize: products.packSize,
    currentStock: warehouseStock.currentStock,
    available: warehouseStock.available,
    reorderPoint: products.reorderPoint,
    reorderMax: products.reorderMax,
    unitPrice: products.unitPrice,
    costPrice: products.costPrice,
    defaultSupplierId: products.defaultSupplierId,
    avgDailySales: sql<string>`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} ON ${orderItems.orderId} = ${orders.id} WHERE ${orderItems.productId} = ${products.id} AND ${orders.tenantId} = ${tenantId} AND ${orders.status} = 'delivered' AND ${orders.createdAt} >= ${days30} AND COALESCE(${orders.warehouseId}, ${defaultWhId}) = ${whId}) / 30, 0)`,
  })
    .from(warehouseStock)
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
    .where(and(
      eq(warehouseStock.tenantId, tenantId),
      eq(warehouseStock.warehouseId, whId),
      eq(products.status, "active"),
      lowStockCondition(),
    ))
    .orderBy(sql`${warehouseStock.available} / NULLIF(${products.reorderPoint}, 0)`);
  if (rows.length === 0) return [];

  const ids = rows.map(r => Number(r.productId));
  const [poOpen, looseArrivals, lastDelivered, transfers] = await Promise.all([
    // Неполученный остаток открытых заказов поставщикам на этот склад — по
    // заказу: у несогласованных нужны номера, у согласованных — только сумма.
    db.select({
      productId: purchaseOrderItems.productId,
      orderId: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      qty: sql<string>`GREATEST(${purchaseOrderItems.quantity} - ${purchaseOrderItems.receivedQty}, 0)`,
    }).from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(and(
        eq(purchaseOrders.tenantId, tenantId),
        eq(purchaseOrders.warehouseId, whId),
        inArray(purchaseOrders.status, [...INBOUND_PO_STATUSES, ...UNAPPROVED_PO_STATUSES]),
        inArray(purchaseOrderItems.productId, ids),
      ))
      .orderBy(purchaseOrders.id),
    // Приходы без заказа, ещё не проведённые: без склада — лягут на основной.
    db.select({
      productId: arrivalItems.productId,
      qty: sql<string>`SUM(GREATEST(COALESCE(${arrivalItems.expectedQuantity}, 0), ${arrivalItems.quantity}))`,
    }).from(arrivalItems)
      .innerJoin(arrivals, eq(arrivals.id, arrivalItems.arrivalId))
      .where(and(
        eq(arrivals.tenantId, tenantId),
        isNull(arrivals.purchaseOrderId),
        ne(arrivals.status, "completed"),
        sql`COALESCE(${arrivals.warehouseId}, ${defaultWhId}) = ${whId}`,
        inArray(arrivalItems.productId, ids),
      ))
      .groupBy(arrivalItems.productId),
    // Кто привёз товар последним: проведённый приход с поставкой, действующий поставщик.
    db.execute(sql`
      SELECT x.product_id AS productId, x.supplier_id AS supplierId, x.name AS name FROM (
        SELECT ai.product_id, s.supplier_id, sup.name,
               ROW_NUMBER() OVER (PARTITION BY ai.product_id ORDER BY a.arrival_date DESC, a.id DESC) AS rn
        FROM arrival_items ai
        JOIN arrivals a ON a.id = ai.arrival_id
        JOIN supplies s ON s.arrival_id = a.id AND s.tenant_id = a.tenant_id
        JOIN suppliers sup ON sup.id = s.supplier_id AND sup.tenant_id = a.tenant_id
        WHERE a.tenant_id = ${tenantId} AND a.status = 'completed' AND ai.quantity > 0 AND sup.status = 'active'
          AND ai.product_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      ) x WHERE x.rn = 1
    `) as unknown as Promise<ResultRows<{ productId: number; supplierId: number; name: string }>>,
    // Перемещения, отправленные на этот склад и ещё не принятые.
    inTransitByProduct(db, tenantId, ids, whId),
  ]);

  const inbound = new Map<number, number>();
  const unapproved = new Map<number, ReorderPlanRow["unapprovedOrders"]>();
  const add = (productId: number, qty: number) => inbound.set(productId, (inbound.get(productId) ?? 0) + qty);
  for (const r of poOpen) {
    const productId = Number(r.productId);
    const qty = Number(r.qty ?? 0);
    if (!(qty > 0)) continue;
    if ((UNAPPROVED_PO_STATUSES as readonly string[]).includes(r.status)) {
      unapproved.set(productId, [...(unapproved.get(productId) ?? []), { id: Number(r.orderId), number: r.number, status: r.status, qty }]);
    } else {
      add(productId, qty);
    }
  }
  for (const r of looseArrivals) add(Number(r.productId), Number(r.qty ?? 0));
  for (const [productId, qty] of transfers) add(productId, qty);
  const last = new Map(lastDelivered[0].map(r => [Number(r.productId), { id: Number(r.supplierId), name: String(r.name) }]));

  const defaultIds = [...new Set(rows.map(r => r.defaultSupplierId).filter((v): v is number => v != null))];
  const activeDefaults = new Map((defaultIds.length === 0 ? [] : await db.select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.status, "active"), inArray(suppliers.id, defaultIds))))
    .map(s => [Number(s.id), s.name]));

  return rows.map(r => {
    const productId = Number(r.productId);
    const available = Number(r.available ?? 0);
    const avgDaily = Number(r.avgDailySales ?? 0);
    const inb = Math.round((inbound.get(productId) ?? 0) * 100) / 100;
    const held = unapproved.get(productId) ?? [];
    const notApproved = Math.round(held.reduce((n, o) => n + o.qty, 0) * 100) / 100;
    const { target, suggested } = reorderQuantity({
      point: Number(r.reorderPoint ?? 0),
      max: r.reorderMax == null ? null : Number(r.reorderMax),
      available, inbound: inb + notApproved,
      packSize: r.packSize == null ? null : Number(r.packSize),
      unit: r.unit,
    });
    const own = r.defaultSupplierId != null ? activeDefaults.get(Number(r.defaultSupplierId)) : undefined;
    const prev = own === undefined ? last.get(productId) : undefined;
    return {
      productId,
      productName: r.productName,
      productCode: r.productCode,
      unit: r.unit,
      packSize: r.packSize,
      currentStock: String(r.currentStock),
      available: String(r.available),
      reorderPoint: String(r.reorderPoint),
      reorderMax: r.reorderMax,
      unitPrice: String(r.unitPrice),
      costPrice: String(r.costPrice),
      avgDailySales: avgDaily.toFixed(1),
      daysUntilStockout: avgDaily > 0 ? Math.max(0, Math.round(available / avgDaily)) : 999,
      target,
      inbound: inb,
      unapproved: notApproved,
      unapprovedOrders: held,
      suggestedQty: suggested,
      suggestedCost: Math.round(suggested * Number(r.costPrice ?? 0)),
      supplierId: own !== undefined ? Number(r.defaultSupplierId) : prev?.id ?? null,
      supplierName: own ?? prev?.name ?? null,
      supplierSource: own !== undefined ? "default" : prev ? "last" : null,
      warehouseId: whId,
    };
  });
}

/**
 * Крон: предупредить о каждом товаре, который пересёк точку заказа с прошлой
 * проверки, и снять пометку с тех, что вернулись выше.
 *
 * Уведомления: живое событие в открытые экраны, запись директору и
 * операторам, одно сообщение в Telegram на организацию — списком, а не по
 * товару, чтобы приход из десяти позиций не давал десять сообщений.
 */
export async function runLowStockAlerts(db: Db = getDb()): Promise<{ alerted: number; cleared: number; tenants: number }> {
  // 1. Тревога снята: остаток снова выше точки (или точку убрали).
  const recovered = await db.select({ id: warehouseStock.id })
    .from(warehouseStock)
    .innerJoin(products, eq(products.id, warehouseStock.productId))
    .where(and(
      isNotNull(warehouseStock.lowStockAlertedAt),
      sql`NOT (${products.reorderPoint} > 0 AND ${warehouseStock.available} <= ${products.reorderPoint})`,
    ));
  await markLowStockAlerted(db, recovered.map(r => r.id), null);

  /*
    2. Новые пересечения — на складах, с которых продают: основной и
    действующие точки продаж (ADR 0012). Кончается товар у филиала — его
    агенты уже не продадут, и офису надо знать об этом так же, как об
    основном. Склад хранения тревог не шлёт: с него не продают, и его
    «кончилось» — повод для перемещения, а не для заказа поставщику.
    Строка не основного склада называет склад: «Сахар («Филиал»)».
  */
  const freshRows = await db.select({
    tenantId: warehouseStock.tenantId,
    stockId: warehouseStock.id,
    productId: products.id,
    productName: products.name,
    unit: products.unit,
    available: warehouseStock.available,
    reorderPoint: products.reorderPoint,
    isDefault: warehouses.isDefault,
    warehouseName: warehouses.name,
  })
    .from(warehouseStock)
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, warehouseStock.tenantId)))
    .innerJoin(warehouses, and(
      eq(warehouses.id, warehouseStock.warehouseId),
      eq(warehouses.tenantId, warehouseStock.tenantId),
      or(eq(warehouses.isDefault, true), and(eq(warehouses.isSalesPoint, true), eq(warehouses.status, "active"))),
    ))
    .where(and(isNull(warehouseStock.lowStockAlertedAt), eq(products.status, "active"), lowStockCondition()))
    .limit(500);
  const fresh: LowStockRow[] = freshRows.map(({ isDefault, warehouseName, ...r }) => ({
    ...r,
    productName: !isDefault && warehouseName ? `${r.productName} («${warehouseName}»)` : r.productName,
  }));

  const byTenant = new Map<number, LowStockRow[]>();
  for (const r of fresh) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);

  for (const [tenantId, rows] of byTenant) {
    try {
      await notifyTenant(db, tenantId, rows);
      await markLowStockAlerted(db, rows.map(r => r.stockId), new Date());
    } catch (e) {
      // Одна организация не должна оставлять без тревоги остальные.
      logger.error("low-stock alert failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { alerted: fresh.length, cleared: recovered.length, tenants: byTenant.size };
}

const TG_LIMIT = 15;

async function notifyTenant(db: Db, tenantId: number, rows: LowStockRow[]): Promise<void> {
  for (const r of rows) {
    sseBus.emit({ type: "stock.low", tenantId, data: { productId: r.productId, productName: r.productName, available: r.available, reorderPoint: r.reorderPoint } });
  }

  const office = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.role, ["ceo", "operator"]), eq(users.status, "active")));
  if (office.length > 0) {
    const { NotificationService } = await import("./NotificationService");
    const title = rows.length === 1
      ? { ru: `Заканчивается: ${rows[0].productName}`, uz: `Tugayapti: ${rows[0].productName}` }
      : { ru: `Заканчиваются ${rows.length} товара(ов)`, uz: `${rows.length} ta mahsulot tugayapti` };
    const message = {
      ru: rows.slice(0, TG_LIMIT).map(r => `${r.productName} — ${Number(r.available).toFixed(0)} ${r.unit} (порог ${Number(r.reorderPoint).toFixed(0)})`).join("; "),
      uz: rows.slice(0, TG_LIMIT).map(r => `${r.productName} — ${Number(r.available).toFixed(0)} ${r.unit} (chegara ${Number(r.reorderPoint).toFixed(0)})`).join("; "),
    };
    await NotificationService.createBulk(db, { tenantId, userIds: office.map(u => u.id), type: "stock", title, message, link: "/warehouse" });
  }

  const { notifyEvent } = await import("./telegram-notify");
  const { tgMessages } = await import("../lib/telegram");
  const items = rows.slice(0, TG_LIMIT).map(r => ({ name: r.productName, qty: Number(r.available).toFixed(0), unit: r.unit, point: Number(r.reorderPoint).toFixed(0) }));
  await notifyEvent({ tenantId, event: "stock.low", text: tgMessages.lowStockList(items, Math.max(0, rows.length - TG_LIMIT)) });
}

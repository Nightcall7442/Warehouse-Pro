import { and, eq, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import { products, warehouseStock, warehouses, users, settings } from "@db/schema";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { sseBus } from "../lib/sse";
import { markLowStockAlerted } from "./stock-ledger";

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

/** Условие «на основном складе» — для строк warehouse_stock. */
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

  // 2. Новые пересечения — только основной склад каждой организации.
  const fresh = await db.select({
    tenantId: warehouseStock.tenantId,
    stockId: warehouseStock.id,
    productId: products.id,
    productName: products.name,
    unit: products.unit,
    available: warehouseStock.available,
    reorderPoint: products.reorderPoint,
  })
    .from(warehouseStock)
    .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, warehouseStock.tenantId)))
    .innerJoin(warehouses, and(eq(warehouses.id, warehouseStock.warehouseId), eq(warehouses.isDefault, true)))
    .where(and(isNull(warehouseStock.lowStockAlertedAt), eq(products.status, "active"), lowStockCondition()))
    .limit(500);

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
    const title = rows.length === 1 ? `Заканчивается: ${rows[0].productName}` : `Заканчиваются ${rows.length} товара(ов)`;
    const message = rows.slice(0, TG_LIMIT).map(r => `${r.productName} — ${Number(r.available).toFixed(0)} ${r.unit} (порог ${Number(r.reorderPoint).toFixed(0)})`).join("; ");
    await NotificationService.createBulk(db, { tenantId, userIds: office.map(u => u.id), type: "stock", title, message, link: "/warehouse" });
  }

  const { notifyEvent } = await import("./telegram-notify");
  const { tgMessages } = await import("../lib/telegram");
  const items = rows.slice(0, TG_LIMIT).map(r => ({ name: r.productName, qty: Number(r.available).toFixed(0), unit: r.unit, point: Number(r.reorderPoint).toFixed(0) }));
  await notifyEvent({ tenantId, event: "stock.low", text: tgMessages.lowStockList(items, Math.max(0, rows.length - TG_LIMIT)) });
}

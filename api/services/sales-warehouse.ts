/**
 * С какого склада продаёт заказ — ADR 0012, поверх ADR 0008.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Продавали только с основного склада (ADR 0008): заказ резервировал на нём,
 * каталог показывал его остаток, а явная попытка указать другой склад
 * отвергалась. У дистрибьютора с филиалом это значило, что агенты филиала
 * продают товар, лежащий за сотни километров, а остаток своего склада видят
 * только в отчётах.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Склад продажи выбирается так:
 *   1. Явно выбранный — только офис (ceo, operator). Склад свой, действующий,
 *      основной или отмеченный «точкой продаж». Полевым ролям — отказ: им
 *      склад назначает директор в карточке сотрудника, и выбирать его у
 *      прилавка значило бы продавать чужой остаток.
 *   2. Склад агента заказа (users.warehouse_id), если он годится для продажи.
 *   3. Основной склад.
 *
 * Организация, где директор не отметил ни одной точки продаж и никого не
 * закрепил, живёт как раньше: всё сводится к шагу 3.
 *
 * Тем же правилом читает каталог (product-router): агент видит остаток того
 * склада, с которого спишется его заказ, — иначе он увидел бы одно число, а
 * сервер решил бы по другому.
 *
 * Уже оформленный заказ склад не выбирает: он живёт со своим
 * (orders.warehouse_id, orderWarehouseId в order-shared). Старым заказам без
 * записи остаётся только основной — defaultWarehouseId, без агента: резерв
 * этих заказов лёг на основной, и снимать его с другого нельзя.
 */
import { and, eq, sql } from "drizzle-orm";
import { warehouses, users } from "@db/schema";
import { TRPCError } from "@trpc/server";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Кто вправе выбрать склад заказа сам: офис. Полевым склад назначает директор. */
export const WAREHOUSE_CHOOSERS = ["ceo", "operator"] as const;
export const mayChooseWarehouse = (role: string): boolean => (WAREHOUSE_CHOOSERS as readonly string[]).includes(role);

/** Условие «с этого склада продают»: действующий, основной или точка продаж. */
export function sellableWarehouse(tenantId: number) {
  return and(
    eq(warehouses.tenantId, tenantId),
    eq(warehouses.status, "active"),
    sql`(${warehouses.isDefault} = 1 OR ${warehouses.isSalesPoint} = 1)`,
  );
}

/** Основной склад организации; null — его нет. */
export async function defaultWarehouseId(db: Db | Tx, tenantId: number): Promise<number | null> {
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  return wh ? Number(wh.id) : null;
}

/** Склад организации, с которого можно продавать; null — чужой, отключён или только для хранения. */
export async function findSellableWarehouse(db: Db | Tx, tenantId: number, id: number): Promise<{ id: number; name: string } | null> {
  const [wh] = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(and(eq(warehouses.id, id), sellableWarehouse(tenantId))).limit(1);
  return wh ? { id: Number(wh.id), name: wh.name } : null;
}

export interface SalesWarehouseQuery {
  /** Склад, выбранный явно. Только офис (mayChoose). */
  requested?: number | null;
  /** Чей заказ: склад из его карточки. */
  agentId?: number | null;
  /** Вправе ли спрашивающий выбрать склад сам — mayChooseWarehouse(роль). */
  mayChoose?: boolean;
}

/**
 * Склад продажи: выбранный офисом → склад агента → основной.
 * null — у организации нет основного склада (заказ откажет, каталог покажет
 * пустой остаток). Отказ — BAD_REQUEST, а не FORBIDDEN: офлайн-очередь
 * телефона FORBIDDEN повторяет без конца.
 */
export async function salesWarehouseFor(db: Db | Tx, tenantId: number, q: SalesWarehouseQuery): Promise<number | null> {
  if (q.requested != null) {
    if (!q.mayChoose) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Склад заказа выбирает офис. Агенту склад назначают в карточке сотрудника" });
    }
    const wh = await findSellableWarehouse(db, tenantId, q.requested);
    if (!wh) throw new TRPCError({ code: "BAD_REQUEST", message: "С этого склада не продают: он отключён или не отмечен точкой продаж" });
    return wh.id;
  }
  if (q.agentId) {
    // Склад из карточки — только пока с него продают. Сняли отметку или
    // отключили склад — агент молча возвращается к основному, а не остаётся
    // без каталога.
    const [own] = await db.select({ id: warehouses.id }).from(users)
      .innerJoin(warehouses, and(eq(warehouses.id, users.warehouseId), sellableWarehouse(tenantId)))
      .where(and(eq(users.id, q.agentId), eq(users.tenantId, tenantId)))
      .limit(1);
    if (own) return Number(own.id);
  }
  return defaultWarehouseId(db, tenantId);
}

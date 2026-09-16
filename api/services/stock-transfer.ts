import { and, eq, inArray } from "drizzle-orm";
import { warehouses, warehouseStock, stockTransfers, products } from "@db/schema";
import { applyStockEffect, receiveStock } from "./stock-ledger";
import { recordAudit } from "./audit-log";
import { badRequest } from "../lib/errors";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Actor = { id: number; name?: string; role: string };

export interface TransferInput {
  fromWarehouseId: number;
  toWarehouseId: number;
  items: Array<{ productId: number; quantity: number }>;
  notes?: string | null;
  /** Кто принял товар: загрузка машины подписывается PIN водителя. */
  acceptedBy?: number | null;
}

/**
 * Перемещение между складами — документ в один шаг.
 *
 * Было: по одному товару, «создать» → «принять», между шагами товар нигде,
 * и только директор. Владелец (16.09.2026): много позиций, товар сразу на
 * складе-получателе, делает и оператор с правом «warehouse.adjust» — тем
 * же, что даёт ручную правку остатков: перемещение — та же рука на остатке.
 *
 * Строки stock_transfers остаются по одной на позицию — это история; статус
 * ставится «completed» сразу. Вынесено из роутера, потому что тем же
 * документом грузится и разгружается машина (services/van.ts).
 */
export async function transferStock(db: Db, tenantId: number, actor: Actor, input: TransferInput): Promise<{ ids: number[]; count: number; fromName: string; toName: string }> {
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Нельзя перемещать товар на тот же склад");
  // Одна позиция — одна строка: повтор товара в документе сложил бы его дважды.
  const seen = new Set<number>();
  for (const it of input.items) {
    if (seen.has(it.productId)) throw badRequest("Товар повторяется в документе");
    seen.add(it.productId);
  }

  // Оба склада — свои. Чужой склад-получатель раньше не проверялся вовсе,
  // и строка остатка заводилась с номером чужого склада.
  const owned = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, [input.fromWarehouseId, input.toWarehouseId])));
  const byId = new Map(owned.map(w => [w.id, w.name]));
  if (!byId.has(input.fromWarehouseId) || !byId.has(input.toWarehouseId)) throw badRequest("Склад не найден");
  const fromName = byId.get(input.fromWarehouseId)!, toName = byId.get(input.toWarehouseId)!;

  return db.transaction(async (tx) => {
    const ids: number[] = [];
    let total = 0;
    for (const it of input.items) {
      // Строка источника — под замком: два одновременных документа не
      // спишут одно и то же дважды.
      const [sourceStock] = await tx.select().from(warehouseStock)
        .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, input.fromWarehouseId), eq(warehouseStock.productId, it.productId)))
        .for("update").limit(1);
      if (!sourceStock || Number(sourceStock.available) < it.quantity) {
        const [p] = await tx.select({ name: products.name }).from(products)
          .where(and(eq(products.id, it.productId), eq(products.tenantId, tenantId))).limit(1);
        const name = p?.name ?? "";
        throw badRequest(`Недостаточно товара на складе отправителе: ${name}`);
      }

      const [result] = await tx.insert(stockTransfers).values({
        tenantId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId,
        productId: it.productId, quantity: String(it.quantity),
        status: "completed", completedAt: new Date(), notes: input.notes ?? null, createdBy: actor.id,
        acceptedBy: input.acceptedBy ?? null, acceptedAt: input.acceptedBy ? new Date() : null,
      });
      const transferId = Number(result.insertId);
      ids.push(transferId);
      total += it.quantity;

      /*
        Одно физическое перемещение — две записи через дверь: ушло с одного
        склада (с партий по FEFO), пришло на другой.
        ponytail: партия на приёмной стороне не переносится — товар ложится
        без срока; переносить партии, когда склады начнут отчитываться по
        срокам порознь.
      */
      await applyStockEffect(tx, {
        tenantId, warehouseId: input.fromWarehouseId,
        items: [{ productId: it.productId, quantity: String(it.quantity) }],
        shift: { onHand: -1, held: 0 }, reason: "transfer_out", referenceId: transferId,
        notes: `Перемещение на склад «${toName}»`,
      });
      await receiveStock(tx, {
        tenantId, warehouseId: input.toWarehouseId,
        productId: it.productId, quantity: String(it.quantity),
        reason: "transfer_in", referenceId: transferId,
        notes: `Перемещение со склада «${fromName}»`,
      });
    }

    await recordAudit(tx as unknown as Db, {
      tenantId, actorId: actor.id, actorName: actor.name, action: "stock.transfer_completed", targetType: "stock_transfer", targetId: ids[0],
      meta: { fromWarehouse: fromName, toWarehouse: toName, items: input.items.length, quantity: total, notes: input.notes ?? undefined },
    }, { strict: true });

    return { ids, count: ids.length, fromName, toName };
  });
}

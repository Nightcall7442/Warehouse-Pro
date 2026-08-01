import { createOrder } from "./create";
import { invalidateDashboard } from "./cache";
import { OrderReadModel } from "./read-model";
import { OrderRepository } from "./repository";
import { OrderStockManager } from "./stock-manager";
import { OrderDebtCalculator } from "./debt-calculator";
import { OrderNotifier } from "./notifier";
import {
  assertCancellable,
  assertDiscountNotNegative,
  assertRestorable,
  assertTransition,
  assertUpdatedDiscountWithinSubtotal,
  holdsStock,
} from "./validator";
import { DomainError } from "../../lib/domain-error";
import type { ActorOpts, CreateOrderInput, Db, ListFilters, OrderStatus } from "./types";

/**
 * FIX: P1.1 — composition root for the order domain.
 *
 * The public surface is unchanged: `api/order-router.ts` and the tests call the
 * same methods with the same arguments. What changed is that each method now reads
 * as the sequence of decisions it makes, with the SQL in ./repository.ts, the stock
 * movement in ./stock-manager.ts, the receivable in ./debt-calculator.ts and the
 * fan-out in ./notifier.ts.
 */

const PRIVILEGED_CANCEL_ROLES = ["ceo", "operator", "superadmin"];

export const OrderService = {
  list(db: Db, tenantId: number, filters: Record<string, unknown>, opts?: ActorOpts) {
    return OrderReadModel.list(db, tenantId, filters as ListFilters, opts);
  },

  getById(db: Db, tenantId: number, orderId: number, _opts?: ActorOpts) {
    return OrderReadModel.getById(db, tenantId, orderId);
  },

  myOrders(db: Db, tenantId: number, agentId: number) {
    return OrderReadModel.myOrders(db, tenantId, agentId);
  },

  create(db: Db, tenantId: number, agentId: number, input: CreateOrderInput) {
    return createOrder(db, tenantId, agentId, input);
  },

  async cancel(db: Db, tenantId: number, orderId: number, opts: ActorOpts) {
    await db.transaction(async (tx) => {
      const isPrivileged = PRIVILEGED_CANCEL_ROLES.includes(opts.userRole);
      // A soft-deleted order has already had its stock released — cancelling it
      // again would credit the warehouse twice.
      const order = await OrderRepository.snapshotForUpdate(tx, tenantId, orderId, {
        ownAgentId: isPrivileged ? undefined : opts.userId,
        excludeDeleted: true,
      });
      if (!order) throw DomainError.notFound("Заказ не найден");
      assertCancellable(order.status);

      await OrderDebtCalculator.onCancel(tx, tenantId, order);

      const items = await OrderRepository.items(tx, orderId);
      await OrderStockManager.release(tx, tenantId, items);

      await OrderRepository.setStatus(tx, tenantId, orderId, "cancelled", "new");
    });

    invalidateDashboard(tenantId);
    return { success: true };
  },

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: OrderStatus) {
    await db.transaction(async (tx) => {
      // Soft-deleted orders already gave their stock back; moving them through
      // the lifecycle again would double-count it.
      const order = await OrderRepository.snapshotForUpdate(tx, tenantId, orderId, { excludeDeleted: true });
      if (!order) throw DomainError.notFound("Заказ не найден");

      if (order.status === newStatus && (order.status === "completed" || order.status === "cancelled")) {
        return { success: true };
      }
      assertTransition(order.status, newStatus);

      await OrderDebtCalculator.onStatusCancel(tx, tenantId, { ...order, status: order.status });

      const items = await OrderRepository.items(tx, orderId);
      if (items.length > 0) {
        // Skip stock deduction if courier already delivered (markDelivered handles it)
        if (newStatus === "completed" && order.deliveryStatus !== "delivered") {
          await OrderStockManager.deduct(tx, tenantId, items);
        }
        if (newStatus === "cancelled") {
          await OrderStockManager.release(tx, tenantId, items);
        }
      }

      await OrderRepository.setStatus(tx, tenantId, orderId, newStatus);
    });

    invalidateDashboard(tenantId);
    await OrderNotifier.statusChanged(db, tenantId, orderId, newStatus);

    return { success: true };
  },

  async delete(db: Db, tenantId: number, orderId: number) {
    await db.transaction(async (tx) => {
      const order = await OrderRepository.snapshotForUpdate(tx, tenantId, orderId, { excludeDeleted: true });
      if (!order) throw DomainError.notFound("Заказ не найден или уже удалён");

      await OrderDebtCalculator.onDelete(tx, tenantId, order);

      if (holdsStock(order.status)) {
        const items = await OrderRepository.items(tx, orderId);
        await OrderStockManager.release(tx, tenantId, items);
      }

      await OrderRepository.softDelete(tx, tenantId, orderId);
    });

    invalidateDashboard(tenantId);
    return { success: true };
  },

  async update(db: Db, tenantId: number, orderId: number, data: { notes?: string; discount?: string }) {
    if (data.discount !== undefined) assertDiscountNotNegative(Number(data.discount));

    await db.transaction(async (tx) => {
      const order = await OrderRepository.snapshotForUpdate(tx, tenantId, orderId, { excludeDeleted: true });
      if (!order) throw DomainError.notFound("Заказ не найден");

      const updates: Record<string, unknown> = {};
      if (data.notes !== undefined) updates.notes = data.notes;
      if (data.discount !== undefined) {
        const subtotal = Number(order.subtotal);
        const discount = Number(data.discount);
        assertUpdatedDiscountWithinSubtotal(discount, subtotal);
        const newTotal = subtotal - discount;
        updates.discount = data.discount;
        updates.total = newTotal.toFixed(2);
        await OrderDebtCalculator.onTotalChanged(tx, tenantId, order, newTotal);
      }

      await OrderRepository.setFields(tx, tenantId, orderId, updates);
    });

    invalidateDashboard(tenantId);
    return { success: true };
  },

  async restore(db: Db, tenantId: number, orderId: number) {
    const order = await OrderRepository.findForRestore(db, tenantId, orderId);
    if (!order) throw DomainError.notFound("Заказ не найден");
    assertRestorable(order);

    await db.transaction(async (tx) => {
      await OrderRepository.undelete(tx, tenantId, orderId);
      await OrderDebtCalculator.onRestore(tx, tenantId, order);

      if (holdsStock(order.status)) {
        const items = await OrderRepository.items(tx, orderId);
        await OrderStockManager.reReserveForRestore(tx, tenantId, items);
      }
    });

    invalidateDashboard(tenantId);
    return { success: true };
  },
};

export { OrderReadModel } from "./read-model";
export { OrderRepository } from "./repository";
export { OrderStockManager } from "./stock-manager";
export { OrderDebtCalculator } from "./debt-calculator";
export { OrderNotifier } from "./notifier";
export * from "./validator";
export type * from "./types";

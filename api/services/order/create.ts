import { invalidateDashboard } from "./cache";
import { OrderDebtCalculator } from "./debt-calculator";
import { OrderNotifier } from "./notifier";
import { OrderRepository } from "./repository";
import { OrderStockManager } from "./stock-manager";
import { assertDiscountNotNegative, assertDiscountWithinSubtotal, priceOrderLines } from "./validator";
import type { CreateOrderInput, Db } from "./types";

/**
 * Order creation: the one operation with enough steps to warrant its own module.
 *
 * Sequence inside the transaction is deliberate — prices are read server-side,
 * stock is reserved under a row lock before the order row exists, and the shop's
 * receivable is booked last. Notifications happen after the commit.
 */

function newOrderNumber(): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return `ORD-${raw.slice(0, 12).toUpperCase()}`;
}

function isDuplicateKeyError(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
  return code === "ER_DUP_ENTRY";
}

export async function createOrder(db: Db, tenantId: number, agentId: number, input: CreateOrderInput) {
  const discount = Number(input.discount ?? "0");
  assertDiscountNotNegative(discount);

  // P0-1 FIX: Validate shop belongs to this tenant
  const shop = await OrderRepository.findShop(db, tenantId, input.shopId);
  if (!shop) throw new Error("Магазин не найден в вашей организации");

  // #FIX1-IDEMPOTENCY: Check for existing order with same key
  if (input.idempotencyKey) {
    const existing = await OrderRepository.findByIdempotencyKey(db, tenantId, input.idempotencyKey);
    if (existing) return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
  }

  const orderNumber = newOrderNumber();
  let orderId: number;
  let orderTotal: number;

  try {
    const result = await db.transaction(async (tx) => {
      // #FIX1: Look up prices from the database, never trust client
      const productRows = await OrderRepository.activeProductPrices(tx, tenantId, input.items.map(i => i.productId));
      const priceMap = new Map(productRows.map(p => [p.id, p.unitPrice]));
      const costMap = new Map(productRows.map(p => [p.id, p.costPrice]));

      const { subtotal } = priceOrderLines(input.items, priceMap);
      assertDiscountWithinSubtotal(discount, subtotal);
      const total = subtotal - discount;

      await OrderStockManager.reserve(tx, tenantId, input.items, input.warehouseId);

      const id = await OrderRepository.insertOrder(tx, {
        tenantId, orderNumber, shopId: input.shopId, agentId,
        subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
        notes: input.notes,
        idempotencyKey: input.idempotencyKey ?? null,
        paymentMethod: input.paymentMethod ?? "cash",
      });

      await OrderRepository.insertItems(tx, input.items.map(item => {
        const unitPrice = Number(priceMap.get(item.productId)!);
        return {
          orderId: id, productId: item.productId, quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
          costPrice: costMap.get(item.productId) ?? "0.00",
          subtotal: (unitPrice * Number(item.quantity)).toFixed(2),
        };
      }));

      await OrderDebtCalculator.onCreate(tx, tenantId, input.shopId, input.paymentMethod, total);

      return { id, total };
    });
    orderId = result.id;
    orderTotal = result.total;
  } catch (err: unknown) {
    // Two requests with the same idempotency key can both pass the pre-check and
    // race into the insert; the loser reads the winner's order instead of failing.
    if (input.idempotencyKey && isDuplicateKeyError(err)) {
      const existing = await OrderRepository.findByIdempotencyKey(db, tenantId, input.idempotencyKey);
      if (existing) return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
    }
    throw err;
  }

  invalidateDashboard(tenantId);
  await OrderNotifier.orderCreated(db, tenantId, {
    id: orderId, orderNumber, shopId: input.shopId, total: orderTotal,
  });

  return { id: orderId, orderNumber };
}

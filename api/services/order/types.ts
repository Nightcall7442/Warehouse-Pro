/**
 * Shared types for the order domain.
 *
 * FIX: P1.1 — OrderService was one 700-line module holding reads, stock movement,
 * debt bookkeeping, validation and notifications. It is now composed from focused
 * modules (see ./index.ts); these are the types they pass between each other.
 */

export type Db = ReturnType<typeof import("../../queries/connection").getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type OrderStatus = "new" | "processing" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "card" | "transfer" | "debt";

export type ListFilters = {
  status?: OrderStatus;
  agentId?: number;
  page?: number;
  pageSize?: number;
  search?: string;
  showDeleted?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

export type ActorOpts = { userId: number; userRole: string };

export type CreateOrderInput = {
  shopId: number;
  warehouseId?: number;
  items: Array<{ productId: number; quantity: string }>;
  notes?: string;
  discount?: string;
  idempotencyKey?: string;
  paymentMethod?: PaymentMethod;
};

/** An order line as stored, which is all the stock and debt logic needs. */
export type OrderLine = { productId: number; quantity: string };

/** The order fields the lifecycle operations read before deciding what to do. */
export type OrderSnapshot = {
  id: number;
  status: string;
  shopId: number;
  total: string;
  paymentMethod: string | null;
};

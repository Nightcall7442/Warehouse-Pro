import { useQueryClient } from "@tanstack/react-query";

/**
 * Every cached query family an order write can move.
 *
 * Writing an order is never a local edit. Changing one line item rewrites the
 * order's total (order.list, order.stats), the shop's debt (shop.*), the stock
 * reserved against it (warehouse*.*), the courier's route (courier.*) and every
 * report built on top of those (analytics.*, reports.*, dashboard.*).
 *
 * Before this hook each call site picked its own subset, and each one picked a
 * different, incomplete subset — editing an order refreshed the detail panel
 * but left the Orders list showing the old total until a full page reload.
 * Listing the blast radius once means a new mutation cannot re-introduce that
 * by being written the same careless way: it refreshes everything or nothing.
 */
export const ORDER_AFFECTED_ROUTERS = [
  "order",
  "shop",
  "warehouse",
  "warehouseMulti",
  "warehouseReports",
  "courier",
  "analytics",
  "reports",
  "dashboard",
  "agent",
  "product",
] as const;

/**
 * Returns a function to call from a mutation's `onSuccess`.
 *
 * tRPC keys every query as `[[router, procedure], …]`, so a `[[router]]` prefix
 * matches the whole router — the same shape the SSE listener already uses.
 * Invalidating by prefix rather than naming procedures with their exact inputs
 * is deliberate: react-query only refetches what is currently mounted, so the
 * cost is the handful of queries on screen, while correctness no longer depends
 * on remembering every reader of the data.
 */
export function useInvalidateOrderCaches() {
  const queryClient = useQueryClient();

  return function invalidateOrderCaches() {
    for (const router of ORDER_AFFECTED_ROUTERS) {
      queryClient.invalidateQueries({ queryKey: [[router]] });
    }
  };
}

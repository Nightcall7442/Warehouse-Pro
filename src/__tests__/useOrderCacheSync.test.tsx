// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useInvalidateOrderCaches, ORDER_AFFECTED_ROUTERS } from "@/hooks/useOrderCacheSync";

/**
 * The static guard test proves every mutation *calls* the helper. This one
 * proves the helper actually reaches the cached queries — a prefix that matched
 * nothing would satisfy the guard and still leave the stale total on screen.
 */

function withClient(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/** Seeds a query under the tRPC key shape: [[router, procedure], { input }]. */
function seed(queryClient: QueryClient, router: string, procedure: string, data: unknown) {
  const key = [[router, procedure], { input: {}, type: "query" }];
  queryClient.setQueryData(key, data);
  return key;
}

describe("useInvalidateOrderCaches", () => {
  it("marks the Orders list stale — the query that showed the old total", () => {
    const queryClient = new QueryClient();
    const listKey = seed(queryClient, "order", "list", { data: [{ id: 1, total: "100" }] });

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);

    const { result } = renderHook(() => useInvalidateOrderCaches(), { wrapper: withClient(queryClient) });
    result.current();

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("reaches every router it claims to cover", () => {
    const queryClient = new QueryClient();
    const keys = ORDER_AFFECTED_ROUTERS.map(r => [r, seed(queryClient, r, "list", {})] as const);

    const { result } = renderHook(() => useInvalidateOrderCaches(), { wrapper: withClient(queryClient) });
    result.current();

    const missed = keys
      .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated !== true)
      .map(([router]) => router);

    expect(missed, `these routers were not invalidated: ${missed.join(", ")}`).toEqual([]);
  });

  it("covers the specific queries behind the reported bug", () => {
    const queryClient = new QueryClient();
    // Orders page totals, order stats cards, and the shop debt they feed.
    const list  = seed(queryClient, "order", "list", {});
    const stats = seed(queryClient, "order", "stats", {});
    const shops = seed(queryClient, "shop", "list", {});

    const { result } = renderHook(() => useInvalidateOrderCaches(), { wrapper: withClient(queryClient) });
    result.current();

    for (const key of [list, stats, shops]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("leaves unrelated caches alone", () => {
    const queryClient = new QueryClient();
    const settings = seed(queryClient, "settings", "get", {});
    const auth     = seed(queryClient, "auth", "me", {});

    const { result } = renderHook(() => useInvalidateOrderCaches(), { wrapper: withClient(queryClient) });
    result.current();

    expect(queryClient.getQueryState(settings)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(auth)?.isInvalidated).toBe(false);
  });
});

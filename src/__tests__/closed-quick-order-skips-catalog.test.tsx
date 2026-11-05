// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Закрытый «Быстрый заказ» не тянет каталог.
 *
 * Окно стоит на странице «Заказы» всегда. Закрытое, оно запрашивало весь
 * каталог (product.listAll, до 10 000 товаров с ценами) при каждом заходе —
 * в одной пачке со списком заказов, и таблица ждала каталог, которого никто
 * не открывал. Арендаторы: «программа долго загружается» (20.10.2026).
 */
afterEach(cleanup);

const calls = vi.hoisted(() => ({ listAll: [] as Array<{ input: unknown; opts: { enabled?: boolean } | undefined }> }));
const trpcStub = vi.hoisted(() => ({
  agent: { availableShops: { useQuery: () => ({ data: [] }) } },
  shop: { search: { useQuery: () => ({ data: undefined }) } },
  product: { listAll: { useQuery: (input: unknown, opts?: { enabled?: boolean }) => { calls.listAll.push({ input, opts }); return { data: undefined }; } } },
  order: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  priceList: { forShop: { useQuery: () => ({ data: undefined }) } },
}));
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useShopSearch", () => ({ useShopSearch: () => ({ shops: [], more: false }), SHOP_PICK_LIMIT: 50 }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "operator" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const { QuickOrderModal } = await import("@/components/orders/QuickOrderModal");

const mount = (open: boolean) => render(
  <LangProvider>
    <QuickOrderModal open={open} onOpenChange={() => {}} />
  </LangProvider>,
);

describe("быстрый заказ: каталог — только у открытого окна", () => {
  it("закрытое окно не запрашивает каталог", () => {
    calls.listAll.length = 0;
    mount(false);
    expect(calls.listAll.length).toBeGreaterThan(0);
    for (const c of calls.listAll) expect(c.opts?.enabled, `listAll ${JSON.stringify(c.input)} у закрытого окна`).toBe(false);
  });

  it("открытое — запрашивает", () => {
    calls.listAll.length = 0;
    mount(true);
    expect(calls.listAll.some(c => c.opts?.enabled !== false)).toBe(true);
  });
});

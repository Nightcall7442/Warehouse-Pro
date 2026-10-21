// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { OrderItem } from "@/components/orders/types";
import { setSessionOwner } from "@/lib/offline-copy";

/**
 * Склад продажи в мастере заказа (ADR 0012) — настоящий NewOrder.
 *
 * Офис выбирает склад над каталогом: каталог шага «Товары» и итог читают
 * остаток и цены ЭТОГО склада, и заказ уходит с ним же. Агенту выбора нет:
 * его запрос каталога остаётся прежним ({ shopId }), склад он не шлёт —
 * сервер возьмёт склад из его карточки.
 *
 * Нарочная поломка:
 *   · убери warehouseId из payload — падает «офис: заказ уходит с выбранным
 *     складом»;
 *   · отдай каталогу итога { shopId } без scope — падает он же (запрос
 *     каталога без склада);
 *   · покажи выбор всем (без mayChooseWarehouse) — падает «агенту выбора нет».
 */

const h = vi.hoisted(() => ({
  user: { id: 1, role: "agent", name: "Агент" } as { id: number; role: string; name: string },
  catalogCalls: [] as unknown[],
  selectorScopes: [] as unknown[],
  sent: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    agent: { listAgents: { useQuery: () => ({ data: undefined }) } },
    product: {
      listAll: {
        useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
          if (opts?.enabled !== false) h.catalogCalls.push(input);
          return { data: undefined };
        },
      },
    },
    order: {
      repeatDraft: { useQuery: () => ({ data: undefined }) },
      shopOverdue: { useQuery: () => ({ data: null }) },
      create: {
        useMutation: () => ({ mutate: (p: Record<string, unknown>) => { h.sent.push(p); }, isPending: false }),
      },
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/toast", () => ({ notify: { info: () => {}, success: () => {}, error: () => {} } }));
vi.mock("@/pages/OfflineOrders.helpers", () => ({ savePendingOrder: vi.fn() }));
// Сам выбор — отдельный тест (sales-warehouse-ui); здесь — кнопка «выбрать склад 2».
vi.mock("@/components/orders/SalesWarehousePicker", async () => {
  const { createElement: el } = await import("react");
  return {
    SalesWarehousePicker: ({ value, onChange }: { value: number; onChange: (id: number) => void }) =>
      el("button", { "data-testid": "pick-warehouse", "data-value": value, onClick: () => onChange(2) }, "pick-2"),
  };
});
vi.mock("@/components/orders", async () => {
  const { createElement: el } = await import("react");
  return {
    EMPTY_ITEM: { productId: 0, quantity: "", unitPrice: "", productName: "", available: "0", unit: "pcs", unitWeight: 0 },
    Steps: () => null,
    ShopSelector: ({ onSelect }: { onSelect: (id: number, name: string) => void }) =>
      el("button", { onClick: () => onSelect(5, "Магазин") }, "shop-5"),
    ProductSelector: ({ items, onChange, scope }: { items: OrderItem[]; onChange: (v: OrderItem[]) => void; scope?: unknown }) => {
      h.selectorScopes.push(scope);
      return el("button", {
        onClick: () => onChange([...items.filter(i => i.productId > 0), { productId: 8, productName: "Сок", unitPrice: "3000.00", quantity: "1", available: "9", unit: "pcs", unitWeight: 1 }]),
      }, "add-8");
    },
    OrderReview: () => null,
  };
});

const { default: NewOrder, NewOrderShopStep, NewOrderItemsStep, NewOrderReviewStep } = await import("@/pages/NewOrder");

const tree = () => (
  <MemoryRouter initialEntries={["/orders/new"]}>
    <Routes>
      <Route path="/orders/new" element={<NewOrder />}>
        <Route index element={<NewOrderShopStep />} />
        <Route path="items" element={<NewOrderItemsStep />} />
        <Route path="review" element={<NewOrderReviewStep />} />
      </Route>
      <Route path="*" element={<div>вне мастера</div>} />
    </Routes>
  </MemoryRouter>
);
const click = (name: string) => fireEvent.click(screen.getByText(name));
const next = () => fireEvent.click(screen.getByTestId("order-next"));

beforeEach(() => {
  localStorage.clear();
  setSessionOwner(1);
  h.catalogCalls = [];
  h.selectorScopes = [];
  h.sent = [];
});
afterEach(() => { cleanup(); });

describe("склад продажи в мастере заказа", () => {
  it("офис: выбранный склад — в каталоге шага, в каталоге итога и в заказе", () => {
    h.user = { id: 1, role: "operator", name: "Оператор" };
    render(tree());
    click("shop-5"); next();
    click("pick-2");
    expect(screen.getByTestId("pick-warehouse").getAttribute("data-value")).toBe("2");
    expect(h.selectorScopes.at(-1)).toEqual({ warehouseId: 2 });
    expect(h.catalogCalls.at(-1)).toEqual({ shopId: 5, warehouseId: 2 });
    click("add-8");
    next(); next();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ shopId: 5, warehouseId: 2, items: [{ productId: 8, quantity: "1" }] });
  });

  it("офис без выбора: склад не шлётся — его решит сервер", () => {
    h.user = { id: 1, role: "ceo", name: "Директор" };
    render(tree());
    click("shop-5"); next();
    expect(screen.getByTestId("pick-warehouse").getAttribute("data-value")).toBe("0");
    expect(h.catalogCalls.at(-1)).toEqual({ shopId: 5 });
    click("add-8");
    next(); next();
    expect(h.sent[0]!.warehouseId).toBeUndefined();
  });

  it("агенту выбора нет: каталог по-прежнему { shopId }, склад в заказе не шлётся", () => {
    h.user = { id: 1, role: "agent", name: "Агент" };
    render(tree());
    click("shop-5"); next();
    expect(screen.queryByTestId("pick-warehouse")).toBeNull();
    expect(h.catalogCalls.every(c => JSON.stringify(c) === JSON.stringify({ shopId: 5 }))).toBe(true);
    expect(h.selectorScopes.at(-1)).toEqual({});
    click("add-8");
    next(); next();
    expect(h.sent).toHaveLength(1);
    expect("warehouseId" in h.sent[0]! ? h.sent[0]!.warehouseId : undefined).toBeUndefined();
  });
});

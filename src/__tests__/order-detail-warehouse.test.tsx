// @vitest-environment jsdom
/**
 * Карточка заказа называет склад заказа (ADR 0012) — когда продают больше
 * чем с одного склада. Кладовщику и офису важно, откуда везти: заказ
 * филиала собирают в филиале. В организации с одним складом продаж строки
 * нет — там склад и так один.
 *
 * Нарочная поломка: убери условие showsWarehouse — падает «один склад
 * продаж — строки нет»; убери Fact склада — падает «два склада продаж».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";

const h = vi.hoisted(() => ({
  warehouses: [] as Array<{ id: number; name: string; isDefault: boolean; isSalesPoint: boolean; status: string }>,
}));

vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, tenantId: 1, role: "operator", name: "Оператор" } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {}, ORDER_AFFECTED_ROUTERS: [] }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: { name: "" }, footerNote: "", invoice: {} }) }));
vi.mock("@/hooks/useCompletionFlow", () => ({ useCompletionFlow: () => ({ saving: false, handleCompletionSave: async () => true, getCompletionMode: () => undefined }) }));
// Блоки карточки со своими запросами — не предмет проверки.
vi.mock("@/components/orders/InvoicePrintModal", () => ({ InvoicePrintModal: () => null }));
vi.mock("@/components/orders/CompletionFlowModal", () => ({ CompletionFlowModal: () => null }));
vi.mock("@/components/orders/OrderItemsEditor", () => ({ OrderItemsEditor: () => null }));
vi.mock("@/components/orders/OrderComments", () => ({ OrderComments: () => null }));
vi.mock("@/components/orders/OrderMoney", () => ({ MoneyBlock: () => null }));
vi.mock("@/components/orders/PromisedDelivery", () => ({ PromisedDelivery: () => null }));
vi.mock("@/components/orders/OneCExport", () => ({ OneCExport: () => null }));
vi.mock("@/components/phone/OrderPipeline", () => ({ OrderPipeline: () => null }));

vi.mock("@/providers/trpc", () => {
  const leaf = () => new Proxy(() => {}, { get: () => leaf(), apply: () => undefined });
  const utils = new Proxy({}, { get: () => leaf() });
  const order = {
    id: 11, orderNumber: "ORD-11", status: "new", total: "100000", subtotal: "100000", discount: "0",
    createdAt: "2026-10-20T09:00:00", paymentMethod: "cash", shopId: 5, agentId: 7, items: [],
    shop: { id: 5, name: "Магазин", debt: "0" }, agent: null, courier: null, deletedAt: null,
    warehouseId: 2, warehouseName: "Филиал",
  };
  const node = (path: string[]): unknown => new Proxy(() => {}, {
    get(_t, key: string) {
      if (path.length === 0 && key === "useUtils") return () => utils;
      if (key === "useQuery") return () => {
        const p = path.join(".");
        const data = p === "order.getById" ? order
          : p === "warehouseMulti.list" ? h.warehouses
          : p === "order.getAdjustments" ? [] : undefined;
        return { data, isLoading: false, isLoadingError: false, refetch: () => {} };
      };
      if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
      return node([...path, key]);
    },
  });
  return { trpc: node([]) };
});

const { default: OrderDetail } = await import("@/pages/OrderDetail");

const show = () => render(
  <LangProvider>
    <MemoryRouter initialEntries={["/orders/11"]}>
      <Routes><Route path="/orders/:id" element={<OrderDetail />} /></Routes>
    </MemoryRouter>
  </LangProvider>,
);

const MAIN = { id: 1, name: "Основной", isDefault: true, isSalesPoint: false, status: "active" };
const BRANCH = { id: 2, name: "Филиал", isDefault: false, isSalesPoint: true, status: "active" };
const STORE = { id: 3, name: "Хранение", isDefault: false, isSalesPoint: false, status: "active" };

beforeEach(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* нет хранилища */ } });
afterEach(() => { cleanup(); });

describe("карточка заказа — склад заказа", () => {
  it("два склада продаж — карточка называет склад заказа", () => {
    h.warehouses = [MAIN, BRANCH];
    show();
    expect(screen.getByTestId("order-warehouse").textContent).toBe("Филиал");
  });

  it("один склад продаж (второй — для хранения) — строки нет", () => {
    h.warehouses = [MAIN, STORE];
    show();
    expect(screen.queryByTestId("order-warehouse")).toBeNull();
  });
});

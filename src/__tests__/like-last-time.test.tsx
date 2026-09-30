// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";
import type { OrderItem } from "@/components/orders/types";

/**
 * «В прошлый раз: N» и «Как в прошлый раз» — у агента в оформлении заказа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Агент стоит у прилавка и набирает заказ по памяти: сколько магазин брал в
 * прошлый раз, нигде не видно, и 10–30 позиций вбиваются заново.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · мастер спрашивает подсказку для выбранного магазина (order.repeatDraft)
 *     и отдаёт её шагу «Товары»;
 *   · настоящий ProductSelector: у товара — «в прошлый раз: 11 шт»;
 *     «Как в прошлый раз» ставит подсказанные количества (не прибавляет —
 *     второе нажатие ничего не удваивает), оставляет набранное сверх
 *     подсказки, товар без остатка не кладёт и говорит, сколько таких.
 *
 * Нарочные поломки (каждая роняет свой тест):
 *   · в NewOrder не передай lastTime в wizard — падает «мастер…»;
 *   · в fillLikeLastTime прибавляй количество (Number(q) + Number(h.quantity))
 *     вместо установки — падает «второе нажатие»;
 *   · убери проверку остатка в fillLikeLastTime — падает «без остатка».
 */

const h = vi.hoisted(() => ({
  repeatInputs: [] as Array<{ input: unknown; enabled: unknown }>,
  info: vi.fn(),
}));

const CATALOG = [
  { id: 7, code: "M-7", barcode: null, name: "Молоко", unitPrice: "10000.00", basePrice: "10000.00", unit: "pcs", available: "100", unitWeight: 1, photoUrl: null, tiers: null, priceListId: null },
  { id: 8, code: "S-8", barcode: null, name: "Сок", unitPrice: "3000.00", basePrice: "3000.00", unit: "pcs", available: "0", unitWeight: 1, photoUrl: null, tiers: null, priceListId: null },
  { id: 9, code: "R-9", barcode: null, name: "Рис", unitPrice: "15000.00", basePrice: "15000.00", unit: "kg", available: "50", unitWeight: 1, photoUrl: null, tiers: null, priceListId: null },
];
const HINTS = [
  { productId: 7, quantity: "11", orders: 3 },
  { productId: 8, quantity: "4", orders: 1 },   // кончился на складе
  { productId: 9, quantity: "1.75", orders: 2 },
];

vi.mock("@/providers/trpc", () => ({
  trpc: {
    agent: { listAgents: { useQuery: () => ({ data: undefined }) } },
    product: { listAll: { useQuery: () => ({ data: CATALOG, isLoading: false }) } },
    order: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      // Подсказка о просрочке магазина — здесь её нет (overdue-hold-ui.test.tsx).
      shopOverdue: { useQuery: () => ({ data: null }) },
      repeatDraft: {
        useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
          h.repeatInputs.push({ input, enabled: opts?.enabled });
          return { data: opts?.enabled === false ? undefined : { lastTime: HINTS } };
        },
      },
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "agent", name: "Агент" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/toast", () => ({ notify: { info: h.info, success: vi.fn(), error: vi.fn() } }));

// Мастер проверяется со своими настоящими шагами, кроме экранов: шаг «Товары» —
// заглушка, которая показывает, что ей передали.
vi.mock("@/components/orders", async () => {
  const { createElement: el } = await import("react");
  return {
    EMPTY_ITEM: { productId: 0, quantity: "", unitPrice: "", productName: "", available: "0", unit: "pcs", unitWeight: 0 },
    Steps: () => null,
    ShopSelector: () => null,
    OrderReview: () => null,
    ProductSelector: ({ lastTime }: { lastTime?: Array<{ productId: number; quantity: string }> }) =>
      el("output", { "data-testid": "hints" }, (lastTime ?? []).map(x => `${x.productId}:${x.quantity}`).join(" ")),
  };
});

const { default: NewOrder, NewOrderItemsStep } = await import("@/pages/NewOrder");
// Настоящий компонент — прямым путём, мимо заглушки общего входа.
const { ProductSelector } = await import("@/components/orders/ProductSelector");

beforeEach(() => { localStorage.clear(); h.repeatInputs = []; h.info.mockReset(); });
afterEach(cleanup);

describe("мастер заказа", () => {
  it("спрашивает «в прошлый раз» для выбранного магазина и отдаёт шагу «Товары»", () => {
    render(
      <MemoryRouter initialEntries={["/orders/new?shopId=5"]}>
        <Routes>
          <Route path="/orders/new" element={<NewOrder />}>
            <Route path="items" element={<NewOrderItemsStep />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(h.repeatInputs.some(r => (r.input as { shopId?: number }).shopId === 5 && r.enabled === true),
      "подсказку для магазина не спросили").toBe(true);
    expect(screen.getByTestId("hints").textContent, "подсказка не дошла до шага «Товары»").toBe("7:11 8:4 9:1.75");
  });
});

describe("шаг «Товары»", () => {
  function selector(items: OrderItem[], onChange = vi.fn()) {
    render(<LangProvider><ProductSelector shopId={5} items={items} onChange={onChange} lastTime={HINTS} /></LangProvider>);
    return onChange;
  }
  const line = (productId: number, quantity: string): OrderItem =>
    ({ productId, quantity, unitPrice: "1", productName: String(productId), available: "100", unit: "pcs", unitWeight: 1 });
  const got = (onChange: ReturnType<typeof vi.fn>) =>
    (onChange.mock.calls.at(-1)![0] as OrderItem[]).filter(i => i.productId > 0).map(i => `${i.productId}:${i.quantity}`);

  it("у товара — сколько брали в прошлый раз", () => {
    selector([]);
    expect(within(screen.getByTestId("product-row-7")).getByTestId("product-last-7").textContent).toMatch(/в прошлый раз: 11 шт/);
    expect(screen.getByTestId("product-last-9").textContent).toMatch(/1\.75 кг/);
  });

  it("«Как в прошлый раз» кладёт подсказанные количества; без остатка — не кладёт и говорит", () => {
    const onChange = selector([]);
    fireEvent.click(screen.getByTestId("order-like-last-time"));
    expect(got(onChange), "товар без остатка лёг в корзину").toEqual(["7:11", "9:1.75"]);
    expect(h.info).toHaveBeenCalledTimes(1);
    expect(String(h.info.mock.calls[0][0])).toContain("1");
  });

  it("второе нажатие ничего не удваивает, набранное сверх подсказки остаётся", () => {
    // В корзине уже молоко (ставится подсказка 11, а не 11 + 2) и хлеб, которого в подсказке нет.
    const onChange = selector([line(7, "2"), line(42, "3")]);
    fireEvent.click(screen.getByTestId("order-like-last-time"));
    expect(got(onChange)).toEqual(["7:11", "42:3", "9:1.75"]);
  });

  it("подсказки нет — кнопки нет", () => {
    render(<LangProvider><ProductSelector shopId={5} items={[]} onChange={() => {}} /></LangProvider>);
    expect(screen.queryByTestId("order-like-last-time")).toBeNull();
    expect(screen.queryByTestId("product-last-7")).toBeNull();
  });
});

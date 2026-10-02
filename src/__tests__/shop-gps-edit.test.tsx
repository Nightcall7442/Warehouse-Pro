// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Координаты магазина — из карточки, точкой или ссылкой на карту.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Координаты ставились только при создании магазина (ссылкой из Telegram).
 * У заведённой точки без них поправить было нечем: shop.update их принимал,
 * а в карточке поля не было. На «Карте продаж» такой магазин не появлялся, и
 * ссылка «Указать координаты» вела бы в никуда.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  • ?edit=gps открывает карточку сразу в правке — тому, кто её правит;
 *  • «41.5530, 60.6318» и ссылка Яндекса (pt=долгота,широта) уходят в
 *    shop.update широтой и долготой, не перепутанными;
 *  • не координаты — сказано словами, «Сохранить» заперта;
 *  • супервайзеру (карточку не правит) ?edit=gps правку не открывает.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • убрать `&& canEdit` у условия правки — падает «супервайзеру»;
 *  • убрать проверку gpsText у «Сохранить» — падает «не координаты».
 */

const h = vi.hoisted(() => ({
  settingsSave: vi.fn(),
  shopUpdate: vi.fn(),
  overdue: null as null | { amount: number; oldestDays: number; graceDays: number },
  role: "ceo",
}));

vi.mock("@/providers/trpc", () => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isLoadingError: false, isError: false, refetch: vi.fn() });
  const mutation = (fn?: (v: unknown) => void) => () => ({ mutate: (v: unknown) => fn?.(v), isPending: false });
  const shop = {
    id: 5, name: "Магазин Альфа", ownerName: null, phone: null, address: null, city: null, district: null,
    photoUrl: null, gpsLat: null, gpsLng: null, debt: "0.00", status: "active", agentId: null, notes: null,
    createdAt: "2026-09-01T00:00:00.000Z", taxId: null, vatPayer: false, creditLimit: "5000000.00", paymentGraceDays: 30,
    agent: null, recentOrders: [], paymentHistory: [],
  };
  return {
    trpc: {
      settings: {
        get: { useQuery: query({ companyName: "SERENA TRADE", currency: "UZS", overdueHoldEnabled: false, overdueGraceDays: 14 }) },
        update: { useMutation: mutation(v => h.settingsSave(v)) },
      },
      shop: {
        getById: { useQuery: query(shop) },
        trace: { useQuery: query(null) },
        update: { useMutation: mutation(v => h.shopUpdate(v)) },
        uploadPhoto: { useMutation: mutation() }, archive: { useMutation: mutation() },
        restore: { useMutation: mutation() }, deleteForever: { useMutation: mutation() },
        addPayment: { useMutation: mutation() },
        // Светофор карточки (components/shops/ShopLight) — здесь не проверяется.
        light: { useQuery: query(null) },
      },
      user: { list: { useQuery: query({ data: [] }) } },
      order: { shopOverdue: { useQuery: () => ({ data: h.overdue }) } },
      useUtils: () => ({ settings: { get: { invalidate: vi.fn() } }, shop: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, name: "Кто-то", role: h.role }, isLoading: false }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум` }) }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/components/plans/VisitReports", () => ({ ShopVisitReports: () => null }));
vi.mock("@/components/shops/ShopStatement", () => ({ ShopStatement: () => null }));
vi.mock("@/components/shops/ShopMoney", () => ({ ShopMoney: () => null }));
vi.mock("@/components/shops/ShopPriceList", () => ({ ShopPriceList: () => null }));
vi.mock("@/components/orders/RepeatOrderButtons", () => ({ ShopOrderButtons: () => null }));
vi.mock("@/components/returns/WebReturn", () => ({ ShopReturnButton: () => null }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));


import ShopDetail from "@/pages/ShopDetail";

beforeEach(() => {
  localStorage.clear();
  h.shopUpdate.mockReset(); h.role = "ceo";
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (url: string) => render(
  <LangProvider>
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/shops/:id" element={<ShopDetail />} /></Routes>
    </MemoryRouter>
  </LangProvider>,
);

describe("координаты в карточке магазина", () => {
  it("?edit=gps открывает правку; точка уходит широтой и долготой", () => {
    open("/shops/5?edit=gps");
    const input = screen.getByTestId("shop-gps-input");
    fireEvent.change(input, { target: { value: "41.5530, 60.6318" } });
    expect(screen.getByText("Точка: 41.55300, 60.63180")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(h.shopUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 5, gpsLat: "41.55300000", gpsLng: "60.63180000" }));
  });

  it("ссылка Яндекса: pt=долгота,широта — не перепутано", () => {
    open("/shops/5?edit=gps");
    fireEvent.change(screen.getByTestId("shop-gps-input"), { target: { value: "https://yandex.uz/maps/?pt=60.6318,41.553&z=17" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(h.shopUpdate).toHaveBeenCalledWith(expect.objectContaining({ gpsLat: "41.55300000", gpsLng: "60.63180000" }));
  });

  it("не координаты — сказано словами, сохранить нельзя", () => {
    open("/shops/5?edit=gps");
    fireEvent.change(screen.getByTestId("shop-gps-input"), { target: { value: "у рынка" } });
    expect(screen.getByText(/Не похоже на координаты/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Сохранить/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("супервайзеру ?edit=gps правку не открывает", () => {
    h.role = "supervisor";
    open("/shops/5?edit=gps");
    expect(screen.queryByTestId("shop-gps-input")).toBeNull();
  });
});

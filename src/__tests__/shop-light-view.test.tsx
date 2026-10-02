// @vitest-environment jsdom
/**
 * Светофор на экране: карточка с цифрами и причиной, значки в списках.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В карточке магазина был один долг числом; в списках — тоже. Можно ли
 * грузить, приходилось собирать по трём экранам.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Красный: подпись цвета, причина словами («Просрочено 800 000 сум, самый
 *     старый — 40 дн.»), цифры — долг, просрочено, лимит, средний чек, дни с
 *     прошлого заказа и обычный интервал, последняя причина «без заказа».
 *  2. Зелёный: «долг в норме», мало заказов — «ритм не ясен», без лимита.
 *  3. hideDebt (агентская карточка, долг уже выше) — долга в цифрах нет.
 *  4. Списки: значок с цветом у каждой строки, у которой есть светофор; нет
 *     светофора (чужой магазин) — нет значка. Директорский ShopList и
 *     телефонный ShopBrowser берут светофоры одним запросом на видимые строки.
 *
 * Нарочная поломка: в ShopLight.tsx убрать `!hideDebt &&` у цифры долга —
 * падает 3; в ShopBrowser не передать `light={…}` в карточку — падает 4б.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import type { ShopLight } from "@contracts/shop-light";

const h = vi.hoisted(() => ({ asked: [] as number[][], lights: [] as unknown[] }));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} сум` }) }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    shop: {
      lights: { useQuery: (input: { shopIds: number[] }) => { h.asked.push(input.shopIds); return { data: h.lights }; } },
      uploadPhoto: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "ceo" } }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { ShopLightView } = await import("@/components/shops/ShopLight");
const { ShopList } = await import("@/components/shops/ShopList");
const { ShopBrowser } = await import("@/components/phone/ShopBrowser");

const light = (over: Partial<ShopLight> = {}): ShopLight => ({
  shopId: 1, color: "green", reasons: [], debt: 0, overdue: 0, oldestOverdueDays: 0, graceDays: 14, holdsOrders: false,
  creditLimit: null, avgCheck: null, avgCheckOrders: 0, daysSinceOrder: null, usualIntervalDays: null, lastNoOrder: null, ...over,
});

afterEach(() => { cleanup(); h.asked = []; h.lights = []; });

describe("карточка светофора", () => {
  it("1. красный: подпись, причина словами и все цифры", () => {
    render(<ShopLightView light={light({
      color: "red", debt: 1_200_000, overdue: 800_000, oldestOverdueDays: 40, holdsOrders: true,
      reasons: [{ code: "overdue", amount: 800_000, oldestDays: 40 }, { code: "long_pause", daysSince: 30, usualDays: 7 }],
      creditLimit: 2_000_000, avgCheck: 450_000, avgCheckOrders: 6, daysSinceOrder: 30, usualIntervalDays: 7,
      lastNoOrder: { reason: "no_money", note: null, date: "2026-09-28" },
    })} />);
    expect(screen.getByTestId("shop-light").getAttribute("data-color")).toBe("red");
    expect(screen.getByTestId("shop-light-label").textContent).toBe("Грузить рискованно");
    const reasons = screen.getByTestId("shop-light-reasons").textContent;
    expect(reasons).toContain("Просрочено 800 000 сум, самый старый — 40 дн.");
    expect(reasons).toContain("Не заказывает 30 дн., обычно — раз в 7 дн.");
    expect(screen.getByText(/встанет на проверку офиса/)).toBeTruthy();
    const figures = screen.getByTestId("shop-light-figures").textContent ?? "";
    for (const part of ["1 200 000 сум", "800 000 сум", "самый старый — 40 дн.", "2 000 000 сум", "занято 60%", "450 000 сум", "заказов: 6", "30 дн.", "обычно раз в 7 дн.", "Нет денег", "28.09.2026"]) {
      expect(figures, `в цифрах нет «${part}»`).toContain(part);
    }
  });

  it("2. зелёный: «долг в норме», ритм не ясен, без лимита", () => {
    render(<ShopLightView light={light({ daysSinceOrder: 100 })} />);
    expect(screen.getByTestId("shop-light-label").textContent).toBe("Всё в порядке");
    expect(screen.getByTestId("shop-light-reasons").textContent).toBe("Долг в норме, заказывает в своём ритме");
    const figures = screen.getByTestId("shop-light-figures").textContent ?? "";
    expect(figures).toContain("ритм не ясен: мало заказов");
    expect(figures).toContain("без лимита");
    expect(figures).toContain("отсрочка 14 дн.");
  });

  it("3. hideDebt — долга в цифрах нет", () => {
    render(<ShopLightView light={light({ debt: 5000 })} hideDebt />);
    expect(within(screen.getByTestId("shop-light-figures")).queryByText("Долг")).toBeNull();
  });
});

describe("значки в списках", () => {
  const rows = [1, 2, 3].map(id => ({ id, name: `Магазин ${id}`, ownerName: null, phone: null, city: null, district: null, debt: "0.00", status: "active", photoUrl: null }));

  it("4а. ShopList директора: значок у строк со светофором, без — нет", () => {
    const map = new Map<number, ShopLight>([[1, light({ shopId: 1, color: "red", reasons: [{ code: "over_limit", debt: 2, limit: 1 }] })], [2, light({ shopId: 2, color: "yellow", reasons: [{ code: "near_limit", debt: 8, limit: 10, pct: 80 }] })]]);
    render(<ShopList data={rows as never} isLoading={false} lang="ru" fmt={v => String(v)} selected={new Set()} allSelected={false}
      onSelectAll={() => {}} onToggleSelect={() => {}} onNavigate={() => {}} page={1} setPage={() => {}} total={3} t={ru => ru} lights={map} />);
    const cards = screen.getAllByTestId("shop-row");
    expect(cards.map(c => c.querySelector("[data-testid=shop-light-dot]")?.getAttribute("data-color") ?? null)).toEqual(["red", "yellow", null]);
    expect(cards[0].querySelector("[data-testid=shop-light-dot]")?.getAttribute("aria-label")).toBe("Грузить рискованно. Долг 2 сум больше лимита 1 сум");
  });

  it("4б. ShopBrowser телефона: один запрос на видимые строки, значки по ответу", () => {
    h.lights = [light({ shopId: 2, color: "yellow", reasons: [{ code: "long_pause", daysSince: 40, usualDays: 10 }] })];
    render(<ShopBrowser shops={rows} onOpen={() => {}} />);
    fireEvent.click(screen.getByText("Все магазины"));
    expect(h.asked.at(-1)).toEqual([1, 2, 3]);
    const cards = screen.getAllByTestId("phone-shop-card");
    expect(cards.map(c => c.querySelector("[data-testid=shop-light-dot]")?.getAttribute("data-color") ?? null)).toEqual([null, "yellow", null]);
  });
});

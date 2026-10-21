// @vitest-environment jsdom
/**
 * Блок «Доставка» в карточке заказа: день доставки и ссылка для магазина.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. «Назначить день доставки» — только офису и только у заказа в развозе;
 *     офис может вернуть заказ на сегодня.
 *  2. «Ссылка для магазина» просит ссылку по нажатию и даёт Telegram
 *     обычной ссылкой с адресом внутри; отменённому и давно доставленному
 *     заказу ссылки нет.
 *
 * Нарочная поломка: убери canReschedule из условия кнопки в
 * OrderDeliveryCard — падает 1.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { bizToday } from "@/lib/business-time";

const h = vi.hoisted(() => ({ office: [] as unknown[], linkFetches: 0 }));

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    courier: {
      officeReschedule: { useMutation: () => ({ mutate: (v: unknown) => { h.office.push(v); }, isPending: false }) },
    },
    useUtils: () => ({
      order: { trackingLink: { fetch: async ({ id }: { id: number }) => { h.linkFetches++; return { url: `https://app.example.test/t/${id}.sig`, number: "ORD-5" }; } } },
    }),
  },
}));

const { OrderDeliveryCard } = await import("./OrderDeliveryCard");

beforeEach(() => { h.office = []; h.linkFetches = 0; });
afterEach(cleanup);

describe("«Доставка» в карточке заказа", () => {
  const base = {
    id: 5, orderNumber: "ORD-5", status: "shipped", deliveryStatus: "assigned", deliveredAt: null, deletedAt: null,
    courierId: 7, plannedDeliveryDate: "2026-10-23", deliveryEvents: [], shopName: "Хумо",
  };

  it("1. офису — день доставки у заказа в развозе, и на сегодня тоже", () => {
    render(<OrderDeliveryCard order={base} canReschedule asOf={Date.now()} />);
    expect(screen.getByTestId("delivery-planned").textContent).toContain("23.10");
    fireEvent.click(screen.getByTestId("office-reschedule"));
    const today = bizToday();
    fireEvent.click(screen.getByTestId(`reschedule-day-${today}`));
    fireEvent.click(screen.getByTestId("reschedule-confirm"));
    expect(h.office).toEqual([{ orderId: 5, date: today }]);
    cleanup();

    render(<OrderDeliveryCard order={base} canReschedule={false} asOf={Date.now()} />);
    expect(screen.queryByTestId("office-reschedule"), "агенту — нет").toBeNull();
    cleanup();
    render(<OrderDeliveryCard order={{ ...base, courierId: null, deliveryStatus: "not_assigned" }} canReschedule asOf={Date.now()} />);
    expect(screen.queryByTestId("office-reschedule"), "без курьера — нет").toBeNull();
  });

  it("2. ссылка — по нажатию, Telegram — обычной ссылкой; отменённому — нет", async () => {
    render(<OrderDeliveryCard order={base} canReschedule={false} asOf={Date.now()} />);
    expect(h.linkFetches, "при открытии карточки ссылка не просится").toBe(0);
    expect(screen.queryByTestId("tracking-link-telegram")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("tracking-link-copy")); });
    expect(h.linkFetches).toBe(1);
    expect((screen.getByTestId("tracking-link-url") as HTMLInputElement).value).toBe("https://app.example.test/t/5.sig");
    const tg = screen.getByTestId("tracking-link-telegram").getAttribute("href") ?? "";
    expect(tg.startsWith("https://t.me/share/url?url=")).toBe(true);
    expect(decodeURIComponent(tg)).toContain("https://app.example.test/t/5.sig");
    cleanup();

    render(<OrderDeliveryCard order={{ ...base, status: "cancelled" }} canReschedule asOf={Date.now()} />);
    expect(screen.queryByTestId("tracking-link")).toBeNull();
    cleanup();
    const weekAgo = Date.now() - 7 * 86_400_000;
    render(<OrderDeliveryCard order={{ ...base, status: "delivered", deliveryStatus: "delivered", deliveredAt: new Date(weekAgo) }} canReschedule asOf={Date.now()} />);
    expect(screen.queryByTestId("tracking-link"), "доставлен давно — ссылки нет").toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * «Магазины» агента: рисуется сотня карточек, поиск идёт по всем.
 *
 * Что было: список агента (pages/AgentShops) и режимы телефона
 * (components/phone/ShopBrowser — «Все магазины», территория, поиск,
 * «ближайшие») рисовали каждую точку организации карточкой. У клиента с
 * тремя тысячами магазинов — десятки тысяч узлов DOM; дешёвый Android
 * открывал раздел секундами и перерисовывал всё на каждую букву поиска.
 *
 * Что проверяется — поведением, а не текстом исходника:
 *   · в каждом режиме видно ровно 100 карточек и кнопка «Показать ещё»
 *     с остатком; нажатие добавляет следующую сотню, на хвосте кнопка
 *     пропадает;
 *   · поиск находит 237-й магазин — отбор по всему списку, режется только
 *     отрисовка; новый поиск начинает окно с начала;
 *   · «ближайшие» — первая сотня БЛИЖАЙШИХ, а не первая сотня по алфавиту,
 *     отсортированная по расстоянию;
 *   · то же на странице для компьютера.
 *
 * Нарочная поломка: в useRenderWindow верни `shown: items` — падают все
 * «ровно 100»; в ShopBrowser обрежь список до сотни ДО отбора
 * (`shops.slice(0, 100).filter(…)`) — падают поиск 237-го и «ближайшие»;
 * убери сброс окна по ключу — падает «новый поиск начинает с начала».
 */
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));

const h = vi.hoisted(() => ({ shops: [] as Array<Record<string, unknown>>, phone: false }));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    agent: { myShops: { useQuery: () => ({ data: h.shops, isLoading: false, isLoadingError: false, refetch: vi.fn() }) } },
    // Светофоры видимого окна (components/shops/shop-light-ui) — здесь пусто.
    shop: { lights: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({}),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, role: "agent" } }) }));
vi.mock("@/hooks/useOfflineCopy", () => ({ useOfflineCopy: (_k: string, live: unknown) => ({ data: live, fromCopy: false, savedAt: null }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => h.phone }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { ShopBrowser } from "@/components/phone/ShopBrowser";
import AgentShops from "@/pages/AgentShops";

const pad = (n: number) => String(n).padStart(3, "0");
/*
  250 точек в двух районах по 125 — чтобы и «Все магазины», и территория были
  длиннее окна. Широта растёт с номером: ближайшая к «здесь» (41.5) — 250-я,
  то есть последняя по алфавиту.
*/
const SHOPS = Array.from({ length: 250 }, (_, i) => ({
  id: i + 1,
  name: `Магазин ${pad(i + 1)}`,
  district: i % 2 === 0 ? "Марказ" : "Ёшлик",
  status: "active",
  gpsLat: String(41 + (i + 1) / 1000),
  gpsLng: "69.2",
}));

const cardNames = () => screen.queryAllByTestId("phone-shop-card").map(c => c.textContent?.match(/Магазин \d{3}/)?.[0]);
const moreBtn = () => screen.queryByTestId("phone-shops-show-more");
const search = (text: string) => fireEvent.change(screen.getByPlaceholderText("Поиск магазинов…"), { target: { value: text } });

beforeEach(() => { cleanup(); h.shops = SHOPS; h.phone = false; });

describe("телефон: ShopBrowser рисует окно из 100", () => {
  it("«Все магазины»: ровно 100, дальше по кнопке, на хвосте кнопки нет", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    // Счёт на строке «Все магазины» — по всем, а не по нарисованным.
    expect(screen.getAllByTestId("phone-territory")[0].textContent).toContain("250 магазинов");
    fireEvent.click(screen.getByText("Все магазины"));

    expect(cardNames()).toHaveLength(100);
    expect(cardNames()[0]).toBe("Магазин 001");
    expect(moreBtn()?.textContent).toBe("Показать ещё 100 (осталось 150)");

    fireEvent.click(moreBtn()!);
    expect(cardNames()).toHaveLength(200);
    expect(moreBtn()?.textContent).toBe("Показать ещё 50 (осталось 50)");

    fireEvent.click(moreBtn()!);
    expect(cardNames()).toHaveLength(250);
    expect(cardNames()[249]).toBe("Магазин 250");
    expect(moreBtn()).toBeNull();
  });

  it("территория длиннее окна — тоже 100 и кнопка", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    fireEvent.click(screen.getByText("Марказ"));
    expect(cardNames()).toHaveLength(100);
    expect(moreBtn()?.textContent).toBe("Показать ещё 25 (осталось 25)");
    fireEvent.click(moreBtn()!);
    expect(cardNames()).toHaveLength(125);
    expect(moreBtn()).toBeNull();
  });

  it("поиск находит 237-й магазин: отбор по всему списку", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    search("Магазин 237");
    expect(cardNames()).toEqual(["Магазин 237"]);
    expect(moreBtn()).toBeNull();

    // Поиск, под который попадает больше сотни точек (все с единицей в номере), — окно из 100.
    search("1");
    const hits = SHOPS.filter(s => s.name.includes("1")).length;
    expect(hits).toBeGreaterThan(100);
    expect(cardNames()).toHaveLength(100);
    expect(moreBtn()?.textContent).toBe(`Показать ещё ${hits - 100} (осталось ${hits - 100})`);
  });

  it("новый поиск начинает с начала", () => {
    render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
    search("Магазин");
    fireEvent.click(moreBtn()!);
    expect(cardNames()).toHaveLength(200);

    search("агазин"); // те же 250 точек, другой запрос
    expect(cardNames(), "окно не сбросилось на новый поиск").toHaveLength(100);
  });

  it("«ближайшие»: первая сотня ближайших, а не первая сотня по алфавиту", async () => {
    const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
      ok({ coords: { latitude: 41.5, longitude: 69.2 } }));
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    try {
      render(<ShopBrowser shops={SHOPS} onOpen={() => {}} />);
      await act(async () => { fireEvent.click(screen.getByLabelText("Сначала ближайшие")); });
      const names = cardNames();
      expect(names).toHaveLength(100);
      expect(names[0]).toBe("Магазин 250");
      expect(names[99]).toBe("Магазин 151");
      expect(moreBtn()?.textContent).toBe("Показать ещё 100 (осталось 150)");
    } finally {
      delete (navigator as { geolocation?: unknown }).geolocation;
    }
  });
});

describe("компьютер: AgentShops рисует окно из 100", () => {
  const page = () => render(<MemoryRouter><AgentShops /></MemoryRouter>);
  const desktopNames = () => screen.queryAllByText(/^Магазин \d{3}$/).map(n => n.textContent);
  const desktopMore = () => screen.queryByTestId("agent-shops-show-more");

  it("100 карточек, «Показать ещё» до конца; поиск находит 237-й", () => {
    page();
    // Заголовок считает все магазины, а не нарисованные.
    expect(screen.getByText(/250 магазинов/)).toBeTruthy();
    expect(desktopNames()).toHaveLength(100);
    expect(desktopMore()?.textContent).toBe("Показать ещё 100 (осталось 150)");
    fireEvent.click(desktopMore()!);
    fireEvent.click(desktopMore()!);
    expect(desktopNames()).toHaveLength(250);
    expect(desktopMore()).toBeNull();

    search("Магазин 237");
    expect(desktopNames()).toEqual(["Магазин 237"]);
  });

  it("на телефоне страница отдаёт весь список ShopBrowser — окно режет там", () => {
    h.phone = true;
    page();
    search("Магазин");
    expect(cardNames()).toHaveLength(100);
    search("Магазин 250");
    expect(cardNames()).toEqual(["Магазин 250"]);
  });
});

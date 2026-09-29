// @vitest-environment jsdom
/**
 * Магазин для заказа, отчёта и расписания ищется на сервере — давний тоже.
 *
 * Что было: окно быстрого заказа (главный путь заказа по телефону), первый шаг
 * мастера /orders/new, фильтр магазина в отчётах и расписание визитов грузили
 * 200–500 САМЫХ НОВЫХ магазинов и искали в них у себя. У организации с 3 400
 * точками давние — основные — клиенты не находились никак, а номер телефона не
 * искался вовсе, хотя сервер по нему ищет.
 *
 * Что проверяется: во всех четырёх местах строка поиска уходит на сервер
 * (agent.availableShops), и находится 600-й по новизне магазин — по названию,
 * по телефону, по району; выбранный магазин не пропадает, когда поиск его уже
 * не возвращает. Сервер здесь — подделка, которая ищет честно и отдаёт не
 * больше limit; shop.list подделан так, как он работал раньше: 500 новейших.
 *
 * Нарочная поломка: в QuickOrderModal верни shop.list({ pageSize: 500 }) с
 * фильтром у себя — падают «быстрый заказ»; в useShopSearch не передавай search
 * на сервер — падают все четыре; убери pinned — падают «выбранный остаётся».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LangProvider } from "@/i18n";

const h = vi.hoisted(() => {
  // id 1 — самый старый; чем больше id, тем новее.
  const shops = Array.from({ length: 600 }, (_, i) => {
    const id = i + 1;
    return id === 1
      ? { id, name: "Старый Барака", ownerName: "Алишер", phone: "+998 90 111 22 33", district: "Чиланзар", city: "Ташкент", address: null, status: "active", photoUrl: null, debt: "150000.00", gpsLat: null, gpsLng: null }
      : { id, name: `Магазин ${String(id).padStart(3, "0")}`, ownerName: null, phone: `+998 97 000 ${String(id).padStart(4, "0")}`, district: "Юнусабад", city: "Ташкент", address: null, status: "active", photoUrl: null, debt: "0.00", gpsLat: null, gpsLng: null };
  });
  return { shops, calls: [] as Array<{ search?: string; limit?: number }> };
});

vi.mock("@/providers/trpc", () => {
  const q = (data: unknown) => ({ useQuery: () => ({ data, isLoading: false }) });
  const m = () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) });
  return {
    trpc: {
      agent: {
        // Сервер: ищет по названию, владельцу, телефону, району, городу; не больше limit; по алфавиту.
        availableShops: {
          useQuery: (input: { search?: string; limit?: number } = {}, opts?: { enabled?: boolean }) => {
            if (opts?.enabled === false) return { data: undefined, isLoading: false };
            h.calls.push(input);
            const s = (input.search ?? "").toLowerCase();
            const hit = h.shops.filter(x => !s || [x.name, x.ownerName, x.phone, x.district, x.city].some(v => v?.toLowerCase().includes(s)));
            const data = [...hit].sort((a, b) => a.name.localeCompare(b.name, "ru")).slice(0, input.limit ?? hit.length);
            return { data, isLoading: false };
          },
        },
        myShops: q(h.shops),
        listAgents: q([{ id: 7, name: "Агент Бобур" }]),
      },
      // Как было: 500 самых новых.
      shop: { list: q({ data: [...h.shops].reverse().slice(0, 500), total: 600 }) },
      product: { listAll: q([{ id: 1, code: "A-1", barcode: null, name: "Печенье", unitPrice: "1000.00", available: "50", tiers: null }]) },
      priceList: { forShop: q({ current: null, lists: [] }) },
      order: { create: m() },
      schedule: { list: q([]), create: m(), delete: m(), generatePlans: m() },
      useUtils: () => ({ schedule: { list: { invalidate: vi.fn(), cancel: vi.fn(), getData: vi.fn(), setData: vi.fn() } } }),
    },
  };
});
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "operator" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// Выпадающий список — родным <select>: проверяются пикеры, а не список.
vi.mock("@/components/PremiumSelect", async () => {
  const { createElement: el } = await import("react");
  return {
    PremiumSelect: ({ value, onChange, options, "aria-label": label }: {
      value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; "aria-label"?: string;
    }) => el("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
      options.map(o => el("option", { key: o.value, value: o.value }, o.label))),
  };
});

const { QuickOrderModal } = await import("@/components/orders/QuickOrderModal");
const { ShopSelector } = await import("@/components/orders/ShopSelector");
const { ReportFilter } = await import("@/components/reports/ReportFilters");
const { ScheduleManager } = await import("@/components/plans/ScheduleManager");

afterEach(() => { cleanup(); h.calls.length = 0; });

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const OLDEST = /Старый Барака/;

describe("быстрый заказ: магазин ищется на сервере", () => {
  const open = () => render(<LangProvider><QuickOrderModal open onOpenChange={() => {}}
    initialItem={{ productId: 1, name: "Печенье", code: "A-1", unitPrice: 1000, quantity: 1 }} /></LangProvider>);
  const search = () => screen.getByPlaceholderText(/Поиск магазина по названию/);

  it("самый старый из 600 находится по названию, телефону и району", async () => {
    open();
    type(search(), "Старый");
    expect(await screen.findByRole("button", { name: OLDEST })).toBeTruthy();
    expect(h.calls.at(-1), "поиск не ушёл на сервер").toMatchObject({ search: "Старый", limit: 30 });

    type(search(), "111 22 33");
    expect(await screen.findByRole("button", { name: OLDEST }), "по телефону не нашёлся").toBeTruthy();

    type(search(), "Чиланзар");
    expect(await screen.findByRole("button", { name: OLDEST }), "по району не нашёлся").toBeTruthy();
  });

  it("выбранный остаётся на экране и доходит до «Шага 2», когда поиск его уже не возвращает", async () => {
    open();
    type(search(), "111 22 33");
    fireEvent.click(await screen.findByRole("button", { name: OLDEST }));
    type(search(), "Магазин 59");
    await screen.findByRole("button", { name: /Магазин 590/ });
    expect(screen.getByRole("button", { name: OLDEST }), "выбранный магазин пропал из списка").toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Далее$/ }));
    expect(document.body.textContent, "в «Шаге 2» нет выбранного магазина").toContain("Старый Барака");
  });
});

describe("мастер /orders/new, шаг 1", () => {
  it("находит давний магазин по телефону; выбранный виден без поиска", async () => {
    const onSelect = vi.fn();
    render(<LangProvider><ShopSelector shopId={0} onSelect={onSelect} /></LangProvider>);
    type(screen.getByPlaceholderText("Поиск магазинов…"), "90 111");
    fireEvent.click(await screen.findByRole("button", { name: OLDEST }));
    expect(onSelect).toHaveBeenCalledWith(1, "Старый Барака");
    cleanup();

    // Вернулись на шаг 1: поиск пуст, первые 30 по алфавиту — «Магазин …», но выбранный на месте.
    render(<LangProvider><ShopSelector shopId={1} shopName="Старый Барака" onSelect={onSelect} /></LangProvider>);
    expect(screen.getByRole("button", { name: OLDEST }), "выбранный магазин не показан").toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(30);
  });
});

describe("отчёты: фильтр магазина", () => {
  it("давний магазин выбирается поиском и не пропадает из поля при следующем поиске", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<LangProvider><ReportFilter kind="shop" value={{}} onChange={onChange} t={ru => ru} style={{}} /></LangProvider>);
    type(screen.getByLabelText("Поиск магазина"), "Алишер");
    const select = screen.getByLabelText("Все магазины") as HTMLSelectElement;
    await within(select).findByRole("option", { name: "Старый Барака" });
    type(select, "1");
    expect(onChange).toHaveBeenCalledWith({ shopId: 1 });

    rerender(<LangProvider><ReportFilter kind="shop" value={{ shopId: 1 }} onChange={onChange} t={ru => ru} style={{}} /></LangProvider>);
    type(screen.getByLabelText("Поиск магазина"), "Магазин 1");
    await within(select).findByRole("option", { name: "Магазин 100" });
    expect(within(select).getByRole("option", { name: "Старый Барака" }), "выбранный магазин исчез из поля").toBeTruthy();
    expect(select.value).toBe("1");
  });
});

describe("расписание визитов", () => {
  it("давний магазин ставится в расписание: он находится поиском", async () => {
    render(<LangProvider><ScheduleManager lang="ru" /></LangProvider>);
    type(screen.getByLabelText("Агент"), "7");
    type(screen.getByPlaceholderText("Поиск магазина…"), "Старый");
    expect(await screen.findByTestId("schedule-1-1"), "давнего магазина нет в таблице").toBeTruthy();
    expect(h.calls.at(-1)).toMatchObject({ search: "Старый", limit: 50 });
  });
});

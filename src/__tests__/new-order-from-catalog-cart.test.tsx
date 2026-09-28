// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import type { OrderItem } from "@/components/orders/types";
import { addToCart, loadCart } from "@/lib/catalog-cart";
import { setSessionOwner } from "@/lib/offline-copy";

/**
 * Заказ из корзины каталога — настоящий мастер NewOrder, а не текст файла.
 *
 * Прежний страж искал в исходнике строку `if (user && fromCart) clearCart`
 * и был зелёным, пока она не работала: признак читался из адреса на каждой
 * отрисовке, а шаги ходят по адресам без ?fromCart. Здесь мастер проходится
 * целиком — магазин, товары, итог, отправка — с настоящими корзиной и
 * черновиком (localStorage), подменены только сервер и сами экраны шагов.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · верни `const fromCart = searchParams.get("fromCart") === "1"` —
 *     «после отправки корзина пуста»;
 *   · убери clearCart из офлайн-ветки — «офлайн: корзина пуста…»;
 *   · верни эффекту живой признак из адреса и убери cartApplied —
 *     «назад на магазин не затирает добавленное»;
 *   · убери cartApplied — «пользователь пропал и вернулся…»;
 *   · отдай шагам items вместо pricedItems — «строки из корзины
 *     переоцениваются…»; офлайн-итог по items — «офлайн: …итог — по ценам
 *     магазина»;
 *   · верни pricedItems цену при одной штуке (p.unitPrice без priceAt) —
 *     «количество перешло ступень…»;
 *   · верни каталогу NewOrder только живой ответ (без useShopPrices) —
 *     «перезагрузка без связи: …по ступени из копии этого магазина»;
 *   · сделай ключ копии общим для всех магазинов (keyFor без scope) —
 *     «без связи копия другого магазина не берётся».
 */

const h = vi.hoisted(() => {
  // Прайс магазина — как вернёт product.listAll({ shopId }): 7 у магазина 5
  // дешевле карточки и со ступенью «от 10 — 8500», у магазина 6 — дороже и
  // без ступеней.
  type Tier = { minQuantity: string; price: string; priority: number };
  const prices: Record<number, Array<{ id: number; unitPrice: string; tiers: Tier[] | null }>> = {
    5: [
      { id: 7, unitPrice: "10000.00", tiers: [
        { minQuantity: "1.00", price: "10000.00", priority: 0 },
        { minQuantity: "10.00", price: "8500.00", priority: 0 },
      ] },
      { id: 8, unitPrice: "3000.00", tiers: null },
    ],
    6: [{ id: 7, unitPrice: "13000.00", tiers: null }, { id: 8, unitPrice: "3000.00", tiers: null }],
  };
  return {
    prices,
    user: { id: 1, role: "agent", name: "Агент" } as { id: number; role: string; name: string } | null,
    sent: [] as unknown[],
    onSuccess: null as null | ((r: { held: boolean }) => void),
    savePendingOrder: vi.fn(),
    info: [] as string[],
    // Нет связи: сервер не отвечает, живого каталога нет.
    offline: false,
  };
});

vi.mock("@/providers/trpc", () => ({
  trpc: {
    agent: { listAgents: { useQuery: () => ({ data: undefined }) } },
    product: {
      listAll: {
        useQuery: (input?: { shopId?: number }, opts?: { enabled?: boolean }) =>
          ({ data: h.offline || opts?.enabled === false || !input?.shopId ? undefined : h.prices[input.shopId] }),
      },
    },
    order: {
      create: {
        useMutation: (opts: { onSuccess: (r: { held: boolean }) => void }) => {
          h.onSuccess = opts.onSuccess;
          // Сервер принял — сразу отвечает успехом, как настоящий onSuccess.
          return { mutate: (p: unknown) => { h.sent.push(p); h.onSuccess?.({ held: false }); }, isPending: false };
        },
      },
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/lib/toast", () => ({
  notify: { info: (m: string) => { h.info.push(m); }, success: () => {}, error: () => {} },
}));
vi.mock("@/pages/OfflineOrders.helpers", () => ({
  savePendingOrder: (...args: unknown[]) => h.savePendingOrder(...args),
}));

// Экраны шагов — заглушки: проверяется родитель, который держит заказ.
vi.mock("@/components/orders", async () => {
  const { createElement: el } = await import("react");
  const line = (i: OrderItem) => `${i.productId}×${i.quantity}@${i.unitPrice}`;
  const lines = (items: OrderItem[]) => items.filter(i => i.productId > 0).map(line).join(" ");
  return {
    EMPTY_ITEM: { productId: 0, quantity: "", unitPrice: "", productName: "", available: "0", unit: "pcs", unitWeight: 0 },
    Steps: () => null,
    ShopSelector: ({ onSelect }: { onSelect: (id: number, name: string) => void }) => el("div", null,
      el("button", { onClick: () => onSelect(5, "Барака") }, "shop-5"),
      el("button", { onClick: () => onSelect(6, "Гулистон") }, "shop-6")),
    ProductSelector: ({ items, onChange }: { items: OrderItem[]; onChange: (v: OrderItem[]) => void }) => el("div", null,
      el("output", { "data-testid": "lines" }, lines(items)),
      el("button", {
        onClick: () => onChange([...items, { productId: 8, productName: "Сок", unitPrice: "3000.00", quantity: "1", available: "9", unit: "pcs", unitWeight: 1 }]),
      }, "add-8"),
      // Количество молока, как его набирают в корзине. Строки приходят сюда
      // уже переоцененными — и уходят обратно с той ценой, что была.
      ...["2", "12"].map(q => el("button", {
        key: q, onClick: () => onChange(items.map(i => i.productId === 7 ? { ...i, quantity: q } : i)),
      }, `qty-7-${q}`))),
    OrderReview: ({ items }: { items: OrderItem[] }) => el("output", { "data-testid": "review" }, lines(items)),
  };
});

const { default: NewOrder, NewOrderShopStep, NewOrderItemsStep, NewOrderReviewStep } = await import("@/pages/NewOrder");

// Товар 7 лежит в корзине по цене карточки — так его кладёт каталог.
const MILK = { productId: 7, productName: "Молоко", unitPrice: "12000.00", available: "40", unit: "pcs", unitWeight: 1 };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function tree() {
  return (
    <MemoryRouter initialEntries={["/catalog", "/orders/new?fromCart=1"]} initialIndex={1}>
      <Where />
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
}

const click = (name: string) => fireEvent.click(screen.getByText(name));
const next = () => fireEvent.click(screen.getByTestId("order-next"));
const back = () => fireEvent.click(screen.getByLabelText("Назад"));
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  localStorage.clear();
  // Владельца копий кладёт настоящий useAuth, здесь он подменён.
  setSessionOwner(1);
  h.offline = false;
  h.user = { id: 1, role: "agent", name: "Агент" };
  h.sent = [];
  h.info = [];
  h.savePendingOrder.mockReset().mockResolvedValue(undefined);
  addToCart(1, MILK, 2);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("корзина уезжает в заказ и больше не висит", () => {
  it("после отправки корзина пуста — признак «из корзины» пережил шаги", () => {
    render(tree());
    click("shop-5"); next();
    expect(where()).toBe("/orders/new/items");
    expect(screen.getByTestId("lines").textContent).toContain("7×2@");
    next(); next();

    expect(h.sent).toHaveLength(1);
    expect((h.sent[0] as { items: unknown }).items).toEqual([{ productId: 7, quantity: "2" }]);
    expect(where()).toBe("/agent");
    expect(loadCart(1), "корзина осталась полной — агент оформит заказ второй раз").toEqual([]);
  });

  it("офлайн: корзина пуста после записи в очередь, итог — по ценам магазина", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(tree());
    click("shop-5"); next(); next(); next();

    expect(h.savePendingOrder).toHaveBeenCalledTimes(1);
    const [record] = h.savePendingOrder.mock.calls[0] as [{ total: number; items: unknown }];
    expect(record.items).toEqual([{ productId: 7, quantity: "2" }]);
    expect(record.total, "офлайн-итог посчитан по цене карточки, а не магазина").toBe(20000);
    await waitFor(() => expect(where()).toBe("/agent"));
    expect(loadCart(1), "корзина осталась полной — при связи уедут два заказа").toEqual([]);
  });

  it("перезагрузка посреди мастера: черновик помнит «из корзины», после отправки корзина пуста", () => {
    /*
      Телефон выгрузил вкладку, пока агент был в камере, или страницу
      перезагрузили: мастер поднимается по адресу без ?fromCart и берёт
      черновик. Признак жил только в памяти — корзина после отправки
      оставалась полной, и агента снова толкало на второй заказ.
    */
    render(tree());
    click("shop-5"); next();
    click("add-8");
    cleanup();

    render(
      <MemoryRouter initialEntries={["/orders/new/items"]}>
        <Where />
        <Routes>
          <Route path="/orders/new" element={<NewOrder />}>
            <Route index element={<NewOrderShopStep />} />
            <Route path="items" element={<NewOrderItemsStep />} />
            <Route path="review" element={<NewOrderReviewStep />} />
          </Route>
          <Route path="*" element={<div>вне мастера</div>} />
        </Routes>
      </MemoryRouter>,
    );
    if (where() === "/orders/new") next();
    expect(screen.getByTestId("lines").textContent, "черновик не поднялся или корзина легла поверх").toBe("7×2@10000.00 8×1@3000.00");
    next(); next();

    expect(h.sent).toHaveLength(1);
    expect(loadCart(1), "после перезагрузки корзина не очистилась — будет второй заказ").toEqual([]);
  });

  it("без ?fromCart корзина не трогается ни на входе, ни после отправки", () => {
    render(
      <MemoryRouter initialEntries={["/orders/new"]}>
        <Routes>
          <Route path="/orders/new" element={<NewOrder />}>
            <Route index element={<NewOrderShopStep />} />
            <Route path="items" element={<NewOrderItemsStep />} />
            <Route path="review" element={<NewOrderReviewStep />} />
          </Route>
          <Route path="*" element={<div>вне мастера</div>} />
        </Routes>
      </MemoryRouter>,
    );
    click("shop-5"); next();
    expect(screen.getByTestId("lines").textContent).toBe("");
    click("add-8"); next(); next();
    expect(h.sent).toHaveLength(1);
    expect(loadCart(1)).toHaveLength(1);
  });
});

describe("корзина кладётся в заказ один раз", () => {
  it("назад на магазин не затирает добавленное на шаге «Товары»", () => {
    render(tree());
    click("shop-5"); next();
    click("add-8");
    expect(screen.getByTestId("lines").textContent).toBe("7×2@10000.00 8×1@3000.00");

    back();
    // История возвращает ту самую запись, с которой вошли, — с ?fromCart=1.
    expect(where()).toBe("/orders/new?fromCart=1");
    next();
    expect(screen.getByTestId("lines").textContent, "корзина заново легла поверх набранного").toBe("7×2@10000.00 8×1@3000.00");
    expect(h.info.filter(m => m.startsWith("Товары из корзины"))).toHaveLength(1);
  });

  it("пользователь пропал и вернулся — набранное остаётся", () => {
    const { rerender } = render(tree());
    click("shop-5"); next();
    click("add-8");

    h.user = null;
    rerender(tree());
    h.user = { id: 1, role: "agent", name: "Агент" };
    rerender(tree());

    expect(screen.getByTestId("lines").textContent, "корзина заново легла поверх набранного").toBe("7×2@10000.00 8×1@3000.00");
  });
});

describe("цены магазина, а не витрины", () => {
  it("строки из корзины переоцениваются по магазину и заново при его смене", () => {
    render(tree());
    click("shop-5"); next();
    expect(screen.getByTestId("lines").textContent).toBe("7×2@10000.00");
    next();
    expect(screen.getByTestId("review").textContent).toBe("7×2@10000.00");

    back(); back();
    expect(where()).toBe("/orders/new?fromCart=1");
    click("shop-6"); next();
    expect(screen.getByTestId("lines").textContent, "после смены магазина осталась цена прежнего").toBe("7×2@13000.00");
    next();
    expect(screen.getByTestId("review").textContent).toBe("7×2@13000.00");
  });
});
describe("ступени: цена строки — при её количестве", () => {
  it("количество перешло ступень — строка, панель снизу, «Итог» и офлайн-итог по ступени", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(tree());
    click("shop-5"); next();
    expect(screen.getByTestId("lines").textContent).toBe("7×2@10000.00");
    expect(screen.getByTestId("open-cart").textContent).toContain("20000.00");

    click("qty-7-12");
    expect(screen.getByTestId("lines").textContent, "12 штук посчитаны по цене одной, мимо ступени «от 10»").toBe("7×12@8500.00");
    expect(screen.getByTestId("open-cart").textContent).toContain("102000.00");

    // Обратно ниже порога: строка пришла назад с ценой ступени — она не должна
    // прилипнуть, цена берётся из каталога заново.
    click("qty-7-2");
    expect(screen.getByTestId("lines").textContent, "цена ступени прилипла к строке").toBe("7×2@10000.00");

    click("qty-7-12"); next();
    expect(screen.getByTestId("review").textContent, "«Итог» не по ступени").toBe("7×12@8500.00");
    next();
    const [record] = h.savePendingOrder.mock.calls[0] as [{ total: number }];
    expect(record.total, "офлайн-итог по цене одной штуки, а заказ уйдёт по ступени").toBe(102000);
  });

  it("ступень не оседает в черновике: после перезагрузки без каталога строка на 2 шт — по цене одной штуки", () => {
    /*
      Шаги получают строки уже по ступени, и +/− возвращал их в состояние —
      8 500 ложилось в черновик. Без связи после перезагрузки каталога нет,
      и 2 шт считались бы по 8 500: офлайн-итог 17 000 при серверных 20 000.
    */
    render(tree());
    click("shop-5"); next();
    click("qty-7-12");
    // Строка уже показана по ступени; следующее изменение состава возвращает её в состояние.
    click("add-8");
    const draft = JSON.parse(localStorage.getItem("warehouse_pro_order_draft:1") ?? "null") as { items: Array<{ productId: number; quantity: string; unitPrice: string }> };
    const line = draft.items.find(i => i.productId === 7)!;
    expect(line.quantity).toBe("12");
    expect(line.unitPrice, "цена ступени легла в черновик").toBe("10000.00");
  });

  it("смена магазина переоценивает и ступень: у магазина 6 её нет", () => {
    render(tree());
    click("shop-5"); next();
    click("qty-7-12");
    expect(screen.getByTestId("lines").textContent).toBe("7×12@8500.00");

    back();
    click("shop-6"); next();
    expect(screen.getByTestId("lines").textContent, "ступень прежнего магазина осталась").toBe("7×12@13000.00");
  });
});

describe("без связи после перезагрузки — цены из копии этого магазина", () => {
  const reload = () => {
    cleanup();
    render(
      <MemoryRouter initialEntries={["/orders/new/items"]}>
        <Where />
        <Routes>
          <Route path="/orders/new" element={<NewOrder />}>
            <Route index element={<NewOrderShopStep />} />
            <Route path="items" element={<NewOrderItemsStep />} />
            <Route path="review" element={<NewOrderReviewStep />} />
          </Route>
          <Route path="*" element={<div>вне мастера</div>} />
        </Routes>
      </MemoryRouter>,
    );
    if (where() === "/orders/new") next();
  };

  it("перезагрузка без связи: строки, панель, «Итог» и офлайн-итог — по ступени из копии этого магазина", () => {
    render(tree());
    click("shop-5"); next();
    click("qty-7-12");
    click("add-8");
    expect(screen.getByTestId("lines").textContent).toBe("7×12@8500.00 8×1@3000.00");

    // Связь пропала, вкладку перезагрузили: живого каталога нет.
    h.offline = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    reload();
    expect(screen.getByTestId("lines").textContent, "после перезагрузки 12 штук снова по цене одной").toBe("7×12@8500.00 8×1@3000.00");
    expect(screen.getByTestId("open-cart").textContent).toContain("105000.00");
    next();
    expect(screen.getByTestId("review").textContent).toBe("7×12@8500.00 8×1@3000.00");
    next();
    const [record] = h.savePendingOrder.mock.calls[0] as [{ total: number }];
    expect(record.total, "офлайн-итог по цене одной штуки, а заказ уйдёт по ступени").toBe(105000);
  });

  it("без связи копия другого магазина не берётся", () => {
    // Магазин 5 открывали при связи — его цены лежат копией.
    render(tree());
    click("shop-5"); next();
    expect(screen.getByTestId("lines").textContent).toBe("7×2@10000.00");
    cleanup();

    // Без связи — магазин 6: его копии нет, строка остаётся с той ценой, с
    // которой пришла (карточка), а не с ценой и ступенью магазина 5.
    h.offline = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(tree());
    click("shop-6"); next();
    expect(screen.getByTestId("lines").textContent, "магазину 6 достались цены магазина 5").toBe("7×2@12000.00");
    click("qty-7-12");
    expect(screen.getByTestId("lines").textContent, "магазину 6 досталась ступень магазина 5").toBe("7×12@12000.00");
  });
});

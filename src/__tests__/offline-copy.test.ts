// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { saveOfflineCopy, loadOfflineCopy, clearOfflineCopies, setSessionOwner, currentOwnerId, SCOPED_MAX, SCOPED_BUDGET } from "@/lib/offline-copy";
import { useAuth } from "@/hooks/useAuth";

// Настоящий useAuth; подменены только ответ auth.me, роутер и Sentry.
const auth = vi.hoisted(() => ({ me: undefined as undefined | { id: number; tenantId: number; role: string } }));
vi.mock("@/providers/trpc", () => ({
  trpc: { auth: { me: { useQuery: () => ({ data: auth.me, isLoading: false, error: null, refetch: () => {} }) } } },
}));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("@/sentry", () => ({ setSentryUser: () => {} }));

/**
 * Без связи должно быть из чего собрать заказ.
 *
 * Вкладка «Офлайн» держала только заказы, оформленные при связи. Собрать заказ
 * БЕЗ связи было не из чего: каталог и магазины приезжают запросами, а
 * служебному работнику запрещено кэшировать ответы API. Агент в подсобке видел
 * пустые экраны, и офлайн-режим оставался наполовину декоративным.
 *
 * Запрет не отменён и отменять его нельзя — см. проверку ниже. Копия делается
 * отдельно и поимённо: ровно три набора (каталог, цены магазина,
 * магазины), все и так весь день у агента в руках.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

beforeEach(() => localStorage.clear());

describe("копия справочников на устройстве", () => {
  it("сохранённое возвращается тому же человеку", () => {
    saveOfflineCopy("catalog", 11, [{ id: 1, name: "Печенье" }]);
    expect(loadOfflineCopy<{ id: number }[]>("catalog", 11)?.data).toHaveLength(1);
  });

  it("другому вошедшему чужая копия не достаётся", () => {
    // На складе телефон и компьютер бывают общими.
    saveOfflineCopy("catalog", 11, [{ id: 1 }]);
    expect(loadOfflineCopy("catalog", 22)).toBeNull();
  });

  it("наборы не путаются между собой", () => {
    saveOfflineCopy("catalog", 11, ["товар"]);
    saveOfflineCopy("shops", 11, ["магазин", "магазин"]);
    expect(loadOfflineCopy<string[]>("catalog", 11)?.data).toEqual(["товар"]);
    expect(loadOfflineCopy<string[]>("shops", 11)?.data).toHaveLength(2);
  });

  it("выход стирает копии всех, а не только выходящего", () => {
    /*
      Выходящий может быть не тем, чьи копии лежат: сессия истекла, вошли под
      другим. Оставлять чужое на общем устройстве — ровно та утечка, от которой
      здесь защищаются.
    */
    saveOfflineCopy("catalog", 11, ["а"]);
    saveOfflineCopy("catalog", 22, ["б"]);
    clearOfflineCopies();
    expect(loadOfflineCopy("catalog", 11)).toBeNull();
    expect(loadOfflineCopy("catalog", 22)).toBeNull();
  });

  it("выход стирает и черновики прихода и заказа — в них закупочные цены (аудит 20.09.2026)", () => {
    localStorage.setItem("warehouse_pro_arrival_draft:11", JSON.stringify({ items: [{ costPrice: "8500" }] }));
    localStorage.setItem("warehouse_pro_order_draft:11", JSON.stringify({ items: [{ unitPrice: "12000" }] }));
    localStorage.setItem("lang", "uz"); // язык — не про сессию, остаётся
    clearOfflineCopies();
    expect(localStorage.getItem("warehouse_pro_arrival_draft:11")).toBeNull();
    expect(localStorage.getItem("warehouse_pro_order_draft:11")).toBeNull();
    expect(localStorage.getItem("lang")).toBe("uz");
  });

  it("испорченная запись не роняет экран", () => {
    localStorage.setItem("wp.offline.catalog.11", "{не json");
    expect(loadOfflineCopy("catalog", 11)).toBeNull();
  });

  it("копия помнит, когда снята", () => {
    // Агент вправе знать, что цены и остатки перед ним могли устареть: по
    // остаткам он разговаривает с магазином.
    saveOfflineCopy("catalog", 11, ["а"]);
    expect(loadOfflineCopy("catalog", 11)!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("прежнее решение о кэше не отменено", () => {
  it("служебный работник по-прежнему не кэширует ответы API", () => {
    /*
      В vite.config.ts стоит осознанный запрет: ответы tRPC не кэшировать,
      чтобы данные организации не оседали в Cache Storage. Копия сделана в
      обход него намеренно — поимённо и только на три безобидных набора, — а
      сам запрет должен остаться. Тем более что запросы чтения уходят ПАЧКОЙ,
      одним адресом на несколько процедур: «закэшировать только каталог» по
      адресу не выйдет, вместе с ним осел бы весь пакет.
    */
    const cfg = read("vite.config.ts");
    const at = cfg.indexOf("/^\\/api\\/trpc\\//");
    expect(at, "правило для /api/trpc пропало").toBeGreaterThan(0);
    expect(cfg.slice(at, at + 200)).toContain("NetworkOnly");
  });

  it("в копию не попадает ничего, кроме каталога, цен магазина и магазинов", () => {
    // Список закрытый — в этом его смысл. Ни заказов, ни выручки, ни
    // сотрудников, ни настроек организации.
    const lib = read("src/lib/offline-copy.ts");
    const type = lib.slice(lib.indexOf("export type OfflineKind"), lib.indexOf(";", lib.indexOf("export type OfflineKind")));
    expect(type).toBe('export type OfflineKind = "catalog" | "shops" | "shopPrices"');
  });
});

describe("без связи не выбрасывает на вход", () => {
  it("Layout не уводит на логин, если связи нет, а сессия была", () => {
    /*
      auth.me при обрыве связи не отвечает, пользователь остаётся пустым — и
      экран уводил на форму входа, которую без связи всё равно не пройти. А на
      устройстве у агента и каталог, и магазины, и неотправленные заказы.
    */
    const layout = read("src/components/Layout.tsx");
    expect(layout).toContain("if (!navigator.onLine && hadSession()) return;");
    // Проверка должна стоять ДО перехода, иначе она ничего не решает.
    const guard = layout.indexOf("!navigator.onLine && hadSession()");
    const redirect = layout.indexOf('navigate("/login", { replace: true })');
    expect(guard).toBeLessThan(redirect);
  });

  it("выход по-прежнему уносит копии", () => {
    expect(read("src/hooks/useAuth.ts")).toContain("clearOfflineCopies()");
  });
});

describe("владелец копий", () => {
  /*
    Владелец лежит в localStorage, а не берётся из useAuth. Копии нужны
    каталогу и списку товаров в мастере — обычным компонентам, у которых ни
    роутера, ни запроса auth.me нет. С useAuth каталог утянул бы за собой и то
    и другое: проверено, тесты на выдвижную корзину сразу упали с «useNavigate
    может использоваться только внутри Router».
  */
  it("кладётся и читается", () => {
    setSessionOwner(7);
    expect(currentOwnerId()).toBe(7);
    setSessionOwner(null);
    expect(currentOwnerId()).toBeNull();
  });

  it("мусор в записи не выдаётся за владельца", () => {
    localStorage.setItem("wp.offline.owner", "не число");
    expect(currentOwnerId()).toBeNull();
  });

  it("хук копий не тянет за собой авторизацию и роутер", () => {
    // По импортам, а не по всему тексту: в пояснении наверху useAuth назван
    // как раз для того, чтобы объяснить, почему его тут нет.
    const hook = read("src/hooks/useOfflineCopy.ts");
    const imports = hook.slice(0, hook.indexOf("export function"));
    expect(imports, "снова протащили useAuth в каталог").not.toMatch(/from "@\/hooks\/useAuth"/);
    expect(imports, "снова протащили роутер").not.toMatch(/from "react-router"/);
    expect(hook).toContain("currentOwnerId()");
  });
});

describe("копии стираются только при выходе", () => {
  it("очистка стоит в logout, а не в эффекте", () => {
    /*
      В эффекте это стирало бы копии всякий раз, когда пользователь оказался
      пуст, — а пуст он и при обрыве связи, то есть ровно тогда, когда копии
      единственное, что у агента осталось. Ошибка была допущена и поймана.
    */
    const auth = read("src/hooks/useAuth.ts");
    const at = auth.indexOf("clearOfflineCopies()");
    expect(at, "очистка копий пропала").toBeGreaterThan(0);
    expect(at, "очистка уехала выше logout — стирает копии при потере связи")
      .toBeGreaterThan(auth.indexOf("const logout = useCallback"));
  });
});


describe("копия цен по магазинам", () => {
  /*
    Цены у каждого магазина свои (прайс-листы, ступени «от N»). Одна копия на
    всех «последнего магазина» после перезагрузки без связи давала заказу
    чужие цены или цену одной штуки мимо ступеней.
  */
  const tiers = [{ minQuantity: "10.00", price: "8500.00", priority: 0 }];

  it("у каждого магазина своя копия, чужая не достаётся", () => {
    saveOfflineCopy("shopPrices", 11, [{ id: 7, unitPrice: "10000.00", tiers }], 5);
    expect(loadOfflineCopy<unknown[]>("shopPrices", 11, 5)?.data).toEqual([{ id: 7, unitPrice: "10000.00", tiers }]);
    expect(loadOfflineCopy("shopPrices", 11, 6), "магазину 6 досталась копия магазина 5").toBeNull();
    expect(loadOfflineCopy("shopPrices", 11), "копия магазина легла в общую").toBeNull();
  });

  it("другому вошедшему — ничего, выход стирает все магазины", () => {
    saveOfflineCopy("shopPrices", 11, [{ id: 7 }], 5);
    saveOfflineCopy("shopPrices", 11, [{ id: 7 }], 6);
    expect(loadOfflineCopy("shopPrices", 22, 5)).toBeNull();
    clearOfflineCopies();
    expect(loadOfflineCopy("shopPrices", 11, 5)).toBeNull();
    expect(loadOfflineCopy("shopPrices", 11, 6)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("магазинов не больше SCOPED_MAX: уходят самые старые", () => {
    for (let shop = 1; shop <= SCOPED_MAX + 5; shop++) {
      // Дата в записи — по порядку обхода, как у агента по маршруту.
      vi.setSystemTime(new Date(2026, 8, 28, 9, shop));
      saveOfflineCopy("shopPrices", 11, [{ id: shop }], shop);
    }
    vi.useRealTimers();
    const kept = Object.keys(localStorage).filter(k => k.startsWith("wp.offline.shopPrices.11."));
    expect(kept).toHaveLength(SCOPED_MAX);
    expect(loadOfflineCopy("shopPrices", 11, 1), "осталась самая старая").toBeNull();
    expect(loadOfflineCopy("shopPrices", 11, SCOPED_MAX + 5), "вытеснили свежую").not.toBeNull();
    expect(loadOfflineCopy("shopPrices", 11, 6)).not.toBeNull();
  });

  it("объём копий ограничен: большой каталог вытесняет старые, а не хранилище", () => {
    const big = "x".repeat(Math.floor(SCOPED_BUDGET / 3));
    for (let shop = 1; shop <= 5; shop++) {
      vi.setSystemTime(new Date(2026, 8, 28, 9, shop));
      saveOfflineCopy("shopPrices", 11, big, shop);
    }
    vi.useRealTimers();
    const used = Object.keys(localStorage)
      .filter(k => k.startsWith("wp.offline.shopPrices.11."))
      .reduce((n, k) => n + (localStorage.getItem(k) ?? "").length, 0);
    expect(used).toBeLessThanOrEqual(SCOPED_BUDGET);
    expect(loadOfflineCopy("shopPrices", 11, 5)).not.toBeNull();
    expect(loadOfflineCopy("shopPrices", 11, 1)).toBeNull();
  });

  it("сохранение не разбирает соседние копии ради даты", () => {
    // Дата — с начала строки. Разбор до 19 соседних записей по сотням КБ на
    // каждое сохранение, дважды на ответ и в основном потоке, был впустую.
    for (let shop = 1; shop <= 5; shop++) saveOfflineCopy("shopPrices", 11, [{ id: shop }], shop);
    const parse = vi.spyOn(JSON, "parse");
    saveOfflineCopy("shopPrices", 11, [{ id: 6 }], 6);
    const calls = parse.mock.calls.length;
    parse.mockRestore();
    expect(calls, "дата соседней копии снова достаётся разбором всего JSON").toBe(0);
    expect(localStorage.getItem("wp.offline.shopPrices.11.6"), "savedAt больше не первый ключ конверта").toMatch(/^\{"savedAt":"\d{4}-/);
  });

  it("чужие наборы и чужие владельцы в счёт не идут и не вытесняются", () => {
    saveOfflineCopy("catalog", 11, ["общий каталог"]);
    saveOfflineCopy("shopPrices", 22, [{ id: 1 }], 1);
    for (let shop = 1; shop <= SCOPED_MAX + 1; shop++) saveOfflineCopy("shopPrices", 11, [{ id: shop }], shop);
    expect(loadOfflineCopy("catalog", 11)).not.toBeNull();
    expect(loadOfflineCopy("shopPrices", 22, 1)).not.toBeNull();
  });
});

describe("вход другого человека уносит копии прежних", () => {
  /*
    Копии стирались только в «Выйти», а на общем компьютере сессия чаще
    истекает, чем её закрывают. Копии А (каталог больше мегабайта, цены
    магазинов до мегабайта) лежали под его номером навсегда, Б добавлял свои —
    и двух-трёх сменщиков хватало до квоты хранилища, после чего молча
    переставал сохраняться черновик заказа.

    Нарочная поломка: убери из setSessionOwner цикл по ключам — падает первый.
  */
  beforeEach(() => {
    saveOfflineCopy("catalog", 11, ["каталог А"]);
    saveOfflineCopy("shops", 11, ["магазины А"]);
    saveOfflineCopy("shopPrices", 11, [{ id: 1 }], 5);
    localStorage.setItem("warehouse_pro_order_draft:11", '{"items":[{"productId":1}]}');
    localStorage.setItem("warehouse_pro_arrival_draft:11", '{"items":[{"productId":1}]}');
    setSessionOwner(11);
    auth.me = undefined;
  });
  const copies = () => Object.keys(localStorage).filter(k => k.startsWith("wp.offline.")).sort();

  it("сессия А истекла, вошёл Б: копий А нет, свои у Б целы, черновики А не тронуты", () => {
    saveOfflineCopy("catalog", 22, ["каталог Б"]); // Б входил и раньше
    auth.me = { id: 22, tenantId: 1, role: "agent" };
    renderHook(() => useAuth());
    expect(currentOwnerId()).toBe(22);
    expect(copies(), "копии А пережили вход Б").toEqual(["wp.offline.catalog.22", "wp.offline.owner"]);
    expect(localStorage.getItem("warehouse_pro_order_draft:11"), "стёрт набранный заказ А").not.toBeNull();
    expect(localStorage.getItem("warehouse_pro_arrival_draft:11"), "стёрт набранный приход А").not.toBeNull();
  });

  it("тот же человек и обрыв связи копий не трогают", () => {
    const before = copies();
    // Обрыв связи: auth.me не ответил, вошедшего нет — копии единственное, что осталось.
    renderHook(() => useAuth());
    expect(copies()).toEqual(before);
    auth.me = { id: 11, tenantId: 1, role: "agent" };
    renderHook(() => useAuth());
    expect(copies()).toEqual(before);
    expect(loadOfflineCopy("shopPrices", 11, 5)).not.toBeNull();
  });
});

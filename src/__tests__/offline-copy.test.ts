// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { saveOfflineCopy, loadOfflineCopy, clearOfflineCopies, setSessionOwner, currentOwnerId } from "@/lib/offline-copy";

/**
 * Без связи должно быть из чего собрать заказ.
 *
 * Вкладка «Офлайн» держала только заказы, оформленные при связи. Собрать заказ
 * БЕЗ связи было не из чего: каталог и магазины приезжают запросами, а
 * служебному работнику запрещено кэшировать ответы API. Агент в подсобке видел
 * пустые экраны, и офлайн-режим оставался наполовину декоративным.
 *
 * Запрет не отменён и отменять его нельзя — см. проверку ниже. Копия делается
 * отдельно и поимённо: ровно два набора, оба и так весь день у агента в руках.
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
      обход него намеренно — поимённо и только на два безобидных набора, — а
      сам запрет должен остаться. Тем более что запросы чтения уходят ПАЧКОЙ,
      одним адресом на несколько процедур: «закэшировать только каталог» по
      адресу не выйдет, вместе с ним осел бы весь пакет.
    */
    const cfg = read("vite.config.ts");
    const at = cfg.indexOf("/^\\/api\\/trpc\\//");
    expect(at, "правило для /api/trpc пропало").toBeGreaterThan(0);
    expect(cfg.slice(at, at + 200)).toContain("NetworkOnly");
  });

  it("в копию не попадает ничего, кроме каталога и магазинов", () => {
    // Список закрытый — в этом его смысл. Ни заказов, ни выручки, ни
    // сотрудников, ни настроек организации.
    const lib = read("src/lib/offline-copy.ts");
    const type = lib.slice(lib.indexOf("export type OfflineKind"), lib.indexOf(";", lib.indexOf("export type OfflineKind")));
    expect(type).toBe('export type OfflineKind = "catalog" | "shops"');
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

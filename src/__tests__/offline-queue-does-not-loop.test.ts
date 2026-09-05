import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { serverAnswered } from "@/hooks/useOfflineSync";

/**
 * Очередь офлайн-заказов: три беды, каждая стоила агенту работы.
 *
 * 1. Заказ, отвергнутый сервером по существу (товар удалили, магазин закрыли),
 *    оставался в очереди и пересылался при каждом заходе и каждом
 *    переключении связи — всегда с тем же концом. Хуже того, это закручивалось
 *    в петлю: после неудачи список перечитывался, получался новый массив,
 *    из-за него менялась сама функция отправки, а на неё был подписан
 *    эффект — и отправка запускалась опять, без остановки.
 *
 * 2. Единственную копию неотправленного заказа стирало одно касание. Кнопка
 *    24 точки в поперечнике, в трёх с половиной точках от «Отправить», без
 *    вопроса и без возможности вернуть.
 *
 * 3. Отправка работала, только пока открыт экран «Офлайн». Агент оформлял
 *    заказы в подсобке, выходил на улицу со связью, шёл по приложению
 *    дальше — очередь стояла нетронутой.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("ответ сервера и обрыв связи различаются", () => {
  /*
    По коду ответа различать нельзя: сервер отдаёт 500 и на деловой отказ —
    «Магазин не найден в вашей организации» приходит именно так, проверено на
    живом стенде. Поэтому смотрим только на сам факт ответа, а негодность
    заказа определяем счётчиком попыток.
  */
  it("ответ пришёл — попытка засчитывается", () => {
    expect(serverAnswered({ data: { code: "BAD_REQUEST" } })).toBe(true);
    expect(serverAnswered({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(true);
  });

  it("ответа не было — это связь, а не отказ", () => {
    expect(serverAnswered(new Error("Failed to fetch"))).toBe(false);
    expect(serverAnswered(undefined)).toBe(false);
  });
});

describe("петля повторов закрыта", () => {
  const hook = read("src/hooks/useOfflineSync.ts");

  it("помеченные отказом в отправку не идут", () => {
    expect(hook, "фильтр по отметке пропал — отвергнутый заказ снова закрутится")
      .toMatch(/filter\(o => !o\.lastError\)/);
  });

  it("эффект подписан на длину очереди, а не на саму функцию", () => {
    /*
      Подписка на функцию — это и была петля: у неё при каждом перечитывании
      новая личность, эффект срабатывал снова и снова.
    */
    const effect = hook.slice(hook.lastIndexOf("useEffect(() => {"));
    expect(effect).toContain("[online, pending.length]");
    expect(effect, "снова подписались на функцию отправки").not.toMatch(/\[.*syncAll.*\]/);
  });

  it("два прохода одновременно не запускаются", () => {
    // Признак в состоянии для этого не годится: он обновляется к следующей
    // отрисовке, а событие связи может прийти раньше.
    expect(hook).toContain("running.current");
  });
});

describe("удаление и место отправки", () => {
  const page = read("src/pages/OfflineOrders.tsx");

  it("удаление спрашивает", () => {
    const fn = page.slice(page.indexOf("const deleteLocal"), page.indexOf("const [sendingId"));
    expect(fn, "удаление снова стирает без вопроса").toContain("await confirm(");
    expect(fn).toContain("danger: true");
    // Ответ обязателен: без выхода по отказу вопрос был бы декорацией.
    expect(fn).toContain("if (!ok) return;");
  });

  it("кнопки строки — полноразмерные цели", () => {
    const row = page.slice(page.indexOf('<div className="flex gap-2 flex-shrink-0">'));
    expect(row.slice(0, 900)).toContain("tap");
  });

  it("отправка включена на всё приложение, а не только на своём экране", () => {
    expect(read("src/App.tsx"), "очередь снова уйдёт только с открытого экрана «Офлайн»")
      .toContain("useOfflineSync()");
  });
});

/**
 * Из погрузочного листа должен быть выход.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * У арендатора встала сборка: одиннадцать заказов оказались заперты в листе
 * ZL-20260908-JPXE. Система писала «закройте прежний лист» — и закрыть его было
 * НЕЧЕМ.
 *
 * Незакрытый лист держит свои заказы: собрать их во второй лист нельзя, иначе
 * склад соберёт их дважды. Проверка верная. Не было другого — выхода:
 *
 *   • ручки listLoadingLists и updateLoadingListStatus написаны, выставлены
 *     наружу и НЕ ВЫЗЫВАЛИСЬ НИОТКУДА: интерфейс умел листы только создавать;
 *   • удаления листа не существовало вовсе;
 *   • единственный путь к «доставлен» — четыре последовательных перевода, и
 *     каждый означал бы, что товар поехал, хотя он никуда не ехал.
 *
 * Та же болезнь, что с вебхуком бота и кронами: всё написано, кроме звена,
 * которое соединяет. Здесь она встала боком живому складу.
 *
 * ── Отсюда проверки ─────────────────────────────────────────────────────────
 *
 * Первая — на исходники: экран обязан вызывать обе ручки. Без неё завтрашняя
 * правка снова оставит их висеть, и разбираться будем по остановленной сборке.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "src");

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("выход из листа есть на экране", () => {
  const modal = code(join(SRC, "components", "orders", "LoadingListsModal.tsx"));
  const orders = code(join(SRC, "pages", "Orders.tsx"));

  it("экран показывает листы", () => {
    expect(modal).toContain("listLoadingLists");
  });

  it("экран умеет продвигать статус", () => {
    expect(modal).toContain("updateLoadingListStatus");
  });

  it("экран умеет удалить ошибочный лист", () => {
    /*
      Удаление, а не перевод в «доставлен»: перевод разблокировал бы заказы, но
      записал бы доставку, которой не было. Лист, собранный по ошибке, надо
      удалять, а не выдавать за отгруженный.
    */
    expect(modal).toContain("deleteLoadingList");
  });

  it("к экрану есть откуда попасть", () => {
    // Ручки без кнопки — то же самое, что ручек нет.
    expect(orders).toContain("LoadingListsModal");
    expect(orders).toMatch(/setShowLoadingLists\(true\)/);
  });

  it("удаление спрашивает подтверждение", () => {
    expect(modal).toContain("confirm(");
    expect(modal).toContain("danger: true");
  });
});

describe("сообщение об отказе ведёт к выходу", () => {
  const service = code(join(SRC, "..", "api", "services", "loading-list.ts"));
  const at = service.indexOf("уже стоят в незакрытом погрузочном листе");
  const around = service.slice(Math.max(0, at - 900), at + 500);

  it("называет, где закрыть лист", () => {
    // Раньше советовало «закройте прежний лист», а экрана листов не было.
    expect(around).toContain("Погрузочные листы");
  });

  it("перечисляет ЛИСТЫ, а не каждый заказ по отдельности", () => {
    /*
      При одиннадцати заказах из одного листа прежнее сообщение повторяло
      «— лист ZL-…» одиннадцать раз, и главное — какой лист мешает — тонуло в
      повторе. Мешает лист, а не заказы.
    */
    expect(around).toContain("byList");
    expect(around).toMatch(/зак\./);
  });
});

describe("что удалять нельзя", () => {
  it("отгруженный лист удалить нельзя", () => {
    // Он больше ничего не держит, а как запись о факте — нужен.
    const service = code(join(SRC, "..", "api", "services", "loading-list.ts"));
    const at = service.indexOf("async deleteLoadingList");
    expect(at).toBeGreaterThan(0);
    const body = service.slice(at, at + 1400);
    expect(body).toMatch(/status === "delivered"/);
  });

  it("связки заказов удаляются вместе с листом", () => {
    /*
      Иначе строки loading_list_orders остались бы сиротами и продолжили бы
      держать заказы уже несуществующим листом — та же блокировка, только без
      возможности её увидеть.
    */
    const service = code(join(SRC, "..", "api", "services", "loading-list.ts"));
    const at = service.indexOf("async deleteLoadingList");
    const body = service.slice(at, at + 1400);
    const orderLinks = body.indexOf("loadingListOrders");
    const listRow = body.indexOf("delete(loadingLists)");
    expect(orderLinks).toBeGreaterThan(0);
    expect(listRow).toBeGreaterThan(orderLinks);
  });
});

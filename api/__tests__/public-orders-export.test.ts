import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  encodeSnapshot, decodeSnapshot, encodeCursor, decodeCursor,
  parseLimit, parseDayBound, parseStatuses, money, iso,
  MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
} from "../public/order-export";

/**
 * Выгрузка заказов наружу: снимок, курсор, фильтры.
 *
 * ── Откуда правила ──────────────────────────────────────────────────────────
 *
 * Из технического задания BEKDRINKS. Они не наши: по этим данным другая
 * сторона считает долги магазинов и срывы доставок, и приёмка проверяет ровно
 * это (пункты 17-A…H):
 *
 *   B. на трёх страницах ни одна строка не потеряна и не задвоена;
 *   C. заказ, пришедший во время выгрузки, снимок не рушит;
 *   D. после обрыва связи выгрузка продолжается без повторов;
 *   G. отсутствующий срок доставки не подменяется догадкой.
 *
 * ── Почему это можно проверить без базы ─────────────────────────────────────
 *
 * Потому что решает не база. Какие строки войдут и в каком порядке — решают
 * снимок и курсор, а они чистые функции. MySQL на этой машине нет, и ошибка в
 * листании иначе доживает до чужой приёмки.
 */

describe("снимок фиксирует набор", () => {
  it("разбирается обратно тем же", () => {
    const snap = { maxId: 91731, asOf: "2026-09-10T18:00:00.000Z" };
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap);
  });

  it("испорченный — отказ, а не новый снимок", () => {
    /*
      Молча выдать новый вместо присланного значило бы порвать выгрузку
      посередине так, что другая сторона не узнает: страницы поехали бы по
      другому набору, и часть заказов не пришла бы вовсе.
    */
    expect(decodeSnapshot("не-снимок")).toBeNull();
    expect(decodeSnapshot(Buffer.from('{"m":-1,"t":"x"}').toString("base64url"))).toBeNull();
    expect(decodeSnapshot(Buffer.from('{"m":5}').toString("base64url"))).toBeNull();
    expect(decodeSnapshot(Buffer.from('{"m":"пять","t":"x"}').toString("base64url"))).toBeNull();
  });

  it("ноль заказов — законный снимок, а не пустота", () => {
    // У новой организации заказов нет; выгрузка обязана пройти и вернуть ноль
    // строк, а не сломаться.
    expect(decodeSnapshot(encodeSnapshot({ maxId: 0, asOf: "2026-09-10T00:00:00.000Z" })))
      .toEqual({ maxId: 0, asOf: "2026-09-10T00:00:00.000Z" });
  });
});

describe("курсор принадлежит своему снимку", () => {
  it("разбирается обратно тем же", () => {
    const c = { lastId: 42, snapshotId: "abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual({ lastId: 42, snapshotId: "abc", updatedSince: undefined });
  });

  it("несёт привязку к снимку", () => {
    /*
      Подставь курсор от вчерашней выгрузки в сегодняшнюю — и набор поедет:
      часть заказов не придёт, а выглядеть это будет как пропажа данных у нас.
      ТЗ требует привязки прямым текстом (пункт 10).
    */
    const c = decodeCursor(encodeCursor({ lastId: 7, snapshotId: "вчерашний" }));
    expect(c?.snapshotId).toBe("вчерашний");
  });

  it("режим изменений запоминает своё время", () => {
    const c = decodeCursor(encodeCursor({ lastId: 7, snapshotId: "", updatedSince: "2026-09-10T10:00:00Z" }));
    expect(c?.updatedSince).toBe("2026-09-10T10:00:00Z");
  });

  it("испорченный — отказ", () => {
    expect(decodeCursor("мусор")).toBeNull();
    expect(decodeCursor(Buffer.from('{"i":-5,"s":"a"}').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"i":1.5,"s":"a"}').toString("base64url"))).toBeNull();
  });
});

describe("размер страницы назван, а не угадывается", () => {
  it("умолчание и потолок", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit(String(MAX_PAGE_SIZE + 500))).toBe(MAX_PAGE_SIZE);
  });

  it("чепуха не роняет выгрузку", () => {
    // Отказ здесь хуже умолчания: выгрузка идёт по расписанию, и падать из-за
    // опечатки в параметре ей незачем.
    for (const bad of ["0", "-3", "abc", "", "NaN"]) {
      expect(parseLimit(bad), bad).toBe(DEFAULT_PAGE_SIZE);
    }
  });
});

describe("границы периода включительные — обе", () => {
  it("день без времени раздвигается до конца суток", () => {
    /*
      «2026-09-01..2026-09-30» означает весь сентябрь. Без раздвижки заказы
      ПОСЛЕДНЕГО дня выпадали бы: полночь тридцатого меньше любого заказа того
      же дня. Эту беду в продукте уже ловили в отчётах.
    */
    expect(parseDayBound("2026-09-01", "from")).toBe("2026-09-01 00:00:00");
    expect(parseDayBound("2026-09-30", "to")).toBe("2026-09-30 23:59:59");
  });

  it("полное время принимается как есть", () => {
    expect(parseDayBound("2026-09-30T12:00:00Z", "to")).toBe("2026-09-30T12:00:00Z");
  });

  it("не дата — отказ, а не молчаливый пропуск фильтра", () => {
    // Пропустить непонятный фильтр значит отдать ВСЁ вместо периода — и
    // получатель сложит это в отчёт, не заметив.
    expect(parseDayBound("вчера", "from")).toBeNull();
    expect(parseDayBound("", "from")).toBeNull();
  });
});

describe("статусы", () => {
  const known = ["new", "delivered", "cancelled"];

  it("список разбирается", () => {
    expect(parseStatuses("new,delivered", known)).toEqual(["new", "delivered"]);
    expect(parseStatuses(" new , delivered ", known)).toEqual(["new", "delivered"]);
  });

  it("неизвестный — отказ, а не пустой ответ", () => {
    /*
      Пустой ответ на опечатку — худший исход: получатель решит, что заказов
      такого статуса нет, и отчёт выйдет с нулём вместо числа.
    */
    expect(parseStatuses("delivred", known)).toBe("invalid");
    expect(parseStatuses("new,выдумка", known)).toBe("invalid");
  });

  it("пусто значит «все»", () => {
    expect(parseStatuses(undefined, known)).toBeNull();
    expect(parseStatuses("", known)).toBeNull();
  });
});

describe("деньги и время", () => {
  it("деньги строкой с двумя знаками", () => {
    // ТЗ пункт 8: «2975000.00». Числом с плавающей точкой на той стороне
    // теряются копейки, а сверка сумм — первый пункт приёмки.
    expect(money("2975000")).toBe("2975000.00");
    expect(money("2975000.5")).toBe("2975000.50");
    expect(money(0)).toBe("0.00");
  });

  it("пустое и мусор — ноль, а не NaN", () => {
    expect(money(null)).toBe("0.00");
    expect(money(undefined)).toBe("0.00");
    expect(money("не число")).toBe("0.00");
  });

  it("время в UTC с Z", () => {
    // Без пояса дата читается получателем в своём, и заказы уезжают в соседние
    // сутки — то есть в соседний отчётный период.
    expect(iso(new Date("2026-09-10T18:30:00Z"))).toBe("2026-09-10T18:30:00.000Z");
    expect(iso("2026-09-10 18:30:00")).toMatch(/Z$/);
  });

  it("пусто остаётся пустым", () => {
    // Пункт 17-G: отсутствующее значение не подменяется догадкой.
    expect(iso(null)).toBeNull();
    expect(iso(undefined)).toBeNull();
    expect(iso("не дата")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Правила, которые числами не проверить: они про то, КАК собран запрос.
   ═══════════════════════════════════════════════════════════════════════════ */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTE = read("api/public/orders-v1.ts");
const CONTRACT = read("api/public/order-export.ts");

describe("листание проходит приёмку по построению", () => {
  it("смещения нет", () => {
    /*
      Главное. `offset` не проходит пункты B и C ни при каком старании: пока
      идёт выгрузка, новая строка сдвигает всё следующее, и на границе
      страницы одна теряется, а другая приходит дважды.
    */
    expect(ROUTE, "вернулось листание смещением").not.toMatch(/\.offset\(/);
    expect(ROUTE, "курсора нет").toContain("encodeCursor(");
  });

  it("порядок по идентификатору, а не по времени создания", () => {
    /*
      `created_at` у заказа ДВИГАЕТСЯ: вернувшийся из архива получает дату
      второго круга (services/order-reopen.ts). Порядок по нему не постоянен, а
      значит непостоянен и набор страницы.
    */
    expect(ROUTE).toContain("orderBy(asc(orders.id))");
    expect(ROUTE, "порядок снова по времени").not.toMatch(/orderBy\((?:asc|desc)\(orders\.createdAt\)/);
  });

  it("снимок отсекает по идентификатору", () => {
    expect(ROUTE).toContain("lte(orders.id, opts.maxId)");
    expect(CONTRACT).toContain("maxId");
  });

  it("страница берётся на одну больше, чтобы знать про продолжение", () => {
    // Иначе `has_more` пришлось бы считать отдельным запросом по тому же
    // набору — лишний поход в базу на каждую страницу.
    expect(ROUTE).toContain("limit(limit + 1)");
  });
});

describe("итоги считаются по тому же набору, что и строки", () => {
  it("условия собраны один раз", () => {
    /*
      Строки, счёт и сумма обязаны считаться по одному множеству: разойдись они
      хоть в одном условии — сверка сумм не сойдётся, а причину будут искать в
      ERP. Условия поэтому собираются функцией, а не переписываются трижды.
    */
    expect(ROUTE).toContain("function baseConditions(");
    const uses = ROUTE.split("and(...conditions").length - 1;
    expect(uses, `набор условий использован ${uses} раз, ожидалось три`).toBe(3);
  });

  it("сумма и разбивка по статусам отдаются", () => {
    expect(ROUTE).toContain("orders_amount_total");
    expect(ROUTE).toContain("status_counts");
    expect(ROUTE).toContain("total_count");
  });
});

describe("чего не выдумываем", () => {
  it("обещанный срок берётся из своего поля, а не из соседнего", () => {
    /*
      Срок ставит человек — агент, стоя в магазине. Отдаём ровно то, что он
      поставил, и пусто, если не ставил. Пункт 17-G запрещает догадку, а
      подстановка сюда даты доставки или «создан плюс сколько-то» превратила
      бы выдумку в срыв на той стороне: по этому полю считают опоздания.
    */
    expect(ROUTE).toContain("promised_delivery_at: iso(r.promisedDeliveryAt)");
    expect(ROUTE, "поле не выбирается из базы").toContain("promisedDeliveryAt: orders.promisedDeliveryAt");

    // Ни одна соседняя дата не должна оказаться в этом поле.
    const at = ROUTE.indexOf("promised_delivery_at:");
    const line = ROUTE.slice(at, ROUTE.indexOf("\n", at));
    for (const wrong of ["deliveredAt", "createdAt", "updatedAt"]) {
      expect(line, `обещанный срок подменён полем ${wrong}`).not.toContain(wrong);
    }
  });

  it("пустой срок остаётся пустым на всём пути", () => {
    // Договор наружу обязан допускать null: «не обещали» — законный ответ, и
    // получатель по нему обязан сказать «неизвестно», а не «в срок».
    expect(CONTRACT).toContain("promised_delivery_at: string | null");
    expect(iso(null)).toBeNull();
  });

  it("склад берётся настоящий, а не ноль", () => {
    expect(ROUTE).toContain("wh?.id ?? null");
  });

  it("соединения левые — строка не пропадает из-за удалённого магазина", () => {
    // Пункт 17-A: число строк обязано совпасть с ERP. Внутреннее соединение
    // выкинуло бы заказ, у которого магазин или сотрудник удалён.
    expect(ROUTE, "появилось внутреннее соединение").not.toContain("innerJoin");
    expect(ROUTE.split("leftJoin").length - 1).toBeGreaterThanOrEqual(4);
  });
});

describe("удалённые заказы", () => {
  it("в полной выгрузке их нет, в изменениях — с меткой", () => {
    /*
      Без метки заказ, удалённый после первой сверки, остался бы у получателя
      навсегда — и долг по нему тоже.
    */
    expect(ROUTE).toContain("includeDeleted: incremental");
    expect(ROUTE).toContain("deleted_at: iso(r.deletedAt)");
  });
});

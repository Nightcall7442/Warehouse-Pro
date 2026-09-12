import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { orderSource } from "./helpers/order-source";

/**
 * Частичную доставку умеют ДВА пути, и они обязаны писать одно и то же.
 *
 * ── Почему их два ───────────────────────────────────────────────────────────
 *
 * Оператор и агент проводят её через OrderService.applyPartialDelivery,
 * курьер — через courier.completeDelivery со своим `result: partial_returned`.
 * Разделение намеренное и записано в services/order.ts: у курьера свой замок,
 * свой платёж и свой набор состояний доставки, и звать оттуда операторский путь
 * нельзя — он отказывает заказу в статусе «доставлен», который курьер как раз
 * и ставит.
 *
 * ── Чем это кончилось ───────────────────────────────────────────────────────
 *
 * Курьерский путь оказался НЕПОЛНОЙ копией. Он не делал двух вещей:
 *
 * 1. Не переписывал `order_items.subtotal`. Сумма заказа уменьшалась, а строки
 *    продолжали стоить как заказанные: SUM(order_items.subtotal) переставал
 *    сходиться с orders.total на одном и том же заказе. Три отчёта в
 *    analytics-router это обошли и написали почему; прогноз спроса и «топ
 *    товаров» в телеграме не обошли и показывали проданным то, что вернулось —
 *    прогноз на этом предлагал закупать возвраты.
 *
 * 2. Не писал запись в журнал правок. Частичный возврат, сделанный курьером,
 *    не оставлял в истории заказа НИЧЕГО: сумма просто оказывалась меньше, чем
 *    в накладной, и объяснить это было нечем. Ту же операцию от оператора
 *    журнал показывал с причиной и фотографиями.
 *
 * Проверки ниже держат оба пути в согласии на уровне исходников: беда была не
 * в неверной формуле, а в том, что одна из двух копий чего-то не делала.
 */

const API_DIR = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(API_DIR, rel.split("/").join(sep)), "utf8").replace(/\r\n/g, "\n");

const ORDER_SERVICE = orderSource();
const COURIER = read("courier-router.ts");

/** Тело операторской частичной доставки. */
const operatorPath = (() => {
  const at = ORDER_SERVICE.indexOf("async function applyPartialDelivery");
  expect(at, "операторский путь не найден").toBeGreaterThan(0);
  return ORDER_SERVICE.slice(at, ORDER_SERVICE.indexOf("\n/**", at + 100));
})();

/** Ветка частичного возврата у курьера. */
const courierPath = (() => {
  const at = COURIER.indexOf('} else if (input.result === "partial_returned")');
  expect(at, "курьерская ветка частичного возврата не найдена").toBeGreaterThan(0);
  return COURIER.slice(at, COURIER.indexOf("paidAmount = Number(input.paidAmount", at));
})();

/**
 * Что путь ЗАПИСЫВАЕТ в строку заказа — объект из `update(orderItems).set({…})`.
 *
 * Смотреть на всё тело функции нельзя, и это выяснилось нарочной поломкой: я
 * убрал `subtotal` из самой записи в базу, и проверка НЕ УПАЛА. Ровно то же
 * присвоение стоит рядом, в объекте для журнала правок
 * (`newItems.push({ …, subtotal: … })`), и поиск по тексту находил его.
 *
 * Проверка, довольная соседней строкой, не защищает ничего.
 */
function orderItemSetClause(path: string, who: string): string {
  const at = path.indexOf("update(orderItems)");
  expect(at, `${who}: строка заказа вообще не переписывается`).toBeGreaterThan(0);
  const open = path.indexOf("{", path.indexOf(".set(", at));
  expect(open, `${who}: у записи строки нет тела`).toBeGreaterThan(0);

  let depth = 1;
  let i = open + 1;
  while (i < path.length && depth > 0) {
    if (path[i] === "{") depth++;
    else if (path[i] === "}") depth--;
    i++;
  }
  return path.slice(open, i);
}

describe("оба пути переписывают строку заказа целиком", () => {
  const PATHS = [["оператор", operatorPath], ["курьер", courierPath]] as const;

  it("доставленное количество пишут оба", () => {
    for (const [name, path] of PATHS) {
      expect(orderItemSetClause(path, name), `${name}: доставленное количество не записано`)
        .toContain("deliveredQuantity:");
    }
  });

  it("стоимость строки пишут оба", () => {
    /*
      Это и была дыра. Курьер уменьшал сумму заказа и оставлял строки стоить
      как заказанные — заказ переставал сходиться сам с собой.
    */
    for (const [name, path] of PATHS) {
      expect(orderItemSetClause(path, name), `${name}: стоимость строки осталась заказанной`)
        .toMatch(/subtotal:\s*newLineSubtotal\.toFixed\(2\)/);
    }
  });

  it("стоимость строки считается из ДОСТАВЛЕННОГО, а не заказанного", () => {
    for (const [name, path] of PATHS) {
      expect(path, `${name}: стоимость строки считается не от доставленного`)
        .toMatch(/newLineSubtotal\s*=\s*[^\n]*deliveredQty/);
    }
  });

  it("проверка смотрит на саму запись, а не на соседний объект", () => {
    /*
      Стража самой стражи. Тело записи обязано быть коротким объектом полей, а
      не всей функцией: если разбор снова начнёт возвращать пол-файла, любая
      похожая строка рядом будет считаться записью в базу.
    */
    for (const [name, path] of PATHS) {
      const clause = orderItemSetClause(path, name);
      expect(clause.length, `${name}: разбор захватил больше, чем тело записи`).toBeLessThan(600);
      expect(clause, `${name}: в тело записи попал журнал правок`).not.toContain("push(");
    }
  });
});

describe("оба пути оставляют след в журнале правок", () => {
  it("запись пишут оба", () => {
    for (const [name, path] of [["оператор", operatorPath], ["курьер", courierPath]] as const) {
      expect(path, `${name}: правка суммы заказа не попадает в историю`)
        .toContain("insert(orderAdjustments)");
    }
  });

  it("тип записи один и тот же", () => {
    // Иначе экран истории пришлось бы учить второму названию одного события.
    for (const [name, path] of [["оператор", operatorPath], ["курьер", courierPath]] as const) {
      expect(path, `${name}: свой тип записи в журнале`).toContain('type: "partial_delivery"');
    }
  });

  it("в записи есть строки «до» и «после», а не только сумма", () => {
    /*
      Сумма без строк не отвечает на вопрос, ради которого в историю и
      заглядывают: ЧТО именно вернулось.
    */
    for (const [name, path] of [["оператор", operatorPath], ["курьер", courierPath]] as const) {
      expect(path, `${name}: в журнал уходит только сумма`).toMatch(/oldValue:\s*\{\s*total:[^}]*items:/);
      expect(path, `${name}: в журнал уходит только сумма`).toMatch(/newValue:\s*\{\s*total:[^}]*items:/);
    }
  });
});

describe("выручка по товарам считается из доставленного", () => {
  /*
    Строки, записанные курьерским путём ДО правки, в базе остались: там
    quantity и subtotal заказанные, а доставленное лежит отдельно. Любой отчёт,
    берущий subtotal как есть, по этим строкам врёт — и будет врать всегда,
    сколько бы путь ни чинили.

    Поэтому правило простое: выручка по СТРОКАМ заказа считается из
    доставленного количества, а не из сохранённой стоимости строки.
  */
  const REPORTS = [
    "analytics-router.ts",
    "forecast-router.ts",
    "telegram/answers.ts",
  ];

  it("отчёты не берут стоимость строки как есть", () => {
    const offenders: string[] = [];
    for (const rel of REPORTS) {
      const src = read(rel);
      if (/SUM\(\s*(?:CAST\(\s*)?\$\{orderItems\.subtotal\}/i.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      offenders.length === 0 ? "" :
        `Эти отчёты складывают order_items.subtotal напрямую:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nПо строкам, записанным курьером до правки частичного возврата, ` +
        `там лежит ЗАКАЗАННАЯ стоимость. Считайте deliveredQty() * unitPrice.`,
    ).toEqual([]);
  });

  it("считают через общий помощник, а не своим COALESCE", () => {
    // deliveredQuantity бывает NULL у обычного заказа — там доставлено ровно
    // заказанное. Своя копия этого правила разъедется на первой же правке.
    for (const rel of REPORTS) {
      expect(read(rel), `${rel}: выручка по строкам считается не через deliveredQty()`)
        .toContain("deliveredQty()");
    }
  });
});

describe("новых читателей стоимости строки не появилось", () => {
  it("никто больше не складывает order_items.subtotal", () => {
    /*
      Список именной: subtotal строки — правильное поле для показа ОДНОЙ строки
      заказа (накладная, карточка), и запрещать его целиком нельзя. Запрещено
      складывать его в выручку.
    */
    const MAY_SUM: Record<string, string> = {
      "services/loading-list.ts":
        "погрузочный лист — НАРЯД НА СБОРКУ: собирают заказанное, а не " +
        "доставленное. Заказы в листе ещё открыты, доставленного количества у " +
        "них нет вовсе, и subtotal там — ровно то, что надо взять с полки",
    };

    const offenders: string[] = [];
    for (const file of walkTypeScript(API_DIR)) {
      const rel = relative(API_DIR, file).split(sep).join("/");
      if (rel in MAY_SUM) continue;
      const src = readFileSync(file, "utf8");
      if (/SUM\(\s*(?:CAST\(\s*)?\$\{orderItems\.subtotal\}/i.test(src)) offenders.push(rel);
    }
    expect(offenders, `складывают стоимость строк заказа:\n${offenders.join("\n")}`).toEqual([]);
  });
});

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  applyStockEffect, receiveStock, releaseStock, reserveStock, setStock, shipStock,
} from "../services/stock-ledger";

/**
 * Дверь для остатка: свойства запроса и разбор списка.
 *
 * ── Почему отдельно от набора на настоящей базе ─────────────────────────────
 *
 * Арифметику остатка проверяет api/__tests__/real-db/stock-door*.test.ts — там
 * запрос ИСПОЛНЯЕТСЯ, и только так можно поймать, например, перестановку
 * присвоений местами. Но эти файлы пропускаются без TEST_DATABASE_URL, то есть
 * в обычном прогоне не проверяют ничего.
 *
 * Здесь — то, что проверяется без базы: форма собранного запроса и разбор
 * списка товаров. Запрос перехватывается поддельным tx: он ничего не
 * исполняет, а запоминает, что дверь построила.
 *
 * ── Что показала нарочная поломка ───────────────────────────────────────────
 *
 * Я переставил присвоения в SET местами — и НИ ОДИН стенд не упал. Стенды
 * считают арифметику на JavaScript, где порядок присвоений не значит ничего, а
 * в MySQL он несущий: правые части видят уже обновлённые колонки. То есть
 * дефект, ради которого в коде стоит заглавными «ПОРЯДОК ПРИСВОЕНИЙ НЕСУЩИЙ»,
 * подделкой базы не ловится вовсе. Поэтому он проверяется здесь — по форме
 * запроса, — и ещё раз на настоящей базе результатом.
 */

/**
 * Поддельный tx: не исполняет запрос, а разбирает его тем же диалектом, что и
 * настоящий драйвер.
 *
 * Самодельная склейка шаблона здесь не годится: у объекта drizzle нет ни
 * `strings`, ни `values` — он хранит queryChunks, и наивный разбор давал пустой
 * текст, то есть проверка проходила бы, ничего не проверяя. MySqlDialect
 * собирает ровно ту строку и те подстановки, что уедут в базу.
 */
function spyTx() {
  const dialect = new MySqlDialect();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const tx = {
    execute: vi.fn(async (q: SQL) => {
      const built = dialect.sqlToQuery(q);
      queries.push({ text: built.sql, values: built.params });
      return [{ affectedRows: 1 }];
    }),
    insert: vi.fn(() => ({ values: vi.fn(async () => [{ insertId: 1 }]) })),
  };
  return { tx: tx as never, queries };
}

/** Сколько раз дверь позвала журнал движений. */
const movements = (tx: unknown) =>
  (tx as { insert: { mock: { calls: unknown[] } } }).insert.mock.calls.length;

const ONE = [{ productId: 7, quantity: 5 }];

describe("форма запроса", () => {
  it("available ВЫВОДИТСЯ последним, а не поддерживается вручную", async () => {
    /*
      Сердце всей правки. Раньше available правили как самостоятельное число, и
      требование к порядку было обратным: он обязан был стоять ПЕРВЫМ и успеть
      прочитать старый резерв. Перестановка двух строк тихо ломала деньги, и
      понять это по коду было нельзя — только по комментарию заглавными.

      Теперь available не хранится независимо, а считается от двух других.
      Требование осталось, но перевернулось и стало очевидным: available идёт
      ПОСЛЕДНИМ и читает уже обновлённые колонки — иначе он их попросту не
      выведет. Ошибиться в нём больше негде.
    */
    const { tx, queries } = spyTx();
    await reserveStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const text = queries[0].text;
    expect(text, "available перестал выводиться из двух других")
      .toContain("available     = current_stock - reserved");

    const currentAt = text.indexOf("current_stock =");
    const reservedAt = text.indexOf("reserved      =");
    const availableAt = text.indexOf("available     =");
    expect(currentAt, "в запросе нет присвоения current_stock").toBeGreaterThan(0);
    expect(reservedAt, "в запросе нет присвоения reserved").toBeGreaterThan(0);
    expect(availableAt, "available считается РАНЬШЕ колонок, из которых выводится")
      .toBeGreaterThan(Math.max(currentAt, reservedAt));
  });

  it("ограничитель остался ровно один — на резерве", async () => {
    /*
      Снять из резерва больше, чем там лежит, нельзя, а отрицательный резерв в
      боевой базе встречается. available подстраивается сам, потому что от
      резерва и считается: второй ограничитель означал бы, что два числа снова
      живут своей жизнью — ровно та беда, из-за которой резерв упирался в ноль,
      а свободное прибавляло всю величину.
    */
    const { tx, queries } = spyTx();
    await releaseStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const text = queries[0].text;
    expect(text).toContain("GREATEST(0, reserved +");
    expect(text.match(/GREATEST/g) ?? [], "ограничителей стало больше одного").toHaveLength(1);
  });

  it("вызывающий задаёт два числа из трёх", async () => {
    const { tx, queries } = spyTx();
    await shipStock(tx, {
      tenantId: 1, warehouseId: 2,
      items: [{ productId: 7, orderedQuantity: 5, deliveredQuantity: 3 }],
      reason: "order_delivery",
    });
    const text = queries[0].text;
    expect(text).toContain("current_stock = current_stock +");
    expect(text).toContain("reserved      = GREATEST(0, reserved +");
    expect(text).toContain("available     = current_stock - reserved");
  });

  it("отгрузка снимает с резерва заказанное, а со склада — увезённое", async () => {
    /*
      При частичной доставке это РАЗНЫЕ числа: заказ держал пять, уехало три.
      Со склада уходит три, с резерва снимается пять, а две единицы
      возвращаются в свободный остаток сами — потому что available выводится.
      Прежде это писали выражением `available − увезено + LEAST(отложено,
      reserved)`, и каждое из четырёх мест писало его заново.
    */
    const { tx, queries } = spyTx();
    await shipStock(tx, {
      tenantId: 1, warehouseId: 2,
      items: [{ productId: 7, orderedQuantity: 5, deliveredQuantity: 3 }],
      reason: "order_delivery",
    });
    expect(queries[0].values, "со склада ушло не увезённое").toContain(-3);
    expect(queries[0].values, "с резерва снято не заказанное").toContain(-5);
  });

  it("резерв и снятие отличаются только знаком", async () => {
    // Одно выражение на обе операции: разойтись им негде.
    const a = spyTx(); await reserveStock(a.tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const b = spyTx(); await releaseStock(b.tx, { tenantId: 1, warehouseId: 2, items: ONE });
    expect(a.queries[0].text).toBe(b.queries[0].text);
    expect(a.queries[0].values).toContain(5);
    expect(b.queries[0].values).toContain(-5);
  });

  it("организация и склад всегда в условии", async () => {
    const { tx, queries } = spyTx();
    await reserveStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    expect(queries[0].text).toContain("tenant_id =");
    expect(queries[0].text).toContain("warehouse_id =");
  });

  it("приход заводит строку, если её нет", async () => {
    /*
      В возвратах стоял голый UPDATE: на товаре, которого на этом складе ещё не
      было, он не совпадал ни с одной строкой. Возврат принимали, с магазина
      списывали, а на склад он не попадал — молча.
    */
    const { tx, queries } = spyTx();
    await receiveStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 5, reason: "arrival" });
    expect(queries[0].text).toContain("ON DUPLICATE KEY UPDATE");
    expect(queries[0].text, "и здесь available обязан выводиться")
      .toContain("available     = current_stock - reserved");
  });

  it("установка числом обрезает резерв по новому остатку", async () => {
    // Зарезервировать больше, чем лежит на полке, нельзя.
    const { tx, queries } = spyTx();
    await setStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 4 });
    expect(queries[0].text).toContain("LEAST(reserved,");
    expect(queries[0].text).toContain("available     = current_stock - reserved");
  });
});

describe("разбор списка", () => {
  it("один товар дважды — количества СКЛАДЫВАЮТСЯ", async () => {
    /*
      Нашла адверсарная проверка, и это настоящая дыра: CASE берёт первую
      совпавшую ветку, а `product_id IN (7, 7)` схлопывается. Товар, попавший
      в список дважды, зарезервировался бы не полностью — молча. Прежние места
      писали такой же CASE и имели ту же дыру.
    */
    /*
      Номера организации и склада взяты заведомо не совпадающими с
      количествами: первая версия проверки требовала «двойки нет в списке
      подстановок», а двойка была идентификатором склада — проверка падала на
      исправном коде и сообщала не о том.
    */
    const { tx, queries } = spyTx();
    await reserveStock(tx, {
      tenantId: 91, warehouseId: 92,
      items: [{ productId: 70, quantity: 2 }, { productId: 70, quantity: 3 }],
    });
    expect(queries).toHaveLength(1);
    const values = queries[0].values;
    expect(values, "количества не сложились").toContain(5);
    expect(values, "исходная двойка уехала в запрос отдельной веткой").not.toContain(2);
    expect(values, "исходная тройка уехала в запрос отдельной веткой").not.toContain(3);
    // Товар назван по одному разу в каждой из двух веток CASE и один раз в IN.
    expect(values.filter(v => v === 70), "товар размножился по веткам").toHaveLength(3);
  });

  it("отрицательное количество — отказ, а не операция наоборот", async () => {
    /*
      Сначала здесь стоял Math.abs. Это худшее из возможного: передай кто-нибудь
      знаковую дельту — а именно так устроен applyStockDelta, — и reserveStock
      молча выполнил бы операцию В ОБРАТНУЮ СТОРОНУ. Уменьшение позиции на три
      стало бы резервом ещё трёх: ошибка в шесть единиц без единого признака сбоя.
    */
    const { tx, queries } = spyTx();
    await expect(reserveStock(tx, {
      tenantId: 1, warehouseId: 2, items: [{ productId: 7, quantity: -3 }],
    })).rejects.toThrow(/отрицательное количество/);
    expect(queries, "в базу ушёл запрос при негодном входе").toHaveLength(0);
  });

  it("NaN — отказ, а не тихий пропуск", async () => {
    // Тихо отбросить такую строку значит поменять шумный сбой на пропавший резерв.
    const { tx } = spyTx();
    await expect(releaseStock(tx, {
      tenantId: 1, warehouseId: 2, items: [{ productId: 7, quantity: Number("ерунда") }],
    })).rejects.toThrow(/не число/);
  });

  it("установка отрицательного остатка — отказ", async () => {
    const { tx, queries } = spyTx();
    await expect(setStock(tx, {
      tenantId: 1, warehouseId: 2, productId: 7, quantity: -1,
    })).rejects.toThrow(/негодное количество/);
    expect(queries).toHaveLength(0);
  });

  it("ноль отбрасывается молча — он ничего не меняет", async () => {
    const { tx, queries } = spyTx();
    await reserveStock(tx, {
      tenantId: 1, warehouseId: 2,
      items: [{ productId: 7, quantity: 0 }, { productId: 8, quantity: 4 }],
    });
    expect(queries[0].values).toContain(8);
    expect(queries[0].values).not.toContain(7);
  });

  it("пустой список не ходит в базу вовсе", async () => {
    const { tx, queries } = spyTx();
    await reserveStock(tx, { tenantId: 1, warehouseId: 2, items: [] });
    await releaseStock(tx, { tenantId: 1, warehouseId: 2, items: [] });
    await receiveStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 0, reason: "arrival" });
    expect(queries).toHaveLength(0);
  });

  it("резерв и снятие не пишут движение в журнал", async () => {
    // Товар никуда не уехал: сумма движений обязана оставаться тем, что
    // физически вошло и вышло со склада.
    const { tx } = spyTx();
    await reserveStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    await releaseStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    expect(movements(tx)).toBe(0);
  });

  it("смена статуса без движения товара тоже не идёт в журнал", async () => {
    // «Новый → в работе» перекладывает два числа и ничего не двигает.
    const { tx } = spyTx();
    await applyStockEffect(tx, {
      tenantId: 1, warehouseId: 2, items: ONE,
      shift: { onHand: 0, held: 1 },
      reason: "order_delivery",
    });
    expect(movements(tx)).toBe(0);
  });

  it("смена статуса с движением товара пишет его в журнал", async () => {
    const { tx } = spyTx();
    await applyStockEffect(tx, {
      tenantId: 1, warehouseId: 2, items: ONE,
      shift: { onHand: -1, held: -1 },
      reason: "order_delivery",
    });
    expect(movements(tx)).toBe(1);
  });
});

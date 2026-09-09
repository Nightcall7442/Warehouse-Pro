import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { receiveStock, reserveStock, releaseStock } from "../services/stock-ledger";

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

const ONE = [{ productId: 7, quantity: 5 }];

describe("форма запроса", () => {
  it("available считается ПЕРВЫМ, пока reserved ещё старый", async () => {
    /*
      Ровно та ошибка, которую не ловит ни один стенд с поддельной базой.
      MySQL вычисляет SET слева направо, и правые части видят уже обновлённые
      колонки: посчитай reserved первым — разница `GREATEST(0, reserved + Δ) −
      reserved` возьмётся от самой себя и выйдет нулём, а в свободный остаток
      не вернётся ничего.
    */
    const { tx, queries } = spyTx();
    await reserveStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const sql = queries[0].text;
    const availableAt = sql.indexOf("available =");
    const reservedAt = sql.indexOf("reserved  =");
    expect(availableAt, "в запросе нет присвоения available").toBeGreaterThan(0);
    expect(reservedAt, "в запросе нет присвоения reserved").toBeGreaterThan(0);
    expect(availableAt, "присвоения переставлены местами — available считается после reserved")
      .toBeLessThan(reservedAt);
  });

  it("ограничитель применён к ОБЕИМ колонкам", async () => {
    /*
      Наивная запись `reserved = GREATEST(0, reserved + Δ), available -= Δ`
      разъезжается ровно тогда, когда ограничитель срабатывает: резерв
      упирается в ноль, а свободное прибавляет всю величину. Остаток становится
      больше физического, и система разрешает продать то, чего нет.
    */
    const { tx, queries } = spyTx();
    await releaseStock(tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const sql = queries[0].text;
    expect(sql).toContain("GREATEST(0, reserved +");
    // Величина сдвига available — фактически применённая, а не заявленная.
    expect(sql).toMatch(/available = available - \(GREATEST\(0, reserved \+[\s\S]*?\) - reserved\)/);
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
    const { tx, queries } = spyTx();
    await receiveStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 5, reason: "arrival" });
    expect(queries[0].text).toContain("ON DUPLICATE KEY UPDATE");
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
    // Товар назван один раз на ветку CASE плюс один раз в списке IN.
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
    expect((tx as unknown as { insert: { mock: { calls: unknown[] } } }).insert.mock.calls).toHaveLength(0);
  });
});

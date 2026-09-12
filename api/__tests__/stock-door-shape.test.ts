import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  applyStockEffect, batchKeyOf, receiveStock, releaseStock, reserveStock, setStock, shipStock,
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

describe("партии остатка", () => {
  /*
    Партии ждали двери, и это была не отговорка: пока остаток меняли
    девятнадцать мест сырым SQL, любой параллельный учёт разъезжался бы с ним —
    достаточно одного пути, который про партии забыл. Теперь путь один, и
    партии двигает он же, тем же вызовом.

    Арифметику FEFO проверяет real-db/stock-batches-fefo.test.ts: там запросы
    ИСПОЛНЯЮТСЯ. Здесь — то, что подделкой базы не проверить вовсе: порядок
    сортировки и блокировка на чтении.
  */
  const batchQueries = (queries: Array<{ text: string; values: unknown[] }>) =>
    queries.filter(q => q.text.includes("stock_batches"));

  const shipOne = async (tenantId = 1, warehouseId = 2, productId = 7) => {
    const spy = spyTx();
    await shipStock(spy.tx, {
      tenantId, warehouseId,
      items: [{ productId, orderedQuantity: 5, deliveredQuantity: 5 }],
      reason: "order_delivery",
    });
    return spy;
  };

  it("списание идёт по сроку: раньше сгорит — раньше уйдёт", async () => {
    /*
      FEFO, а не FIFO. Партия, привезённая позже, но сгорающая раньше, обязана
      уйти первой — иначе она досидит до срока и поедет в утиль.

      И главное: `expires_at IS NULL` ПЕРВЫМ полем сортировки. MySQL ставит
      NULL перед значениями, поэтому без него бессрочные партии уходили бы
      первыми — ровно наоборот, а сгорающее оставалось бы лежать. Подделкой
      базы такую перестановку не поймать: она не сортирует вовсе.
    */
    const { queries } = await shipOne();
    const [select] = batchQueries(queries);
    expect(select, "списание не спрашивает партии вовсе").toBeDefined();
    expect(select.text.replace(/\s+/g, " "))
      .toContain("ORDER BY expires_at IS NULL, expires_at, received_at, id");
  });

  it("партии читаются под блокировкой", async () => {
    /*
      Решение «сколько взять из этой партии» принимается по ПРОЧИТАННОМУ
      остатку. Без FOR UPDATE две одновременные отгрузки читают одно и то же
      число, обе решают, что партии хватает, и обе с неё списывают: сумма
      партий уходит ниже остатка и перестаёт с ним сходиться.
    */
    const { queries } = await shipOne();
    expect(batchQueries(queries)[0].text).toContain("FOR UPDATE");
  });

  it("пустые партии в очередь списания не встают", async () => {
    // Иначе цикл перебирал бы нули, а отчёт «что сгорает» звал бы человека
    // списывать то, чего нет.
    const { queries } = await shipOne();
    expect(batchQueries(queries)[0].text).toContain("quantity > 0");
  });

  it("списываются партии своей организации, своего склада и своего товара", async () => {
    const { queries } = await shipOne(91, 92, 70);
    const select = batchQueries(queries)[0];
    expect(select.text).toContain("tenant_id =");
    expect(select.text).toContain("warehouse_id =");
    expect(select.text).toContain("product_id =");
    expect(select.values).toEqual(expect.arrayContaining([91, 92, 70]));
  });

  it("резерв и снятие резерва партий не касаются", async () => {
    // Товар никуда не уехал: он на той же полке, просто обещан заказу.
    const a = spyTx(); await reserveStock(a.tx, { tenantId: 1, warehouseId: 2, items: ONE });
    const b = spyTx(); await releaseStock(b.tx, { tenantId: 1, warehouseId: 2, items: ONE });
    expect(batchQueries(a.queries), "резерв полез в партии").toHaveLength(0);
    expect(batchQueries(b.queries), "снятие резерва полезло в партии").toHaveLength(0);
  });

  it("приход БЕЗ партии её не заводит", async () => {
    // Возврат от магазина, оприходование, товар без срока — партии у них нет,
    // и выдумывать её нельзя: приписанный чужой срок отправит товар в утиль.
    const { tx, queries } = spyTx();
    await receiveStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 5, reason: "order_return" });
    expect(batchQueries(queries)).toHaveLength(0);
  });

  it("приход С партией заводит её одним запросом", async () => {
    /*
      Одним INSERT .. ON DUPLICATE KEY UPDATE, а не «поискать и вставить»: на
      ПЕРВОМ приходе партии искать нечего, заблокировать несуществующую строку
      нельзя, и два одновременных прихода оба пошли бы вставлять.
    */
    const { tx, queries } = spyTx();
    await receiveStock(tx, {
      tenantId: 1, warehouseId: 2, productId: 7, quantity: 5, reason: "arrival",
      batch: { batchNumber: "A", expiresAt: "2026-03-01" },
    });
    const [insert] = batchQueries(queries);
    expect(insert.text).toContain("INSERT INTO stock_batches");
    // Повтор партии прибавляет количество и обновляет себестоимость, если её прислали.
    expect(insert.text).toMatch(/ON DUPLICATE KEY UPDATE\s+quantity = quantity \+/);
    expect(insert.text).toContain("cost_price = COALESCE(");
    expect(insert.values).toEqual(expect.arrayContaining(["A", "2026-03-01", "A|2026-03-01", 5]));
  });

  it("партия без номера и без срока — отказ, а не строка-пустышка", async () => {
    /*
      Такая строка ничем не отличается от остатка без партии, но встаёт в
      очередь списания, ничего о сроке не говоря: FEFO начал бы брать из неё
      раньше настоящей сгорающей.
    */
    const { tx, queries } = spyTx();
    await expect(receiveStock(tx, {
      tenantId: 1, warehouseId: 2, productId: 7, quantity: 5, reason: "arrival",
      batch: { batchNumber: null, expiresAt: null },
    })).rejects.toThrow(/номер партии или срок годности/);
    expect(queries, "в базу ушёл запрос при негодном входе").toHaveLength(0);
  });

  it("ключ партии различает то, что различается", () => {
    /*
      Уникальный индекс нельзя построить прямо по номеру и сроку: MySQL считает
      строки с NULL РАЗЛИЧНЫМИ, и партия без номера заводилась бы заново при
      каждом приходе — ON DUPLICATE KEY не срабатывал бы никогда.
    */
    expect(batchKeyOf({ batchNumber: "A", expiresAt: "2026-03-01" })).toBe("A|2026-03-01");
    expect(batchKeyOf({ expiresAt: "2026-03-01" })).toBe("|2026-03-01");
    expect(batchKeyOf({ batchNumber: "A" })).toBe("A|");

    // Разные партии — разные ключи; одинаковые — один.
    expect(batchKeyOf({ batchNumber: "A", expiresAt: "2026-03-01" }))
      .not.toBe(batchKeyOf({ batchNumber: "A", expiresAt: "2026-04-01" }));
    expect(batchKeyOf({ batchNumber: null, expiresAt: "2026-03-01" }))
      .toBe(batchKeyOf({ expiresAt: "2026-03-01" }));
  });

  it("установка числом подрезает партии, а не оставляет их выше остатка", async () => {
    // Инвентаризация приносит итог. Оставить партий больше, чем на полке,
    // значит звать человека списывать несуществующий товар.
    const { tx, queries } = spyTx();
    await setStock(tx, { tenantId: 1, warehouseId: 2, productId: 7, quantity: 4 });
    const asked = batchQueries(queries);
    expect(asked, "установка числом партии не проверяет").not.toHaveLength(0);
    expect(asked[0].text).toContain("SUM(quantity)");
  });
});

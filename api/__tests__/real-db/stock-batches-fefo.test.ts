/**
 * Партии остатка: FEFO и согласие с остатком.
 *
 * ── Почему только на настоящей базе ─────────────────────────────────────────
 *
 * Списание по FEFO — это чтение под блокировкой, сортировка средствами MySQL и
 * цикл правок. Заглушки не исполняют ни то, ни другое, ни третье: у них нет
 * ни `ORDER BY expires_at IS NULL`, ни `FOR UPDATE`, ни уникального индекса,
 * на который опирается «одна строка на партию». Проверять этот код подделкой
 * значило бы проверять подделку.
 *
 * ── Что здесь на самом деле проверяется ─────────────────────────────────────
 *
 * Одно свойство, из которого следует всё остальное:
 *
 *     SUM(stock_batches.quantity) <= warehouse_stock.current_stock
 *
 * Не равенство. Партии покрывают не весь остаток — у товара, лежавшего до
 * появления учёта, у бытовой химии без срока и у вернувшегося от магазина
 * товара партии нет вовсе. Но БОЛЬШЕ, чем лежит на полке, партий быть не может
 * никогда: иначе отчёт «что сгорает» зовёт человека списывать то, чего нет.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { receiveStock, shipStock, reserveStock, releaseStock, setStock } from "../../services/stock-ledger";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

/**
 * Сроки — от сегодняшнего дня. Жёсткие даты протухли бы: отгрузка
 * просроченное больше не берёт, и «сгорает раньше» через год стало бы
 * «уже сгорела».
 */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SOON = inDays(60);
const MID = inDays(120);
const LATER = inDays(400);
const GONE = inDays(-1);

describeIf("партии остатка на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("0.000");
  });

  const receive = (quantity: number, batch?: { batchNumber?: string | null; expiresAt?: string | null }) =>
    receiveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId,
      quantity, reason: "arrival", batch: batch ?? null,
    });

  const ship = (ordered: number, delivered = ordered) =>
    shipStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, orderedQuantity: ordered, deliveredQuantity: delivered }],
      reason: "order_delivery",
    });

  /** Партии товара в том порядке, в каком их списывает FEFO. */
  async function batches(productId = s.productId): Promise<Array<{ batch: string | null; expires: string | null; qty: number }>> {
    const rows = await db.execute(sql`
      SELECT batch_number AS b, DATE_FORMAT(expires_at, '%Y-%m-%d') AS e, quantity AS q
      FROM stock_batches
      WHERE product_id = ${productId} AND tenant_id = ${s.tenantId}
      ORDER BY expires_at IS NULL, expires_at, received_at, id
    `);
    const [list] = rows as unknown as [Array<{ b: string | null; e: string | null; q: unknown }>, unknown];
    return (list ?? []).map(r => ({ batch: r.b, expires: r.e, qty: Number(r.q) }));
  }

  /** Главный инвариант: партий не больше, чем лежит на полке. */
  async function expectInvariant(productId = s.productId) {
    const st = await stockOf(productId);
    const inBatches = (await batches(productId)).reduce((sum, b) => sum + b.qty, 0);
    expect(inBatches, `партий (${inBatches}) больше, чем остатка (${st.current})`)
      .toBeLessThanOrEqual(st.current);
    return { st, inBatches };
  }

  it("приход с партией заводит её, а без партии — нет", async () => {
    await receive(10, { batchNumber: "A", expiresAt: LATER });
    await receive(5);

    const rows = await batches();
    expect(rows, "безымянный приход завёл себе партию").toHaveLength(1);
    expect(rows[0]).toEqual({ batch: "A", expires: LATER, qty: 10 });

    // Остаток — весь: и партийный, и безымянный.
    const { st, inBatches } = await expectInvariant();
    expect(st.current).toBe(15);
    expect(inBatches).toBe(10);
  });

  it("та же партия дважды — ОДНА строка, а не две", async () => {
    /*
      Тот же товар с тем же сроком, привезённый дважды, — это одна партия на
      полке. Две строки означали бы два ответа на вопрос «сколько осталось», а
      отчёт «что сгорает» показывал бы один товар несколькими строками.

      Держит это уникальный индекс по КЛЮЧУ партии, а не по двум колонкам:
      MySQL считает строки с NULL различными, и партия без номера заводилась бы
      заново при каждом приходе.
    */
    await receive(10, { batchNumber: "A", expiresAt: LATER });
    await receive(7, { batchNumber: "A", expiresAt: LATER });

    const rows = await batches();
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(17);
  });

  it("партия без номера, но со сроком тоже не двоится", async () => {
    // Ровно тот случай, на котором индекс по двум колонкам молча не сработал бы.
    await receive(4, { expiresAt: MID });
    await receive(6, { expiresAt: MID });

    const rows = await batches();
    expect(rows, "партия без номера завелась дважды").toHaveLength(1);
    expect(rows[0].qty).toBe(10);
  });

  it("партия без номера и без срока — отказ", async () => {
    // Такая строка ничем не отличается от остатка без партии и только мешала
    // бы FEFO: она встала бы в очередь списания, ничего о сроке не говоря.
    await expect(receive(5, { batchNumber: null, expiresAt: null }))
      .rejects.toThrow(/номер партии или срок годности/);
  });

  it("первой уходит та, что раньше СГОРИТ, а не та, что раньше пришла", async () => {
    /*
      FEFO, а не FIFO — и разница здесь прямые деньги.

      Партия B пришла ПОЗЖЕ, но сгорает раньше. Уйди первой A — B досидит до
      срока и поедет в утиль.
    */
    await receive(10, { batchNumber: "A", expiresAt: LATER });
    await receive(10, { batchNumber: "B", expiresAt: SOON });

    await ship(6);

    const rows = await batches();
    expect(rows.map(r => [r.batch, r.qty])).toEqual([["B", 4], ["A", 10]]);
    await expectInvariant();
  });

  it("списание переливается через партию, когда её не хватает", async () => {
    await receive(5, { batchNumber: "B", expiresAt: SOON });
    await receive(10, { batchNumber: "A", expiresAt: LATER });

    await ship(8);

    expect(await batches()).toEqual([
      { batch: "A", expires: LATER, qty: 7 },
    ]);
    await expectInvariant();
  });

  it("бессрочная партия уходит ПОСЛЕДНЕЙ", async () => {
    /*
      MySQL сортирует NULL перед значениями, поэтому без явного
      `ORDER BY expires_at IS NULL` бессрочные уходили бы ПЕРВЫМИ — то есть
      ровно наоборот: сгорающее оставалось бы лежать.
    */
    await receive(10, { batchNumber: "БЕЗ СРОКА" });
    await receive(10, { batchNumber: "СГОРИТ", expiresAt: SOON });

    await ship(6);

    const rows = await batches();
    expect(rows.map(r => [r.batch, r.qty])).toEqual([["СГОРИТ", 4], ["БЕЗ СРОКА", 10]]);
  });

  it("не хватило партий — остальное уходит из безымянного остатка", async () => {
    /*
      Отказа здесь нет намеренно: остаток без партии реальный, он лежит в
      warehouse_stock и продаётся. Отказать значило бы запретить продавать
      товар, лежавший на складе до появления учёта партий.
    */
    await receive(20);                                        // без партии
    await receive(5, { batchNumber: "A", expiresAt: SOON });

    await ship(12);

    expect(await batches(), "партия ушла в минус").toEqual([]);
    const { st, inBatches } = await expectInvariant();
    expect(st.current).toBe(13);
    expect(inBatches).toBe(0);
  });

  it("резерв и снятие резерва партий не трогают", async () => {
    // Товар никуда не уехал: он лежит на той же полке, просто обещан заказу.
    await receive(10, { batchNumber: "A", expiresAt: SOON });

    await reserveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, quantity: 4 }],
    });
    expect((await batches())[0].qty, "резерв списал партию").toBe(10);

    await releaseStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, quantity: 4 }],
    });
    expect((await batches())[0].qty).toBe(10);
  });

  it("частичная доставка списывает УВЕЗЁННОЕ, а не заказанное", async () => {
    // Невывезенная часть осталась на полке — значит осталась и в партии.
    await receive(10, { batchNumber: "A", expiresAt: SOON });

    await ship(7, 3);

    expect((await batches())[0].qty).toBe(7);
    await expectInvariant();
  });

  it("инвентаризация подрезает партии под новое число", async () => {
    /*
      Пересчёт приносит ИТОГ, а не движение: какая партия убыла, отсюда не
      видно. Но оставить партий больше, чем лежит на полке, нельзя — отчёт
      «что сгорает» звал бы списывать несуществующий товар.

      Лишнее снимается тем же правилом FEFO.
    */
    await receive(10, { batchNumber: "A", expiresAt: LATER });
    await receive(10, { batchNumber: "B", expiresAt: SOON });

    await setStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 12,
    });

    /*
      Лишними оказались восемь: было 20, пересчёт дал 12. Снимаются они с той
      партии, что сгорит раньше, — у B остаётся 2.

      Здесь стояло ожидание, что B исчезнет целиком, а в партиях останется 10.
      Это была ошибка в самой проверке, а не в коде: она снимала бы с полки
      десять единиц вместо восьми и расходилась с собственным пояснением
      «лишнее снимается тем же правилом FEFO».
    */
    expect(await batches()).toEqual([
      { batch: "B", expires: SOON, qty: 2 },
      { batch: "A", expires: LATER, qty: 10 },
    ]);
    const { st, inBatches } = await expectInvariant();
    expect(st.current).toBe(12);
    // Партии сошлись с полкой ровно: 2 + 10 = 12.
    expect(inBatches).toBe(12);
  });

  it("пересчёт НАШЁЛ больше — партиям это не приписывается", async () => {
    // Какой партии принадлежит найденное, неизвестно; приписать ей чужой срок
    // значило бы соврать в отчёте.
    await receive(10, { batchNumber: "A", expiresAt: SOON });

    await setStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 25,
    });

    expect((await batches())[0].qty).toBe(10);
    const { st } = await expectInvariant();
    expect(st.current).toBe(25);
  });

  it("возврат от магазина ложится в остаток без партии", async () => {
    /*
      Какая именно партия вернулась, никто не записывает. Приписать её к
      сгорающей значило бы выдать чужой срок за настоящий — и отправить
      годный товар в утиль.
    */
    await receive(10, { batchNumber: "A", expiresAt: SOON });
    await ship(10);
    expect(await batches()).toEqual([]);

    await receiveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId,
      quantity: 4, reason: "order_return",
    });

    expect(await batches(), "возврату приписали партию").toEqual([]);
    const { st } = await expectInvariant();
    expect(st.current).toBe(4);
  });

  it("партии одного товара не трогают партии другого", async () => {
    await receive(10, { batchNumber: "A", expiresAt: SOON });
    await receiveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.secondProductId,
      quantity: 10, reason: "arrival", batch: { batchNumber: "A", expiresAt: SOON },
    });

    await ship(10);

    expect(await batches()).toEqual([]);
    expect(await batches(s.secondProductId), "списали чужой товар")
      .toEqual([{ batch: "A", expires: SOON, qty: 10 }]);
  });

  it("дробное количество не округляется", async () => {
    await receive(1.5, { batchNumber: "A", expiresAt: SOON });
    await ship(0.25);
    expect((await batches())[0].qty).toBe(1.25);
  });

  it("два одновременных прихода одной партии складываются", async () => {
    /*
      Причина, по которой заведение партии написано одним INSERT .. ON
      DUPLICATE KEY UPDATE. «Поискать и вставить» на ПЕРВОМ приходе теряет
      один из двух запросов: оба не находят строки, оба идут вставлять.
    */
    await Promise.all([
      receive(3, { batchNumber: "A", expiresAt: SOON }),
      receive(4, { batchNumber: "A", expiresAt: SOON }),
      receive(5, { batchNumber: "A", expiresAt: SOON }),
    ]);

    const rows = await batches();
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(12);
  });

  it("просроченная партия не уходит в отгрузку, но уходит в списание первой", async () => {
    /*
      FEFO без условия по сроку отдавал магазину первой именно сгоревшую
      партию — «раньше всех портится» она и есть. Годное уходит в отгрузку,
      просрочка ждёт списания и уходит первой именно в него.
    */
    await receive(10, { batchNumber: "GONE", expiresAt: GONE });
    await receive(10, { batchNumber: "OK", expiresAt: LATER });

    await ship(4);
    expect((await batches()).map(r => [r.batch, r.qty])).toEqual([["GONE", 10], ["OK", 6]]);

    const { applyStockEffect } = await import("../../services/stock-ledger");
    await applyStockEffect(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, quantity: 3 }],
      shift: { onHand: -1, held: 0 }, reason: "manual_adjustment", notes: "утиль",
    });
    expect((await batches()).map(r => [r.batch, r.qty])).toEqual([["GONE", 7], ["OK", 6]]);
    await expectInvariant();
  });

  it("годное к продаже — без просроченного", async () => {
    await receive(10, { batchNumber: "GONE", expiresAt: GONE });
    await receive(5, { batchNumber: "OK", expiresAt: LATER });
    const { expiredByProduct } = await import("../../services/stock-ledger");
    const m = await expiredByProduct(db as never, s.tenantId, s.warehouseId, [s.productId]);
    expect(m.get(s.productId)).toBe(10);
  });

  it("себестоимость партии — с приёмки; повтор партии без цены цену не стирает", async () => {
    await receiveStock(db as never, { tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 4, reason: "arrival",
      batch: { batchNumber: "C", expiresAt: LATER, costPrice: "9500.00" } });
    await receiveStock(db as never, { tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 2, reason: "arrival",
      batch: { batchNumber: "C", expiresAt: LATER } });
    const [rows] = await db.execute(sql`SELECT quantity, cost_price AS cost FROM stock_batches WHERE batch_number = 'C'`) as unknown as [Array<{ quantity: string; cost: string | null }>];
    expect(rows).toEqual([{ quantity: "6.00", cost: "9500.00" }]);
  });
});


import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { receiveStock } from "../../services/stock-ledger";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf,
  type ServiceDb,
} from "./harness";

/**
 * Дверь для остатка: приход товара на склад.
 *
 * ── Зачем настоящая база ────────────────────────────────────────────────────
 *
 * Арифметика остатка живёт в SQL, и живёт там нарочно: `current_stock =
 * current_stock + ?` атомарен на уровне строки, а «прочитать, сложить,
 * записать» — нет, и два одновременных прихода одного товара перетёрли бы друг
 * друга. Подделкой базы такое не проверить: заглушка подтвердит любой текст
 * запроса, включая неверный. Здесь запрос ИСПОЛНЯЕТСЯ.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Остаток меняли девятнадцать мест сырым SQL в двенадцати файлах, каждое
 * по-своему. Приход брал `SELECT .. FOR UPDATE`, а следом UPDATE или INSERT —
 * но заблокировать НЕСУЩЕСТВУЮЩУЮ строку нельзя, и ровно при первом приходе
 * товара на склад защиты не было вовсе. Возврат делал голый UPDATE: не нашлось
 * строки остатка — возврат приняли, с магазина списали, а на склад товар не
 * попал. Ни ошибки, ни записи.
 */
describe.skipIf(!hasRealDb)("дверь для остатка: receiveStock", () => {
  let db: ServiceDb;
  let s: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => { db = await connectRealDb(); }, 120_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const receive = (quantity: number) => receiveStock(db as never, {
    tenantId: s.tenantId,
    warehouseId: s.warehouseId,
    productId: s.productId,
    quantity,
    reason: "arrival",
    referenceId: 1,
    notes: "тест",
  });

  it("складывает с тем, что уже лежало", async () => {
    await receive(5);
    const st = await stockOf(s.productId);
    expect(st.current).toBe(15);
    expect(st.available).toBe(15);
  });

  it("заводит строку остатка, если её ещё нет", async () => {
    /*
      Ровно то, на чём терялся возврат: голый UPDATE не совпадал ни с одной
      строкой и молча не делал ничего.
    */
    await db.execute(sql`DELETE FROM warehouse_stock WHERE product_id = ${s.productId}`);
    expect(await countOf("warehouse_stock", `product_id = ${s.productId}`)).toBe(0);

    await receive(10);

    const st = await stockOf(s.productId);
    expect(st.current).toBe(10);
    expect(st.available).toBe(10);
    expect(st.reserved).toBe(0);
  });

  it("не трогает резерв", async () => {
    /*
      Отложенное под чужой заказ остаётся отложенным: приход увеличивает и
      остаток, и свободное, но резерв не освобождает и не занимает.
    */
    await db.execute(sql`
      UPDATE warehouse_stock SET reserved = 4, available = 6
      WHERE product_id = ${s.productId}
    `);

    await receive(5);

    const st = await stockOf(s.productId);
    expect(st.reserved, "резерв изменился").toBe(4);
    expect(st.current).toBe(15);
    expect(st.available).toBe(11);
    // Главный инвариант склада: всё, что лежит, либо свободно, либо отложено.
    expect(st.available + st.reserved).toBe(st.current);
  });

  it("пишет движение в журнал тем же вызовом", async () => {
    // Раньше это был отдельный вызов следом, и его можно было забыть: журнал
    // тогда расходится с остатком, а разошедшийся журнал не проверяет ничего.
    await receive(7);
    expect(await countOf("stock_movements", `product_id = ${s.productId} AND type = 'in'`)).toBe(1);
    expect(await countOf("stock_movements", `product_id = ${s.productId} AND quantity = 7.00`)).toBe(1);
  });

  it("ноль ничего не делает — ни остатка, ни записи в журнале", async () => {
    await receive(0);
    const st = await stockOf(s.productId);
    expect(st.current).toBe(10);
    expect(await countOf("stock_movements", `product_id = ${s.productId}`)).toBe(0);
  });

  it("два одновременных прихода складываются, а не перетирают друг друга", async () => {
    /*
      Причина, по которой арифметика осталась в SQL. Прежний способ — найти
      строку, потом вставить — на ПЕРВОМ приходе товара терял один из двух
      запросов: оба не находили строки, оба шли вставлять, и второй либо падал
      на уникальном ключе, либо затирал первый.
    */
    await db.execute(sql`DELETE FROM warehouse_stock WHERE product_id = ${s.productId}`);
    await Promise.all([receive(3), receive(4), receive(5)]);
    const st = await stockOf(s.productId);
    expect(st.current).toBe(12);
    expect(st.available).toBe(12);
  });

  it("дробное количество не округляется", async () => {
    // Колонка decimal: полтора килограмма обязаны остаться полутора.
    await db.execute(sql`DELETE FROM warehouse_stock WHERE product_id = ${s.productId}`);
    await receive(1.5);
    await receive(0.25);
    const st = await stockOf(s.productId);
    expect(st.current).toBe(1.75);
  });

  it("чужой организации приход не достаётся", async () => {
    // tenant_id входит в уникальный ключ; строка соседа не должна ни
    // обновиться, ни помешать завести свою.
    await receiveStock(db as never, {
      tenantId: s.otherTenantId,
      warehouseId: s.warehouseId,
      productId: s.productId,
      quantity: 100,
      reason: "arrival",
    });
    const mine = await stockOf(s.productId);
    expect(mine.current, "приход соседа лёг в наш остаток").toBe(10);
    expect(await countOf("warehouse_stock", `tenant_id = ${s.otherTenantId}`)).toBe(1);
  });
});

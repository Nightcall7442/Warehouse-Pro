import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { reserveStock, releaseStock } from "../../services/stock-ledger";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf,
  type ServiceDb,
} from "./harness";

/**
 * Дверь для остатка: резерв и снятие резерва.
 *
 * ── Что это за операции ─────────────────────────────────────────────────────
 *
 * Резерв ничего не двигает физически: товар лежит на том же складе, просто
 * обещан заказу. Поэтому current_stock не меняется, а в журнал движений это НЕ
 * пишется — иначе сумма движений перестанет быть тем, что вошло и вышло.
 *
 * ── Где здесь легко ошибиться ───────────────────────────────────────────────
 *
 * 1. ПОРЯДОК ПРИСВОЕНИЙ. MySQL вычисляет SET слева направо, и правые части
 *    видят уже обновлённые колонки. При снятии резерва available обязан
 *    считаться ПЕРВЫМ, пока reserved хранит старое значение. Поменяй местами —
 *    LEAST возьмёт уже уменьшенный резерв, и в свободное вернётся меньше, чем
 *    сняли. Тождество available + reserved = current_stock разойдётся молча.
 *
 * 2. ОГРАНИЧИТЕЛИ. Вернуть можно ровно столько, сколько лежало в резерве:
 *    LEAST(количество, reserved). Прибавь к свободному полное количество при
 *    просевшем резерве — и в остатке появятся единицы, которых на складе нет.
 *
 * Проверить это подделкой базы нельзя: заглушка подтвердит любой текст запроса,
 * включая тот, где присвоения переставлены местами.
 */
describe.skipIf(!hasRealDb)("дверь для остатка: резерв и снятие", () => {
  let db: ServiceDb;
  let s: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => { db = await connectRealDb(); }, 120_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const reserve = (quantity: number, productId = s.productId) =>
    reserveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId, quantity }],
    });

  const release = (quantity: number, productId = s.productId) =>
    releaseStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId, quantity }],
    });

  /** Тождество склада: всё, что лежит, либо свободно, либо отложено. */
  const expectInvariant = async (productId = s.productId) => {
    const st = await stockOf(productId);
    expect(st.available + st.reserved, "available + reserved разошлось с current_stock").toBe(st.current);
    expect(st.reserved, "резерв ушёл в минус").toBeGreaterThanOrEqual(0);
    return st;
  };

  it("резерв перекладывает из свободного в отложенное, остаток не трогает", async () => {
    await reserve(3);
    const st = await expectInvariant();
    expect(st.current).toBe(10);
    expect(st.reserved).toBe(3);
    expect(st.available).toBe(7);
  });

  it("снятие возвращает ровно столько, сколько лежало", async () => {
    await reserve(3);
    await release(3);
    const st = await expectInvariant();
    expect(st.reserved).toBe(0);
    expect(st.available).toBe(10);
  });

  it("снять больше, чем в резерве, нельзя — вернётся только резерв", async () => {
    /*
      Главный ограничитель. Прибавь дверь к свободному полное количество при
      резерве меньше него — и в остатке появятся единицы, которых на складе
      нет: available стал бы 13 при current_stock = 10.
    */
    await reserve(2);
    await release(9);
    const st = await expectInvariant();
    expect(st.reserved).toBe(0);
    expect(st.available, "в свободное вернулось больше, чем было отложено").toBe(10);
  });

  it("снятие при пустом резерве ничего не меняет", async () => {
    await release(5);
    const st = await expectInvariant();
    expect(st.reserved).toBe(0);
    expect(st.available).toBe(10);
  });

  it("порядок присвоений сохранён: возвращается ПОЛНЫЙ резерв, а не остаток от него", async () => {
    /*
      Тест ловит перестановку SET местами. Если reserved посчитается первым,
      LEAST(4, reserved) возьмёт уже обнулённый резерв, в свободное вернётся 0,
      и available останется 6 при current_stock 10 — тождество сломано.
    */
    await reserve(4);
    await release(4);
    const st = await expectInvariant();
    expect(st.available, "available посчитан после reserved").toBe(10);
  });

  it("несколько товаров одним запросом", async () => {
    await reserveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, quantity: 2 }, { productId: s.secondProductId, quantity: 5 }],
    });
    const a = await expectInvariant(s.productId);
    const b = await expectInvariant(s.secondProductId);
    expect(a.reserved).toBe(2);
    expect(b.reserved).toBe(5);
    // Товар, которого нет в списке, не должен пострадать от ветки ELSE.
    expect(a.available).toBe(8);
    expect(b.available).toBe(5);
  });

  it("ноль в списке ничего не меняет и не ломает запрос", async () => {
    await reserveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId,
      items: [{ productId: s.productId, quantity: 0 }, { productId: s.secondProductId, quantity: 3 }],
    });
    expect((await expectInvariant(s.productId)).reserved).toBe(0);
    expect((await expectInvariant(s.secondProductId)).reserved).toBe(3);
  });

  it("пустой список не ходит в базу вовсе", async () => {
    await reserveStock(db as never, { tenantId: s.tenantId, warehouseId: s.warehouseId, items: [] });
    expect((await stockOf(s.productId)).reserved).toBe(0);
  });

  it("ни резерв, ни снятие не пишут движение в журнал", async () => {
    // Товар никуда не уехал: сумма движений обязана оставаться тем, что
    // физически вошло и вышло со склада.
    await reserve(3);
    await release(3);
    expect(await countOf("stock_movements", `product_id = ${s.productId}`)).toBe(0);
  });

  it("чужая организация не затрагивается", async () => {
    await db.execute(sql`
      INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
      VALUES (${s.otherTenantId}, ${s.warehouseId}, ${s.productId}, 10, 0, 10)
    `);
    await reserve(4);
    const rows = await db.execute(sql`
      SELECT reserved AS r FROM warehouse_stock
      WHERE tenant_id = ${s.otherTenantId} AND product_id = ${s.productId}
    `);
    const [list] = rows as unknown as [Array<{ r: string }>, unknown];
    expect(Number(list[0]?.r ?? -1), "резерв лёг на чужую организацию").toBe(0);
  });

  it("дробное количество не округляется", async () => {
    await reserve(1.5);
    const st = await expectInvariant();
    expect(st.reserved).toBe(1.5);
    expect(st.available).toBe(8.5);
  });
});

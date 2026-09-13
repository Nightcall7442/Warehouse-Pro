import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { LoadingListService } from "../../services/loading-list";

/**
 * Сборка листа по строкам на настоящей базе.
 *
 * Лист собирается из заказов, получает строки с партиями по FEFO (тем же
 * порядком, каким спишет отгрузка: раньше сгорает — раньше уходит,
 * просроченное не берём). «Готов» — только через подтверждение; недостача
 * остаётся в строках и уходит офису.
 */
describe.skipIf(!hasRealDb)("сборка листа по строкам", () => {
  let db: ServiceDb;
  let s: Seeded;
  let orderId: number;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [op] = await db.insert(schema.users).values({
      tenantId: s.tenantId, name: "Оператор", email: "operator@test.local", passwordHash: "x", role: "operator",
    });
    operatorId = Number(op.insertId);
    // Партии первого товара: B сгорает раньше A; X просрочена и в подсказку не попадает.
    // Просроченной — одна штука: заказ на 4 при остатке 10 проверяет годное (10 − 1 ≥ 4).
    await db.execute(sql`INSERT INTO stock_batches (tenant_id, warehouse_id, product_id, batch_key, batch_number, expires_at, quantity) VALUES
      (${s.tenantId}, ${s.warehouseId}, ${s.productId}, 'A|2026-12-01', 'A', '2026-12-01', 3.00),
      (${s.tenantId}, ${s.warehouseId}, ${s.productId}, 'B|2026-10-01', 'B', '2026-10-01', 2.00),
      (${s.tenantId}, ${s.warehouseId}, ${s.productId}, 'X|2020-01-01', 'X', '2020-01-01', 1.00)`);
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash",
      items: [{ productId: s.productId, quantity: "4" }, { productId: s.secondProductId, quantity: "2" }],
    });
    orderId = (r as { id: number }).id;
  });

  const makeList = () => LoadingListService.createLoadingList(db, s.tenantId, operatorId, { orderIds: [orderId], format: "aggregated" });

  it("лист получает строки, партии — по FEFO, просроченная не предлагается", async () => {
    const created = await makeList();
    const { lines, status } = await LoadingListService.pickingLines(db, s.tenantId, created.listId);
    expect(status).toBe("preparing");
    expect(lines).toHaveLength(2);
    const first = lines.find(l => Number(l.productId) === s.productId)!;
    expect(Number(first.requiredQty)).toBe(4);
    expect(first.pickedQty).toBeNull();
    // 4 нужно: 2 из B (сгорает раньше), 2 из A; X (просрочена) — мимо.
    expect(first.batches).toEqual([
      { batch: "B", expires: "2026-10-01", qty: 2 },
      { batch: "A", expires: "2026-12-01", qty: 2 },
    ]);
    const second = lines.find(l => Number(l.productId) === s.secondProductId)!;
    expect(second.batches).toBeNull();
    // То же уходит на печать вместе с листом.
    expect(created.items.find(i => Number(i.productId) === s.productId)?.batches).toHaveLength(2);
  });

  it("подтверждение: собранное записано, лист готов, недостача ушла офису", async () => {
    const { listId, listNumber } = await makeList();
    const r = await LoadingListService.confirmPicking(db, s.tenantId, operatorId, listId, [
      { productId: s.productId, pickedQty: "3.00" },   // не хватило одной
      // второй товар не назван — собран как в листе
    ]);
    expect(r.shortages).toEqual([{ productId: s.productId, name: expect.any(String), required: 4, picked: 3 }]);

    const { lines, status } = await LoadingListService.pickingLines(db, s.tenantId, listId);
    expect(status).toBe("ready");
    expect(lines.map(l => Number(l.pickedQty)).sort()).toEqual([2, 3]);

    // Офис узнал сразу, а не от магазина через неделю.
    expect(await countOf("notifications", `type = 'stock' AND user_id = ${operatorId} AND title LIKE 'Недостача при сборке ${listNumber}%'`)).toBe(1);
    // Недостача видна в списке листов.
    const list = (await LoadingListService.listLoadingLists(db, s.tenantId)).data.find(l => l.id === listId)!;
    expect(Number(list.shortLines)).toBe(1);
    // Заказ не тронут: сколько довезли, решит курьер.
    expect(await countOf("order_items", `order_id = ${orderId} AND quantity = 4.000`)).toBe(1);
  });

  it("второй раз не подтверждают; больше заказанного не грузят; кнопка статуса мимо сборки не ведёт", async () => {
    const { listId } = await makeList();
    await expect(LoadingListService.updateLoadingListStatus(db, s.tenantId, listId, "ready")).rejects.toThrow(/по строкам/);
    await expect(LoadingListService.confirmPicking(db, s.tenantId, operatorId, listId, [{ productId: s.productId, pickedQty: "5" }]))
      .rejects.toThrow(/больше заказанного/);
    await LoadingListService.confirmPicking(db, s.tenantId, operatorId, listId, []);
    await expect(LoadingListService.confirmPicking(db, s.tenantId, operatorId, listId, [])).rejects.toThrow(/один раз/);
    // Дальше по цепочке — кнопкой, как прежде.
    await expect(LoadingListService.updateLoadingListStatus(db, s.tenantId, listId, "loading")).resolves.toEqual({ success: true });
  });

  it("чужая организация строк не видит", async () => {
    const { listId } = await makeList();
    await expect(LoadingListService.pickingLines(db, s.otherTenantId, listId)).rejects.toThrow(/не найден/);
  });
});

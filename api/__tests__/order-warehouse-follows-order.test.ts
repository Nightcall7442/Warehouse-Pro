/**
 * Склад заказа — один на всю его жизнь.
 *
 * Резерв ложится на склад при оформлении и пишется в orders.warehouseId.
 * Отмена, удаление, восстановление, правка состава и доставка (офисная и
 * курьерская) снимают или списывают с НЕГО; склад по умолчанию — только для
 * заказов без записи (до этой колонки). Иначе смена умолчания между
 * оформлением и доставкой снимала резерв с одного склада, а списывала с
 * другого. Смена умолчания при открытых заказах или резерве запрещена
 * (warehouse-multi-router.test.ts).
 *
 * Нарочная поломка: верни в order-status `resolveOrderWarehouse(tx, tenantId)`
 * вместо `orderWarehouseId(tx, tenantId, order)` — второй тест падает.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { orderMethod } from "./helpers/order-source";

const read = (p: string) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");

describe("orderWarehouseId", () => {
  it("склад заказа берётся из строки; без него — склад по умолчанию; без умолчания — отказ", async () => {
    const { orderWarehouseId } = await import("../services/order-shared");
    const select = vi.fn();
    const tx = { select } as never;
    // Записанный склад — база не опрашивается вовсе.
    expect(await orderWarehouseId(tx, 1, { warehouseId: 7 })).toBe(7);
    expect(select).not.toHaveBeenCalled();
    // Пусто — склад по умолчанию.
    const chain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) });
    select.mockReturnValueOnce(chain([{ id: 3 }]));
    expect(await orderWarehouseId(tx, 1, { warehouseId: null })).toBe(3);
    select.mockReturnValueOnce(chain([]));
    await expect(orderWarehouseId(tx, 1, { warehouseId: null })).rejects.toThrow("Склад по умолчанию не найден");
  });
});

describe("все пути заказа идут через его склад", () => {
  it("оформление пишет склад резерва в заказ", () => {
    const create = orderMethod("create");
    expect(create).toContain("warehouseId: reserveWarehouseId,");
    expect(create.indexOf("warehouseId: reserveWarehouseId,")).toBeGreaterThan(create.indexOf("tx.insert(orders)"));
  });

  it("отмена, статус, удаление, восстановление, правка состава — по складу заказа", () => {
    const status = read("api/services/order-status.ts");
    const items = read("api/services/order-items.ts");
    // Ни одного обращения к складу по умолчанию мимо заказа.
    expect(status).not.toContain("resolveOrderWarehouse(");
    expect(items).not.toContain("resolveOrderWarehouse(");
    expect((status.match(/await orderWarehouseId\(tx, tenantId, order\)/g) ?? []).length).toBe(4);
    expect((status.match(/warehouseId: orders\.warehouseId/g) ?? []).length).toBe(4);
    expect(items).toContain("await orderWarehouseId(tx, tenantId, order)");
    expect(items).toContain("warehouseId: orders.warehouseId");
  });

  it("курьерская доставка (обе процедуры) — по складу заказа, без чтения умолчания", () => {
    const courier = read("api/services/courier-delivery.ts");
    expect(courier).not.toContain("eq(warehouses.isDefault, true)");
    expect(courier).toContain("await orderWarehouseId(tx, tenantId, order)");
    expect(courier).toContain("await orderWarehouseId(tx, tenantId, locked)");
    expect((courier.match(/warehouseId: orders\.warehouseId/g) ?? []).length).toBe(2);
  });

  it("доставка по частям не пропускает списание молча", () => {
    const partial = orderMethod("applyPartialDelivery");
    expect(partial).not.toContain("if (defaultWh)");
    expect(partial).not.toContain("defaultWh");
    expect(partial).toContain("const whId = await orderWarehouseId(tx, tenantId, order)");
    expect(partial).toContain("warehouseId: whId,");
    // shipStock вызывается безусловно — внутри цикла по позициям.
    const at = partial.indexOf("await shipStock(tx, {");
    expect(at).toBeGreaterThan(0);
    expect(partial.slice(at - 200, at)).not.toMatch(/if \(/);
  });

  it("смена склада по умолчанию проверяет открытые заказы и резерв", () => {
    const router = read("api/warehouse-multi-router.ts");
    const at = router.indexOf("setDefault: adminQuery");
    const body = router.slice(at, router.indexOf("getStock: authedQuery"));
    expect(body).toContain("inArray(orders.status, OPEN_ORDER_STATUSES)");
    expect(body).toContain('gt(warehouseStock.reserved, "0")');
    expect(body).toContain("Сменить склад по умолчанию нельзя");
    expect(body.indexOf("Сменить склад по умолчанию нельзя")).toBeLessThan(body.indexOf("set({ isDefault: false })"));
  });
});

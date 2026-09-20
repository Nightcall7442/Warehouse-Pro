/**
 * Прайс-лист заказа — только своей организации.
 *
 * Аудит 20.09.2026: order.create писал priceListId из запроса как есть
 * (resolvePrices чужой список просто не находил), а order.getById через
 * JOIN без tenant отдавал название чужого прайс-листа — агент организации A
 * перебором id читал имена списков организации B.
 *
 * Нарочная поломка: убери проверку priceLists перед resolvePrices в
 * order-create — упадёт первая; сними eq(priceLists.tenantId, tenantId) из
 * JOIN в order-read — упадёт вторая.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("прайс-лист заказа", () => {
  it("создание отвергает чужой прайс-лист до расчёта цен", () => {
    const src = read("api/services/order-create.ts");
    const check = src.indexOf('eq(priceLists.id, input.priceListId), eq(priceLists.tenantId, tenantId)');
    const resolve = src.indexOf("const resolved = await resolvePrices(");
    expect(check, "проверки принадлежности нет").toBeGreaterThan(0);
    expect(check, "проверка стоит после расчёта цен").toBeLessThan(resolve);
    expect(src).toContain('throw new Error("Прайс-лист не найден")');
  });

  it("чтение соединяет прайс-лист по организации", () => {
    const src = read("api/services/order-read.ts");
    expect(src).toContain("leftJoin(priceLists, and(eq(priceLists.id, orders.priceListId), eq(priceLists.tenantId, tenantId)))");
  });
});

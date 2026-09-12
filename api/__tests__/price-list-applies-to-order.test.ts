/**
 * Прайс-лист магазина участвует в цене заказа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * OrderService.create брал цену строки только из products.unitPrice;
 * priceList.getPrice существовал, но не вызывался ни вебом, ни мобилкой.
 * Экран настроек при этом обещал: «агент видит в заказе цену, назначенную его
 * магазину». Оператор заводил магазину список со скидочной ценой, агент
 * называл владельцу одну сумму, накладная печаталась по другой — спор о долге
 * начинался с первой отгрузки. Ярусы по объёму внутри списка выбирались
 * произвольно (сортировка только по priority).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Правило выбора яруса: больший priority списка, внутри — больший порог,
 *    порог выше количества не подходит, пусто — нет яруса.
 * 2. create и updateItems зовут resolvePrices, строка помнит price_list_id,
 *    ручная цена оператора источник не пишет.
 *
 * Нарочная поломка: убери `|| Number(b.minQuantity) - Number(a.minQuantity)`
 * из pickTier — первая группа падает на ярусе 50.
 */
import { describe, it, expect } from "vitest";
import { pickTier } from "../services/price-resolver";
import { orderMethod } from "./helpers/order-source";

const tier = (priceListId: number, priority: number, minQuantity: string, price: string) =>
  ({ productId: 1, priceListId, priority, minQuantity, price });

describe("выбор яруса прайс-листа", () => {
  const rows = [
    tier(10, 0, "1", "100.00"),
    tier(10, 0, "50", "90.00"),
    tier(20, 5, "1", "95.00"),
  ];

  it("побеждает список с большим приоритетом", () => {
    expect(pickTier(rows, 10)?.price).toBe("95.00");
  });

  it("внутри списка — больший подходящий порог", () => {
    expect(pickTier(rows.filter(r => r.priceListId === 10), 60)?.price).toBe("90.00");
    expect(pickTier(rows.filter(r => r.priceListId === 10), 49)?.price).toBe("100.00");
  });

  it("порог выше количества не подходит; пусто — нет яруса", () => {
    expect(pickTier([tier(10, 0, "50", "90.00")], 10)).toBeUndefined();
    expect(pickTier([], 10)).toBeUndefined();
  });
});

describe("заказ читает прайс-лист", () => {

  it("create разрешает цены через resolvePrices после карточных и пишет источник", () => {
    const create = orderMethod("create");
    expect(create).toContain("resolvePrices(tx, tenantId, input.shopId, items, priceMap)");
    expect(create).toContain("priceListId: resolved.get(item.productId)?.priceListId ?? null");
    // Прайс-лист применяется ДО расчёта subtotal.
    expect(create.indexOf("resolvePrices(")).toBeLessThan(create.indexOf("Calculate subtotal from server-side prices"));
  });

  it("updateItems: новая строка без цены оператора берёт цену магазина", () => {
    const upd = orderMethod("updateItems");
    expect(upd).toContain("resolvePrices(tx, tenantId, order.shopId, newLines, fallback)");
    expect(upd).toContain("Number(line.unitPrice ?? productPrices.get(productId)!.unitPrice)");
    expect(upd).not.toContain("Number(line.unitPrice ?? 0)");
    expect(upd).toContain("priceListId: line.unitPrice === undefined ?");
  });
});

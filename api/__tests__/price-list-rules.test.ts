import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMarkup, pickTier } from "../services/price-resolver";

/**
 * Прайс-листы v2 (владелец, 18.09.2026: «оставь, но доработай как гений;
 * нигде не спрашивает прайс-лист при новом заказе»).
 *
 *   · правило «к карточке»: цена = карточка × (1 + pct/100), до копеек;
 *   · заказ спрашивает прайс-лист (быстрый заказ), хранит его и правит состав
 *     по нему; каталог для магазина отдаёт те же цены, что посчитает заказ
 *     (product.list / listAll с shopId, priceListId → unitPrice + basePrice);
 *   · карточка магазина показывает и меняет его список; форма списка — правило.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n"));

describe("правило «к карточке»", () => {
  it("скидка, наценка, копейки, ноль", () => {
    expect(applyMarkup("100.00", "-7")).toBe("93.00");
    expect(applyMarkup(62000, 5)).toBe("65100.00");
    expect(applyMarkup("33.33", "-10")).toBe("30.00");
    expect(applyMarkup("10.005", "0")).toBe("10.01");
  });
  it("ярус по объёму — как раньше: приоритет списка, потом порог", () => {
    const rows = [
      { productId: 1, price: "90", minQuantity: "1", priority: 0, priceListId: 1 },
      { productId: 1, price: "70", minQuantity: "10", priority: 0, priceListId: 1 },
      { productId: 1, price: "95", minQuantity: "1", priority: 5, priceListId: 2 },
    ];
    expect(pickTier(rows, 12)?.price).toBe("95");
    expect(pickTier(rows.filter(r => r.priceListId === 1), 12)?.price).toBe("70");
  });
});

describe("заказ спрашивает прайс-лист", () => {
  it("быстрый заказ: выбор списка над корзиной, цены каталога по нему, список уходит в заказ", () => {
    const q = read("src/components/orders/QuickOrderModal.tsx");
    expect(q).toContain('data-testid="quick-order-price-list"');
    expect(q).toContain("trpc.priceList.forShop.useQuery({ shopId: shopId ?? 0 }");
    expect(q).toContain("trpc.product.listAll.useQuery({ search: productSearch || undefined, shopId, priceListId: effectivePriceListId })");
    expect(q).toContain("priceListId: effectivePriceListId,");
    expect(q).toContain('label: t("По карточке товара"');
  });
  it("сервер хранит список заказа и правит состав по нему; каталог отдаёт цены магазина", () => {
    expect(read("api/order-router.ts")).toContain("priceListId:    z.number().int().positive().nullable().optional(),");
    expect(read("api/services/order-create.ts")).toContain("priceListId: input.priceListId ?? null,");
    expect(read("api/services/order-items.ts")).toContain("{ shopId: order.shopId, priceListId: order.priceListId }");
    const pr = read("api/product-router.ts");
    expect(pr).toContain("shopId:      z.number().int().positive().optional(),");
    expect(pr.match(/basePrice: row\.unitPrice|basePrice: r\.unitPrice/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read("db/schema.ts")).toContain('priceListId:      bigint("price_list_id", { mode: "number", unsigned: true }).references(() => priceLists.id, { onDelete: "set null" }),');
    expect(read("db/schema.ts")).toContain('markupPct:   decimal("markup_pct", { precision: 6, scale: 2 }),');
  });
  it("агент и телефон видят цены магазина; карточка заказа знает список; магазин меняет свой список", () => {
    expect(read("src/components/orders/ProductSelector.tsx")).toContain("trpc.product.listAll.useQuery(shopId ? { shopId } : undefined)");
    expect(read("src/pages/NewOrder.tsx")).toContain("shopId={w.shopId || undefined}");
    expect(read("src/pages/OrderDetail.tsx")).toContain("priceListId={order.priceListId ?? null}");
    expect(read("src/pages/OrderDetail.tsx")).toContain("{order.priceListName ??");
    expect(read("src/pages/ShopDetail.tsx")).toContain("<ShopPriceList shopId={Number(id)} />");
    expect(read("src/components/shops/ShopPriceList.tsx")).toContain("trpc.priceList.setForShop.useMutation");
    expect(read("src/components/settings/PriceListSettings.tsx")).toContain('data-testid="price-list-markup"');
    const router = read("api/price-list-router.ts");
    expect(router).toMatch(/forShop: fieldSalesQuery/);
    expect(router).toMatch(/setForShop: operatorQuery\.use\(can\("prices\.manage"\)\)/);
  });
});

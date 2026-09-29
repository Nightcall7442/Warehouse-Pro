import { test, expect } from "@playwright/test";
import { login, trpcQuery, trpcMutate, num } from "./harness";

/**
 * «Повторить» в карточке заказа — через экран до нового заказа.
 *
 * Телефонный заказ почти всегда «как в прошлый раз», а оператор набирал
 * позиции заново. Здесь путь целиком: заказ есть → «Повторить» в его карточке
 * → окно быстрого заказа с тем же магазином и составом → «Создать заказ» →
 * новый заказ того же магазина с тем же товаром и количеством. Проверка —
 * через API, как в остальных сквозных.
 *
 * Нарочная поломка: в QuickOrderModal верни корзину без start.lines — окно
 * откроется пустым, «Далее» погашена, падает «Далее»; в RepeatOrderButton
 * зови repeat({ shopId }) вместо orderId — повторится не тот заказ.
 */

type StockRow = { productId: number; productCode: string | null; available: string };
type Shop = { id: number; name: string };
type OrderRow = { id: number; orderNumber: string; shopId: number };

test.describe("повтор заказа", () => {
  test("из карточки заказа: окно с магазином и составом → новый заказ тем же составом", async ({ page }) => {
    await login(page, "ceo");
    const stock = await trpcQuery<{ data: StockRow[] }>(page, "warehouse.list", { page: 1, pageSize: 1000 });
    const product = stock.data.find(r => num(r.available) >= 5 && !!r.productCode);
    if (!product) throw new Error("в засеве нет товара с остатком не меньше 5");
    const shops = await trpcQuery<{ data: Shop[] }>(page, "shop.list", { page: 1, pageSize: 50 });
    const shop = shops.data[0];
    if (!shop) throw new Error("в засеве нет ни одного магазина");

    const first = await trpcMutate<{ id: number; orderNumber: string }>(page, "order.create", {
      shopId: shop.id, items: [{ productId: product.productId, quantity: "2" }],
    });

    await page.goto(`/orders/${first.id}`);
    await page.getByTestId("order-repeat").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("quick-order-repeat-note")).toContainText(first.orderNumber);
    await dialog.getByRole("button", { name: "Далее" }).click();
    await expect(dialog, "магазин повтора не выбран").toContainText(shop.name);
    await dialog.getByRole("button", { name: "Создать заказ" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const list = await trpcQuery<{ data: OrderRow[] }>(page, "order.list", { page: 1, pageSize: 5 });
    const again = list.data.find(o => o.id > first.id && o.shopId === shop.id);
    expect(again, "повтор не создал заказ этому магазину").toBeTruthy();
    const detail = await trpcQuery<{ items: Array<{ productId: number; quantity: string }> }>(page, "order.getById", { id: again!.id });
    expect(detail.items.map(i => [i.productId, num(i.quantity)])).toEqual([[product.productId, 2]]);
  });
});

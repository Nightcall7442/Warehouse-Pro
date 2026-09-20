import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { login, trpcQuery, num } from "./harness";

/**
 * Жизнь заказа целиком: оформили → напечатали накладную → отдали товар и
 * приняли деньги → офис закрыл расчёт. Один сценарий — путь, который
 * директор проходит руками каждый день; прежние сквозные проверки
 * останавливались на оформлении.
 *
 * Действие — через экран, проверка — через API: остаток, деньги по заказу и
 * долг магазина читаются оттуда же, откуда потом посчитают зарплату.
 *
 * Нарочная поломка: в order-shared.ts не проставляй closedAt при оплате
 * офисом — упадёт «расчёт закрыт офисом»; в order-close.ts не прибавляй
 * остаток к долгу — упадёт «остаток в долг»; в накладной убери номер заказа —
 * упадёт «накладная».
 */

type StockRow = { productId: number; productCode: string | null; productName: string | null; available: string; reserved: string; currentStock: string };
type Shop = { id: number; name: string; debt: string };
type Money = { id: number; number: string; total: number; paid: number; remainder: number; claimed: number; awaiting: boolean; closedAt: string | null };
type OrderRow = { id: number; orderNumber: string; shopId: number; total: string; status: string };

async function stockOf(page: Page, productId: number) {
  const res = await trpcQuery<{ data: StockRow[] }>(page, "warehouse.list", { page: 1, pageSize: 1000 });
  const row = res.data.find(r => r.productId === productId);
  if (!row) throw new Error(`товара ${productId} нет на складе`);
  return { available: num(row.available), reserved: num(row.reserved), current: num(row.currentStock) };
}
async function pickProduct(page: Page, needed: number): Promise<StockRow> {
  const res = await trpcQuery<{ data: StockRow[] }>(page, "warehouse.list", { page: 1, pageSize: 1000 });
  const row = res.data.find(r => num(r.available) >= needed && !!r.productCode);
  if (!row) throw new Error(`в засеве нет товара с остатком не меньше ${needed}`);
  return row;
}
async function pickShop(page: Page): Promise<Shop> {
  const res = await trpcQuery<{ data: Shop[] }>(page, "shop.list", { page: 1, pageSize: 50 });
  if (!res.data[0]) throw new Error("в засеве нет ни одного магазина");
  return res.data[0];
}
const cents = (v: string | number) => Math.round(num(v) * 100);
const debtCents = async (page: Page, shopId: number) => cents((await trpcQuery<Shop>(page, "shop.getById", { id: shopId })).debt);

/** Оформить заказ через экран и вернуть его — самый новый заказ этого магазина, появившийся после оформления. */
async function placeOrder(page: Page, shop: Shop, product: StockRow, qty: number): Promise<OrderRow> {
  const before = await trpcQuery<{ data: OrderRow[] }>(page, "order.list", { page: 1, pageSize: 1 });
  const maxIdBefore = before.data[0]?.id ?? 0;

  await page.goto(`/orders/new?shopId=${shop.id}`);
  await page.getByTestId("product-search").fill(product.productCode as string);
  await page.getByTestId(`product-add-${product.productId}`).click();
  await page.getByTestId(`cart-qty-${product.productId}`).fill(String(qty));
  await page.getByTestId("order-next").click();
  await page.getByTestId("order-next").click();
  await page.waitForURL(/\/orders$/, { timeout: 20_000 });

  const after = await trpcQuery<{ data: OrderRow[] }>(page, "order.list", { page: 1, pageSize: 5 });
  const order = after.data.find(o => o.id > maxIdBefore && o.shopId === shop.id);
  if (!order) throw new Error("оформленный заказ не нашёлся в списке");
  return order;
}

test.describe("жизнь заказа", () => {
  test("оформили → накладная → отдали и приняли деньги → расчёт закрыт офисом сразу", async ({ page, context }) => {
    await login(page, "ceo");
    const QTY = 2;
    const product = await pickProduct(page, QTY + 1);
    const shop = await pickShop(page);
    const stock0 = await stockOf(page, product.productId);
    const debt0 = await debtCents(page, shop.id);

    const order = await placeOrder(page, shop, product, QTY);
    const stock1 = await stockOf(page, product.productId);
    expect(stock1.reserved - stock0.reserved, "оформление зарезервировало не то количество").toBe(QTY);

    // Накладная: печать открывает окно с документом — в нём номер заказа и товар.
    // В безголовом браузере print() возвращается сразу, afterprint закрывает
    // окно раньше, чем его прочтёшь, — печать в окне документа глушится.
    await context.addInitScript(() => { window.print = () => {}; });
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("order-print").click();
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: /Расходная накладная|Chiqim nakladnaya/ }).click();
    const doc = await popup;
    await expect.poll(() => doc.evaluate(() => document.body?.innerText ?? ""), { message: "документ не отрисовался" }).toContain(order.orderNumber);
    const text = await doc.evaluate(() => document.body.innerText);
    await doc.close();
    expect(text, "в накладной нет номера заказа").toContain(order.orderNumber);
    expect(text, "в накладной нет товара").toContain(product.productName as string);

    // Отдали товар и приняли деньги полностью — через экран заказа.
    await page.getByTestId("order-finish").click();
    await page.getByRole("button", { name: /^(Полностью|To'liq)$/ }).click();
    await expect(page.getByTestId("completion-paid")).toHaveValue(/\d/);
    await page.getByTestId("completion-save").click();
    // Оплата, записанная офисом, — это и есть решение по деньгам: расчёт закрыт сразу (order-shared.ts).
    await expect(page.getByTestId("order-money-state")).toContainText(/Рассчитан|Hisoblangan/);

    const stock2 = await stockOf(page, product.productId);
    expect(stock0.current - stock2.current, "доставка списала не заказанное количество").toBe(QTY);
    expect(stock2.reserved, "резерв после доставки не снят").toBe(stock0.reserved);

    const money = await trpcQuery<Money>(page, "order.money", { orderId: order.id });
    expect(cents(money.paid), "оплачено не полностью").toBe(cents(money.total));
    expect(money.remainder, "после полной оплаты остался остаток").toBe(0);
    expect(money.closedAt, "офис принял деньги, а расчёт открыт").not.toBeNull();
    expect(money.awaiting, "закрытый заказ всё ещё ждёт расчёта").toBe(false);
    expect(await debtCents(page, shop.id), "наличный расчёт изменил долг магазина").toBe(debt0);
  });

  test("отдали без денег → остаток уходит в долг магазина ровно на сумму заказа", async ({ page }) => {
    await login(page, "ceo");
    const product = await pickProduct(page, 2);
    const shop = await pickShop(page);
    const debt0 = await debtCents(page, shop.id);

    const order = await placeOrder(page, shop, product, 1);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("order-finish").click();
    await page.getByRole("button", { name: /^(Ничего|Hech narsa)$/ }).click();
    await page.getByTestId("completion-save").click();
    await expect(page.getByTestId("order-close-form")).toBeVisible();

    const money = await trpcQuery<Money>(page, "order.money", { orderId: order.id });
    expect(cents(money.paid), "без оплаты записался платёж").toBe(0);
    expect(cents(money.remainder), "остаток не равен сумме заказа").toBe(cents(order.total));

    // Закрыть нельзя, пока остаток не признан долгом.
    await expect(page.getByTestId("close-order")).toBeDisabled();
    await page.getByTestId("close-accept-debt").check();
    await expect(page.getByTestId("close-order")).toBeEnabled();
    await page.getByTestId("close-order").click();
    await expect(page.getByTestId("order-money-state")).toContainText(/Рассчитан|Hisoblangan/);

    expect(await debtCents(page, shop.id) - debt0, "долг магазина вырос не на сумму заказа").toBe(cents(order.total));
  });
});

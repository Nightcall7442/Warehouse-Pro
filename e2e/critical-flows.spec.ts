import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { login, trpcQuery, num, SEED } from "./harness";

/**
 * Сквозные проверки денежных путей.
 *
 * Действие — через настоящий экран, проверка — через API. Бирка «Выполнен» на
 * карточке ничего не доказывает: заказ можно провести так, что бирка появится,
 * а остаток не спишется. Поэтому здесь везде читается число до и после.
 *
 * Ни одной проверки вида «элемент виден». Нет элемента — проверка обязана
 * упасть, а не пропустить своё тело.
 */

type StockRow = {
  productId: number;
  productCode: string | null;
  productName: string | null;
  available: string;
  reserved: string;
  currentStock: string;
};
type Stock = { data: StockRow[] };
type Shop = { id: number; name: string; debt: string };

/** Остаток по товару — из того же места, по которому считают склад. */
async function stockOf(page: Page, productId: number) {
  const res = await trpcQuery<Stock>(page, "warehouse.list", { page: 1, pageSize: 1000 });
  const row = res.data.find(r => r.productId === productId);
  if (!row) throw new Error(`товара ${productId} нет на складе`);
  return {
    available: num(row.available),
    reserved: num(row.reserved),
    current: num(row.currentStock),
  };
}

/** Товар, которого хватит на проверку, и его код для поиска на экране. */
async function pickProduct(page: Page, needed: number): Promise<StockRow> {
  const res = await trpcQuery<Stock>(page, "warehouse.list", { page: 1, pageSize: 1000 });
  const row = res.data.find(r => num(r.available) >= needed && !!r.productCode);
  if (!row) throw new Error(`в засеве нет товара с остатком не меньше ${needed}`);
  return row;
}

async function pickShop(page: Page): Promise<Shop> {
  const res = await trpcQuery<{ data: Shop[] }>(page, "shop.list", { page: 1, pageSize: 50 });
  const shop = res.data[0];
  if (!shop) throw new Error("в засеве нет ни одного магазина");
  return shop;
}

/* ── Доступ ────────────────────────────────────────────────────────────────── */

test.describe("вход", () => {
  test("без входа на рабочие страницы не пускает", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // И сервер тоже отказывает: перенаправление в браузере само по себе ничего
    // не защищает — данные отдаёт сервер, а не адресная строка.
    const res = await page.request.get("/api/trpc/order.list");
    expect(res.status(), "сервер отдаёт заказы без входа").toBeGreaterThanOrEqual(400);
  });

  test("неверный пароль не создаёт сессию", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(SEED.ceo.email);
    await page.getByTestId("login-password").fill("заведомо-не-тот");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/login/);
    const res = await page.request.get("/api/trpc/user.me");
    expect(res.status(), "сессия выдана при неверном пароле").toBeGreaterThanOrEqual(400);
  });
});

/* ── Заказ и остаток ───────────────────────────────────────────────────────── */

test.describe("заказ", () => {
  test("оформленный заказ резервирует ровно заказанное количество", async ({ page }) => {
    await login(page, "ceo");

    const QTY = 3;
    const product = await pickProduct(page, QTY + 1);
    const shop = await pickShop(page);
    const before = await stockOf(page, product.productId);

    await page.goto(`/orders/new?shopId=${shop.id}`);
    await page.getByTestId("product-search").fill(product.productCode as string);
    await page.getByTestId(`product-qty-${product.productId}`).fill(String(QTY));
    await page.getByTestId(`product-add-${product.productId}`).click();

    await page.getByTestId("order-next").click(); // товары → итог
    await page.getByTestId("order-next").click(); // подтвердить
    await page.waitForURL(/\/orders$/, { timeout: 20_000 });

    const after = await stockOf(page, product.productId);
    expect(after.reserved - before.reserved, "в резерв ушло не то количество, что заказали").toBe(QTY);
    expect(before.available - after.available, "доступный остаток уменьшился не на заказанное").toBe(QTY);
    expect(after.current, "заказ списал товар со склада, хотя должен был только зарезервировать").toBe(before.current);
  });

  test("заказать больше, чем есть, нельзя — и остаток не трогается", async ({ page }) => {
    await login(page, "ceo");

    const product = await pickProduct(page, 1);
    const shop = await pickShop(page);
    const before = await stockOf(page, product.productId);
    const tooMuch = Math.floor(before.available) + 1000;

    const ordersBefore = await trpcQuery<{ total: number }>(page, "order.list", { page: 1, pageSize: 1 });

    await page.goto(`/orders/new?shopId=${shop.id}`);
    await page.getByTestId("product-search").fill(product.productCode as string);
    await page.getByTestId(`product-qty-${product.productId}`).fill(String(tooMuch));
    await page.getByTestId(`product-add-${product.productId}`).click();
    await page.getByTestId("order-next").click();
    await page.getByTestId("order-next").click();

    // Перехода ждать нельзя: отказ обязан оставить человека на месте.
    await expect(page).toHaveURL(/\/orders\/new/);

    const after = await stockOf(page, product.productId);
    expect(after, "отклонённый заказ всё-таки тронул остаток").toEqual(before);

    const ordersAfter = await trpcQuery<{ total: number }>(page, "order.list", { page: 1, pageSize: 1 });
    expect(ordersAfter.total, "заказ на недостающий товар всё-таки создался").toBe(ordersBefore.total);
  });
});

/* ── Долг магазина ─────────────────────────────────────────────────────────── */

test.describe("платёж", () => {
  test("платёж уменьшает долг ровно на внесённую сумму", async ({ page }) => {
    await login(page, "ceo");

    const shop = await pickShop(page);
    const AMOUNT = 50_000;
    const before = num((await trpcQuery<Shop>(page, "shop.getById", { id: shop.id })).debt);

    await page.goto(`/shops/${shop.id}`);
    await page.getByTestId("payment-open").click();
    await page.getByTestId("payment-amount").fill(String(AMOUNT));
    await page.getByTestId("payment-submit").click();

    const debtNow = async () => num((await trpcQuery<Shop>(page, "shop.getById", { id: shop.id })).debt);
    await expect.poll(debtNow, { timeout: 15_000, message: "долг не изменился после платежа" })
      .toBe(before - AMOUNT);
  });

  test("сумма с запятой доходит целиком, а не теряется", async ({ page }) => {
    // Поле было type="number". Браузер на «12,5» отдаёт пустую строку и не
    // считает это ошибкой, а кнопка «Записать» при пустой сумме заблокирована:
    // человек вводил сумму, нажимал — и не происходило ничего.
    await login(page, "ceo");

    const shop = await pickShop(page);
    const before = num((await trpcQuery<Shop>(page, "shop.getById", { id: shop.id })).debt);

    await page.goto(`/shops/${shop.id}`);
    await page.getByTestId("payment-open").click();
    await page.getByTestId("payment-amount").fill("1234,50");

    const submit = page.getByTestId("payment-submit");
    await expect(submit, "поле снова теряет сумму с запятой — кнопка недоступна").toBeEnabled();
    await submit.click();

    const debtNow = async () => num((await trpcQuery<Shop>(page, "shop.getById", { id: shop.id })).debt);
    await expect.poll(debtNow, { timeout: 15_000, message: "платёж с запятой не дошёл или дошёл не полностью" })
      .toBe(before - 1234.5);
  });
});

/* ── Карточка товара ───────────────────────────────────────────────────────── */

test.describe("товар", () => {
  test("цена с запятой сохраняется как введена", async ({ page }) => {
    // Прежде поле было type="number": браузер на «12,5» отдавал пустую строку,
    // сервер подставлял значение по умолчанию, и цена товара становилась
    // нулевой. Ни ошибки, ни записи в журнале.
    await login(page, "ceo");

    const code = `E2E-${Date.now()}`;
    await page.goto("/products");
    await page.getByTestId("product-new").click();
    await page.getByTestId("product-code").fill(code);
    await page.getByTestId("product-name").fill("Проверка запятой");
    await page.getByTestId("product-price").fill("1234,50");
    await page.getByTestId("product-save").click();

    const price = await expectEventually(async () => {
      const res = await trpcQuery<{ data: { code: string; unitPrice: string }[] }>(
        page, "product.list", { page: 1, pageSize: 50, search: code },
      );
      const row = res.data.find(p => p.code === code);
      return row ? num(row.unitPrice) : null;
    });

    expect(price, "цена сохранилась не той, что вводили").toBe(1234.5);
  });
});

/** Дождаться, пока значение появится: сохранение асинхронное. */
async function expectEventually<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < until) {
    last = await read();
    if (last !== null) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("значение так и не появилось на сервере");
}

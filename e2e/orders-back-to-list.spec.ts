import { test, expect } from "@playwright/test";
import { login, trpcQuery, trpcMutate, num } from "./harness";

/**
 * «Назад» из карточки заказа — в тот же список, в настоящем браузере.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * С 18.09.2026 строка «Заказов» открывает карточку на всю страницу, а «Назад»
 * в ней вёл на голый /orders: поиск, сортировка, вкладка, страница —
 * сбрасывались после каждой карточки.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящая история браузера: список, открытый ссылкой с поиском и
 * сортировкой, → щелчок по строке → карточка → «Назад» → тот же адрес, в
 * поле поиска та же строка, заказ на месте. По частям это проверено в
 * src/__tests__/orders-workplace-url.test.tsx (MemoryRouter); здесь — что
 * так же ведёт себя браузер.
 *
 * Нарочная поломка: верни «Назад» в карточке к navigate("/orders") —
 * адрес вернётся без поиска и сортировки.
 */

type StockRow = { productId: number; available: string };
type Shop = { id: number };

test("«Назад» из карточки возвращает список с тем же поиском и сортировкой", async ({ browser }) => {
  // Заказ, который будем искать, — отдельным входом, как в orders-live.
  const field = await browser.newContext();
  const ceo = await field.newPage();
  await login(ceo, "ceo");
  const stock = await trpcQuery<{ data: StockRow[] }>(ceo, "warehouse.list", { page: 1, pageSize: 1000 });
  const product = stock.data.find(r => num(r.available) >= 1);
  const shops = await trpcQuery<{ data: Shop[] }>(ceo, "shop.list", { page: 1, pageSize: 5 });
  expect(product, "в засеве нет товара с остатком").toBeTruthy();
  expect(shops.data[0], "в засеве нет магазина").toBeTruthy();
  const created = await trpcMutate<{ id: number; orderNumber: string }>(ceo, "order.create", {
    shopId: shops.data[0].id, items: [{ productId: product!.productId, quantity: "1" }],
  });
  await field.close();

  const office = await browser.newContext();
  const operator = await office.newPage();
  await login(operator, "operator");
  const list = `/orders?search=${encodeURIComponent(created.orderNumber)}&sort=total&dir=asc&size=50`;
  await operator.goto(list);
  const search = operator.getByPlaceholder(/Поиск заказов/);
  await expect(search).toHaveValue(created.orderNumber);

  await operator.getByText(created.orderNumber, { exact: true }).click();
  await operator.waitForURL(url => new URL(url).pathname === `/orders/${created.id}`);

  await operator.getByRole("button", { name: "Назад" }).click();
  await operator.waitForURL(url => new URL(url).pathname === "/orders");
  const back = new URL(operator.url()).searchParams;
  expect(back.get("search")).toBe(created.orderNumber);
  expect(back.get("sort")).toBe("total");
  expect(back.get("dir")).toBe("asc");
  expect(back.get("size")).toBe("50");
  await expect(search).toHaveValue(created.orderNumber);
  await expect(operator.getByText(created.orderNumber, { exact: true })).toBeVisible();

  await office.close();
});

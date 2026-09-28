import { test, expect } from "@playwright/test";
import { login, trpcQuery, trpcMutate, num } from "./harness";

/**
 * «Заказы» обновляются сами: заказ, оформленный в другом месте, появляется
 * у оператора без перезагрузки — и один поток событий на вкладку.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран слушал события заказа, которых сервер не слал ни из одного места;
 * обновление при возврате на вкладку выключено, опроса у «Заказов» нет.
 * Оператор сидел на экране весь день и не видел нового заказа агента, пока
 * не щёлкнет по странице. А каждая вкладка открывала ДВА потока /api/events
 * (провайдер и колокольчик) при потолке сервера десять на человека.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Вся цепочка на настоящем сервере: запись заказа → событие после коммита →
 * поток → экран перечитывает → строка в таблице. Проверить её по частям
 * можно (юнит и real-db), а целиком — только так.
 *
 * Нарочная поломка: убери рассылку из invalidateReports (api/lib/report-cache.ts)
 * — заказ на экране не появится; верни колокольчику свой EventSource — потоков
 * станет два.
 */

type StockRow = { productId: number; available: string };
type Shop = { id: number };

test("заказ из другой вкладки появляется в «Заказах» без перезагрузки; поток один", async ({ browser }) => {
  const office = await browser.newContext();
  const operator = await office.newPage();
  // Считаем потоки событий, которые открывает вкладка.
  let streams = 0;
  operator.on("request", r => { if (new URL(r.url()).pathname === "/api/events") streams++; });

  await login(operator, "operator");
  await operator.goto("/orders");
  await expect(operator.getByRole("button", { name: "Активные" })).toBeVisible();

  // Заказ оформляют в другом месте — отдельный вход, отдельный браузер.
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

  // Ни перезагрузки, ни щелчка: строка приходит сама.
  await expect(operator.getByText(created.orderNumber, { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(streams, "вкладка открыла больше одного потока /api/events").toBe(1);

  await field.close();
  await office.close();
});

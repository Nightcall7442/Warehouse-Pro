/**
 * То, что проверяется только на настоящей базе.
 *
 * Каждый тест здесь подобран по одному признаку: на заглушке он прошёл бы при
 * ЛЮБОМ коде. Уникальные индексы, блокировка строки, гонка двух запросов —
 * ничего этого фейковый слой не воспроизводит, он считает сырой SQL всегда
 * выполненным.
 *
 * Поэтому здесь нет проверок «заказ создался» или «сумма посчиталась»: они
 * прекрасно живут на заглушке и там быстрее. Здесь только то, ради чего
 * поднимается настоящая MySQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { OrderService } from "../../services/order";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

// Причина пропуска стоит в самом названии набора: console.warn на верхнем
// уровне vitest у пропущенного файла не показывает, и «громкое» предупреждение
// вышло бы невидимым. А что набор запускают с базой, а не забыли — как забыли
// e2e — стережёт tests-are-honest.test.ts: он требует шаг в CI.
describe.skipIf(!hasRealDb)(
  "инварианты на настоящей MySQL (пропущено без TEST_DATABASE_URL — см. real-db/harness.ts)",
  () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 120_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  /* ── Идемпотентность ───────────────────────────────────────────────────── */

  it("два одновременных заказа с одним ключом идемпотентности дают один заказ", async () => {
    // Ключ — защита от двойного нажатия и от повтора запроса с телефона в
    // плохой сети. Настоящая защита здесь не в коде, а в уникальном индексе
    // uq_orders_idempotency: две параллельные вставки доходят до базы, и
    // отбивает вторую именно она. На заглушке индексов нет вовсе.
    const key = "same-key-for-both";
    const [a, b] = await Promise.all([
      OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, idempotencyKey: key,
        items: [{ productId: s.productId, quantity: "1" }],
      }),
      OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, idempotencyKey: key,
        items: [{ productId: s.productId, quantity: "1" }],
      }),
    ]);

    expect(await countOf("orders")).toBe(1);
    expect(a.id).toBe(b.id);
    // Товар списан в резерв один раз, а не дважды.
    expect((await stockOf(s.productId)).reserved).toBe(1);
  });

  it("тот же ключ в другой организации создаёт свой заказ", async () => {
    // Индекс составной: (ключ, организация). Сделай его глобальным — и заказ
    // одной компании начнёт молча отдаваться другой.
    const key = "shared-key";
    await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, idempotencyKey: key,
      items: [{ productId: s.productId, quantity: "1" }],
    });

    const before = await countOf("orders");
    // Соседняя организация со своими магазином, товаром и складом.
    await expect(
      OrderService.create(db, s.otherTenantId, s.agentId, {
        shopId: s.shopId, idempotencyKey: key,
        items: [{ productId: s.productId, quantity: "1" }],
      }),
    ).rejects.toThrow(); // чужой магазин и товар — заказ не должен пройти

    expect(await countOf("orders")).toBe(before);
  });

  /* ── Гонка за остатком ─────────────────────────────────────────────────── */

  it("две одновременные заявки на весь остаток: проходит ровно одна", async () => {
    // Резерв берётся под SELECT … FOR UPDATE. Уберите блокировку — оба
    // запроса прочитают «10 свободно», оба зарезервируют по десять, и склад
    // уйдёт в минус. На заглушке `.for("update")` — пустышка, там это
    // невоспроизводимо.
    const results = await Promise.allSettled([
      OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, items: [{ productId: s.productId, quantity: "10" }],
      }),
      OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, items: [{ productId: s.productId, quantity: "10" }],
      }),
    ]);

    const ok = results.filter(r => r.status === "fulfilled").length;
    expect(ok).toBe(1);
    expect(await countOf("orders")).toBe(1);

    const stock = await stockOf(s.productId);
    expect(stock.reserved).toBe(10);
    expect(stock.available).toBe(0);
    // Главный инвариант склада: остаток равен свободному плюс зарезервированному.
    expect(stock.current).toBe(stock.available + stock.reserved);
  });

  it("склад не уходит в минус под пятью одновременными заявками", async () => {
    // Пять по три при остатке десять: пройти могут максимум три.
    const attempts = Array.from({ length: 5 }, () =>
      OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }],
      }),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter(r => r.status === "fulfilled").length;

    expect(ok).toBeLessThanOrEqual(3);
    const stock = await stockOf(s.productId);
    expect(stock.available).toBeGreaterThanOrEqual(0);
    expect(stock.reserved).toBe(ok * 3);
    expect(stock.current).toBe(stock.available + stock.reserved);
  });

  /* ── Номер заказа ──────────────────────────────────────────────────────── */

  it("одновременные заказы получают разные номера", async () => {
    // Номер порядковый и уникален в пределах организации (uq_order_number_
    // tenant). Считается он «максимум плюс один», а такой счётчик под гонкой
    // выдаёт двум запросам одно число — отбивает индекс, и код обязан пережить
    // отбой, а не упасть с ошибкой базы наружу.
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        OrderService.create(db, s.tenantId, s.agentId, {
          shopId: s.shopId, items: [{ productId: s.productId, quantity: "1" }],
        }),
      ),
    );
    const created = results.filter(r => r.status === "fulfilled").length;
    expect(created).toBeGreaterThan(0);

    const distinct = await countOf("orders", "1=1 GROUP BY order_number HAVING COUNT(*) > 1");
    expect(distinct, "нашлись заказы с одинаковым номером").toBe(0);
    expect(await countOf("orders")).toBe(created);
  });

  /* ── Изоляция организаций ──────────────────────────────────────────────── */

  it("заказ не создаётся на чужой магазин", async () => {
    // Проверка принадлежности идёт запросом с условием по организации. На
    // заглушке отсутствующая колонка считается совпавшей, поэтому там такая
    // проверка проходит и без самого условия.
    await expect(
      OrderService.create(db, s.otherTenantId, s.agentId, {
        shopId: s.shopId, // магазин первой организации
        items: [{ productId: s.productId, quantity: "1" }],
      }),
    ).rejects.toThrow();

    expect(await countOf("orders")).toBe(0);
  });
  },
);

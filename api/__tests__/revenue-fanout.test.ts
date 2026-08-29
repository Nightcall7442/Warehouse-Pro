import { describe, it, expect } from "vitest";
import { hasSqlite } from "./sqlite-engine";

/**
 * Завышение выручки размножением строк при джойне — арифметика, а не особенность
 * MySQL, поэтому проверяется на движке-двойнике: node:sqlite считает JOIN и
 * GROUP BY по тем же правилам ANSI.
 *
 * Проверяются ровно те формы запросов, которые стояли в продукте:
 *   reports.getAgentPerformance  — SUM(orders.total) поверх джойна daily_plans
 *   analytics.agentEfficiency    — то же, причём без фильтра статуса визита
 *   analytics.pnl (ряд/способы)  — SUM(orders.total) поверх джойна order_items
 *
 * Тест сравнивает «как было» и «как стало» на одних и тех же данных. Проверка
 * только нового запроса была бы слабее: она не показала бы, что старая форма
 * действительно врала, и молча зеленела бы, если бы кто-то вернул джойн назад.
 */

type Row = Record<string, unknown>;

async function withDb(fn: (run: (sql: string) => Row[]) => void) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const run = (sql: string) => db.prepare(sql).all() as Row[];

  db.exec(`
    CREATE TABLE orders (id INTEGER PRIMARY KEY, agent_id INT, total REAL, payment_method TEXT, deleted_at TEXT);
    CREATE TABLE daily_plans (id INTEGER PRIMARY KEY, agent_id INT, status TEXT);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INT, qty REAL, cost REAL);
  `);
  try { fn(run); } finally { db.close(); }
}

// node:sqlite есть с Node 22.5; на Node 20 набор пропускается громко —
// см. sqlite-engine.ts.
describe.skipIf(!hasSqlite)("выручка не завышается размножением строк при джойне", () => {
  it("отчёт по агентам: визиты не умножают деньги", async () => {
    await withDb(run => {
      // Агент с 22 отмеченными визитами и 5 заказами — случай из разбора.
      const visits = Array.from({ length: 22 }, (_, i) => `(${i + 1}, 7, 'visited')`).join(",");
      const orders = [2_500_000, 3_000_000, 1_721_250, 4_000_000, 2_000_000]
        .map((t, i) => `(${i + 1}, 7, ${t}, 'cash', NULL)`).join(",");
      run(`INSERT INTO daily_plans VALUES ${visits}`);
      run(`INSERT INTO orders VALUES ${orders}`);

      const real = 13_221_250;

      // Как было: одним запросом с джойном.
      const [before] = run(`
        SELECT COALESCE(SUM(o.total), 0) AS revenue,
               COUNT(DISTINCT dp.id) AS visits,
               COUNT(DISTINCT o.id)  AS orders
        FROM (SELECT 7 AS id) u
        LEFT JOIN daily_plans dp ON dp.agent_id = u.id AND dp.status = 'visited'
        LEFT JOIN orders o ON o.agent_id = u.id
      `);
      expect(Number(before.revenue)).toBe(real * 22);   // ровно в 22 раза
      expect(Number(before.visits)).toBe(22);           // счётчики при этом верны
      expect(Number(before.orders)).toBe(5);

      // Как стало: деньги отдельным запросом.
      const [after] = run(`SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
                           FROM orders WHERE agent_id = 7 AND deleted_at IS NULL`);
      expect(Number(after.revenue)).toBe(real);
      expect(Number(after.orders)).toBe(5);
    });
  });

  it("эффективность агентов: множителем были ВСЕ планы, а не только состоявшиеся визиты", async () => {
    await withDb(run => {
      // Здесь джойн шёл без фильтра статуса — считались и незакрытые планы.
      const plans = Array.from({ length: 30 }, (_, i) =>
        `(${i + 1}, 7, '${i < 4 ? "visited" : "planned"}')`).join(",");
      run(`INSERT INTO daily_plans VALUES ${plans}`);
      run(`INSERT INTO orders VALUES (1, 7, 1000000, 'cash', NULL)`);

      const [before] = run(`
        SELECT COALESCE(SUM(o.total), 0) AS revenue, COALESCE(AVG(o.total), 0) AS avg
        FROM (SELECT 7 AS id) u
        LEFT JOIN daily_plans dp ON dp.agent_id = u.id
        LEFT JOIN orders o ON o.agent_id = u.id
      `);
      expect(Number(before.revenue)).toBe(30_000_000);  // 30 планов × 1 000 000
      // Среднее при этом остаётся верным — поэтому ошибку и не замечали:
      // две соседние колонки, одна врёт, другая нет.
      expect(Number(before.avg)).toBe(1_000_000);

      const [after] = run(`SELECT COALESCE(SUM(total), 0) AS revenue FROM orders WHERE agent_id = 7`);
      expect(Number(after.revenue)).toBe(1_000_000);
    });
  });

  it("P&L: позиции заказа не умножают ни выручку, ни счётчик заказов", async () => {
    await withDb(run => {
      run(`INSERT INTO orders VALUES (1, 7, 1250000, 'cash', NULL), (2, 7, 3400500, 'cash', NULL), (3, 7, 870000, 'debt', NULL)`);
      // Корзины разного размера: 4, 7 и 1 позиция.
      const items: string[] = [];
      let id = 1;
      for (const [orderId, count] of [[1, 4], [2, 7], [3, 1]] as const) {
        for (let i = 0; i < count; i++) items.push(`(${id++}, ${orderId}, 1, 100)`);
      }
      run(`INSERT INTO order_items VALUES ${items.join(",")}`);

      const [before] = run(`
        SELECT COALESCE(SUM(o.total), 0) AS revenue, COUNT(*) AS orders
        FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
      `);
      expect(Number(before.revenue)).toBe(1250000 * 4 + 3400500 * 7 + 870000);
      expect(Number(before.orders)).toBe(12);           // 12 «заказов» вместо 3

      const [after] = run(`SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
                           FROM orders WHERE deleted_at IS NULL`);
      expect(Number(after.revenue)).toBe(5_520_500);
      expect(Number(after.orders)).toBe(3);
    });
  });

  it("мягко удалённый заказ не попадает в выручку", async () => {
    await withDb(run => {
      run(`INSERT INTO orders VALUES (1, 7, 4650500, 'cash', NULL), (2, 7, 9000000, 'cash', '2026-08-06')`);

      const [unfiltered] = run(`SELECT COALESCE(SUM(total), 0) AS revenue FROM orders`);
      expect(Number(unfiltered.revenue)).toBe(13_650_500);   // как считалось раньше

      const [filtered] = run(`SELECT COALESCE(SUM(total), 0) AS revenue FROM orders WHERE deleted_at IS NULL`);
      expect(Number(filtered.revenue)).toBe(4_650_500);
    });
  });
});

/**
 * Сторож на будущее: разбор показал, что опасна не арифметика, а сочетание —
 * SUM денежной колонки в одном запросе с присоединением таблицы, у которой на
 * заказ приходится много строк. Форму легко вернуть по невнимательности, а
 * заметить потом почти нельзя: цифра выглядит правдоподобно и растёт вместе с
 * бизнесом.
 */
describe("денежные суммы не считаются поверх размножающего джойна", () => {
  const MULTIPLYING = ["dailyPlans", "orderItems", "daily_plans", "order_items"];

  it("в аналитике и отчётах нет SUM(orders.total) в запросе с таким джойном", async () => {
    const { readFile } = await import("node:fs/promises");

    for (const file of ["api/analytics-router.ts", "api/reports-router.ts"]) {
      const src = await readFile(file, "utf-8");

      // Запрос — от .select( до закрывающего его ; — грубо, но достаточно:
      // важно лишь, встречаются ли SUM(orders.total) и leftJoin размножающей
      // таблицы в пределах ОДНОГО обращения к базе.
      for (const chunk of src.split(/\.select\(/).slice(1)) {
        const query = chunk.split(/;\s*\n/)[0];
        const sumsMoney = /SUM\(\$\{orders\.total\}\)/.test(query);
        if (!sumsMoney) continue;

        // Простой поиск подстроки, а не собранное регулярное выражение:
        // экранирование в шаблонной строке уже съедалось молча и превращало
        // проверку в мусор, который «находил» несуществующее.
        const joinsMultiplying = MULTIPLYING.some(t =>
          query.includes(`leftJoin(${t}`) || query.includes(`innerJoin(${t}`));

        expect(joinsMultiplying, `${file}: SUM(orders.total) вместе с размножающим джойном — выручка будет завышена`).toBe(false);
      }
    }
  });
});

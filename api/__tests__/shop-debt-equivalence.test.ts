import { describe, it, expect } from "vitest";
import { hasSqlite } from "./sqlite-engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Долг магазина считается одним запросом, и в нём заменена только форма записи
 * «сколько уже заплачено по заказу»: вместо LEFT JOIN на подзапрос, который
 * группировал платежи всех заказов всех организаций разом, теперь читаются
 * платежи одного заказа по индексу.
 *
 * Замена сделана ради скорости, а не смысла, поэтому проверяется именно
 * равенство: обе формы прогоняются на одних и тех же случайных наборах данных
 * и обязаны давать одно и то же число. Тест на «правильный ответ» такого не
 * поймал бы — ошибка здесь выглядела бы как расхождение с прежним поведением
 * на данных, которые никто не догадался внести руками.
 *
 * Считает MySQL, поэтому запрос прогоняется на движке-двойнике (node:sqlite).
 * GREATEST и DECIMAL заменены на MAX и REAL одинаково в обеих формах, так что
 * сравнение остаётся честным: различается ровно то, что менялось.
 */

type Row = Record<string, unknown>;

/** Прежняя форма: агрегат по всем платежам сразу, потом отбрасывание лишнего. */
const OLD_SHAPE = `
  SELECT COALESCE((
    SELECT SUM(
      CASE
        WHEN o.status IN ('cancelled', 'returned') THEN 0
        WHEN o.payment_method = 'debt' OR o.status = 'delivered'
          THEN MAX(0, CAST(o.total AS REAL) - COALESCE(op.paid, 0))
        ELSE 0
      END
    )
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(CAST(amount AS REAL)) AS paid
      FROM payments
      WHERE type = 'payment' AND order_id IS NOT NULL
      GROUP BY order_id
    ) op ON op.order_id = o.id
    WHERE o.shop_id = :shop AND o.tenant_id = :tenant AND o.deleted_at IS NULL
  ), 0) AS v
`;

/** Нынешняя форма: платежи одного заказа. */
const NEW_SHAPE = `
  SELECT COALESCE((
    SELECT SUM(
      CASE
        WHEN o.status IN ('cancelled', 'returned') THEN 0
        WHEN o.payment_method = 'debt' OR o.status = 'delivered'
          THEN MAX(0, CAST(o.total AS REAL) - COALESCE((
            SELECT SUM(CAST(p.amount AS REAL)) FROM payments p
            WHERE p.order_id = o.id AND p.type = 'payment'
          ), 0))
        ELSE 0
      END
    )
    FROM orders o
    WHERE o.shop_id = :shop AND o.tenant_id = :tenant AND o.deleted_at IS NULL
  ), 0) AS v
`;

/** Свой генератор вместо Math.random: расхождение должно воспроизводиться. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const STATUSES = ["new", "processing", "delivered", "cancelled", "returned", "shipped"];
const METHODS = ["cash", "card", "debt", "transfer"];

async function runCase(seed: number) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const rnd = makeRandom(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, tenant_id INT, shop_id INT,
    total TEXT, status TEXT, payment_method TEXT, deleted_at TEXT)`);
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY, tenant_id INT, shop_id INT,
    order_id INT, amount TEXT, type TEXT)`);

  let orderId = 0, paymentId = 0;
  // Несколько организаций и магазинов сразу: прежняя форма собирала платежи по
  // всей таблице, поэтому чужие строки — главный подозреваемый на расхождение.
  for (let tenant = 1; tenant <= 3; tenant++) {
    for (let shop = 1; shop <= 3; shop++) {
      const orders = Math.floor(rnd() * 6);
      for (let k = 0; k < orders; k++) {
        const id = ++orderId;
        db.prepare(`INSERT INTO orders VALUES (?,?,?,?,?,?,?)`).run(
          id, tenant, shop, (Math.floor(rnd() * 1000) * 100).toFixed(2),
          pick(STATUSES), pick(METHODS), rnd() < 0.2 ? "2026-01-01" : null);

        // От нуля до трёх оплат по заказу: частичные оплаты — обычное дело,
        // а два платежа на один заказ прежняя форма складывала в GROUP BY.
        const pays = Math.floor(rnd() * 4);
        for (let m = 0; m < pays; m++) {
          db.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?)`).run(
            ++paymentId, tenant, shop, id,
            (Math.floor(rnd() * 500) * 100).toFixed(2),
            rnd() < 0.8 ? "payment" : "debt");
        }
      }
      // Платежи без заказа — они в эту часть формулы попадать не должны ни в
      // одной из форм.
      if (rnd() < 0.5) {
        db.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?)`).run(
          ++paymentId, tenant, shop, null,
          (Math.floor(rnd() * 500) * 100).toFixed(2), rnd() < 0.5 ? "payment" : "debt");
      }
    }
  }

  const results: Array<{ tenant: number; shop: number; oldV: unknown; newV: unknown }> = [];
  for (let tenant = 1; tenant <= 3; tenant++) {
    for (let shop = 1; shop <= 3; shop++) {
      const args = { shop, tenant };
      const oldV = (db.prepare(OLD_SHAPE).get(args) as Row).v;
      const newV = (db.prepare(NEW_SHAPE).get(args) as Row).v;
      results.push({ tenant, shop, oldV, newV });
    }
  }
  db.close();
  return results;
}

// node:sqlite есть с Node 22.5; на Node 20 набор пропускается громко —
// см. sqlite-engine.ts.
describe.skipIf(!hasSqlite)("пересчёт долга: новая форма считает то же, что и прежняя", () => {
  it("совпадает на 200 случайных наборах данных", async () => {
    let compared = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const r of await runCase(seed)) {
        expect(r.newV, `набор ${seed}, организация ${r.tenant}, магазин ${r.shop}`).toBe(r.oldV);
        compared++;
      }
    }
    // Страховка от «зелёного ни на чём»: если генератор данных сломается и
    // выдаст пустые наборы, сравнивать будет нечего, а тест всё равно пройдёт.
    expect(compared).toBe(200 * 9);
  });

  it("совпадает и на заказе, оплаченном дважды сверх суммы", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, tenant_id INT, shop_id INT,
      total TEXT, status TEXT, payment_method TEXT, deleted_at TEXT)`);
    db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY, tenant_id INT, shop_id INT,
      order_id INT, amount TEXT, type TEXT)`);
    db.exec(`INSERT INTO orders VALUES (1,1,1,'1000.00','delivered','cash',NULL)`);
    db.exec(`INSERT INTO payments VALUES (1,1,1,1,'700.00','payment'),(2,1,1,1,'700.00','payment')`);

    const args = { shop: 1, tenant: 1 };
    const oldV = (db.prepare(OLD_SHAPE).get(args) as Row).v;
    const newV = (db.prepare(NEW_SHAPE).get(args) as Row).v;
    // Переплата не делает долг отрицательным ни в одной из форм.
    expect(newV).toBe(oldV);
    expect(newV).toBe(0);
    db.close();
  });
});

describe("форма запроса в продукте", () => {
  it("общий агрегат по всем платежам не вернулся", () => {
    const src = readFileSync(join(process.cwd(), "api", "services", "shop-debt.ts"), "utf8");
    // Признак прежней формы — группировка платежей по order_id без всякой
    // привязки к магазину: именно она перемалывала таблицу целиком.
    expect(src, "долг снова считается через агрегат по всей таблице платежей")
      .not.toMatch(/GROUP BY\s+order_id/i);
    expect(src).toMatch(/WHERE p\.order_id = o\.id AND p\.type = 'payment'/);
  });
});

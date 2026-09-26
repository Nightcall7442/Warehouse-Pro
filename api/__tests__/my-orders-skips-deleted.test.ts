import { describe, it, expect } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { myOrders } from "../services/order-read";
import type { Db } from "../services/order-shared";

/**
 * «Мои заказы» агента не показывают удалённые офисом заказы.
 *
 * Удаление мягкое: ставится deleted_at, статус остаётся «new». У order.myOrders
 * отсечения не было, и удалённый дубль висел на «Моём дне» живым «Новым» с
 * суммой, хотя выручка над ним (agentDashboard) его уже не считала, а при
 * нажатии карточка отвечала «не найден».
 *
 * Проверка поведенческая: myOrders зовётся на поддельной базе, условия обоих
 * запросов (строки и счётчик) переводятся настоящим диалектом MySQL в SQL.
 *
 * Нарочная поломка: убери isNull(orders.deletedAt) из conditions в myOrders.
 */

function fakeDb() {
  const wheres: SQL[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "leftJoin", "orderBy", "limit"]) chain[m] = () => chain;
  chain.where = (w: SQL) => { wheres.push(w); return chain; };
  chain.then = (ok: (rows: unknown[]) => unknown) => Promise.resolve([]).then(ok);
  return { db: chain as unknown as Db, wheres };
}

const dialect = new MySqlDialect();

describe("order.myOrders — без удалённых", () => {
  it("и строки, и счётчик отсекают deleted_at", async () => {
    const { db, wheres } = fakeDb();
    const res = await myOrders(db, 7, 42);
    expect(res).toEqual({ data: [], total: 0 });
    expect(wheres).toHaveLength(2);
    for (const w of wheres) {
      const { sql, params } = dialect.sqlToQuery(w);
      expect(sql).toContain("`orders`.`deleted_at` is null");
      // И прежние условия на месте: своя организация, свой агент.
      expect(sql).toContain("`orders`.`tenant_id` = ?");
      expect(sql).toContain("`orders`.`agent_id` = ?");
      expect(params).toEqual([7, 42]);
    }
  });
});

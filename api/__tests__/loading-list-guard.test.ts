/**
 * Один заказ не собирают со склада дважды.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * createLoadingList принимал список идентификаторов как есть, без единой
 * проверки — и покрытия у него не было тоже. Отсюда три беды, и все три видны
 * только на складе, обычно при пересчёте остатков через пару недель.
 *
 * 1. Удалённый заказ попадал в лист. Удаление — штатный способ исправить
 *    ошибку ввода: заказ исчезает из списка и из долга магазина, а кладовщик
 *    по листу собирал товар, которого никто не ждёт.
 *
 * 2. Закрытый заказ попадал в лист. Товар по нему уже уехал, отменён или
 *    вернулся — собирать нечего.
 *
 * 3. Заказ попадал во ВТОРОЙ лист, оставаясь в первом. Так выходит после
 *    возврата заказа из архива в работу: первый лист ещё не закрыт, заказ в
 *    нём есть, и новый лист велит собрать то же самое ещё раз.
 *
 * ── Почему отказ, а не тихий пропуск ────────────────────────────────────────
 *
 * Оператор выбрал эти заказы осознанно. Молча собрать не все — значит
 * отправить машину с недогрузом и ничего об этом не сказать; расхождение
 * найдётся у магазина, а не на складе.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/cache", () => ({
  cache: { invalidate: vi.fn(), get: vi.fn(), set: vi.fn() },
  CacheKeys: { dashboardKpis: (id: number) => `kpi:${id}` },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { orders, loadingLists, loadingListOrders } from "@db/schema";
import { LoadingListService } from "../services/loading-list";

interface FakeOrder {
  id: number; tenantId: number; orderNumber: string; status: string;
  deletedAt: Date | null; shopId: number; agentId: number; total: string;
  paymentMethod: string;
}
interface FakeList { id: number; tenantId: number; listNumber: string; status: string }
interface FakeListOrder { listId: number; orderId: number }

let ordersTable: FakeOrder[] = [];
let listsTable: FakeList[] = [];
let listOrdersTable: FakeListOrder[] = [];

const order = (over: Partial<FakeOrder> = {}): FakeOrder => ({
  id: 1, tenantId: 1, orderNumber: "№1", status: "new", deletedAt: null,
  shopId: 5, agentId: 9, total: "1000.00", paymentMethod: "cash", ...over,
});

/**
 * Заглушка построителя: она отвечает ровно на те три запроса, которые делает
 * createLoadingList до вставки, — заказы, состав листов и позиции.
 *
 * Условия не разбираются, а различаются по таблице: разбирать `and`/`inArray`
 * здесь значило бы написать вторую MySQL. Отбор по организации и по списку
 * идентификаторов делается прямо в ответах — так видно, что именно стенд
 * считает истиной.
 */
function makeDb(requested: number[], tenantId: number) {
  const selects: Array<() => unknown[]> = [];
  return {
    calls: selects,
    db: {
      select: () => {
        let table: unknown = null;
        const api = {
          from(ref: unknown) { table = ref; return api; },
          leftJoin() { return api; },
          innerJoin() { return api; },
          where() {
            let rows: unknown[] = [];
            if (table === orders) {
              rows = ordersTable.filter(o =>
                o.tenantId === tenantId && requested.includes(o.id) && o.deletedAt === null);
            } else if (table === loadingListOrders) {
              rows = listOrdersTable
                .filter(lo => requested.includes(lo.orderId))
                .map(lo => {
                  const list = listsTable.find(l => l.id === lo.listId)!;
                  return { orderId: lo.orderId, listNumber: list.listNumber, status: list.status, tenantId: list.tenantId };
                })
                .filter(r => (r as { tenantId: number }).tenantId === tenantId);
            }
            // Часть запросов службы досчитывается через groupBy, часть ждёт
            // ответа сразу — цепочка должна уметь и то, и другое.
            return Object.assign(Promise.resolve(rows), {
              groupBy: () => Promise.resolve(rows),
            });
          },
        };
        return api;
      },
      insert: (ref: unknown) => ({
        values: (vals: unknown) => {
          if (ref === loadingLists) {
            const v = vals as Record<string, unknown>;
            listsTable.push({
              id: 100, tenantId: v.tenantId as number,
              listNumber: v.listNumber as string, status: "preparing",
            });
            return Promise.resolve([{ insertId: 100 }]);
          }
          if (ref === loadingListOrders) {
            for (const v of vals as FakeListOrder[]) listOrdersTable.push(v);
            return Promise.resolve([{ insertId: 1 }]);
          }
          return Promise.resolve([{ insertId: 1 }]);
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
    },
  };
}

const create = (ids: number[], tenantId = 1) =>
  LoadingListService.createLoadingList(
    makeDb(ids, tenantId).db as never, tenantId, 1,
    { orderIds: ids, format: "aggregated" as const },
  );

beforeEach(() => {
  ordersTable = [];
  listsTable = [];
  listOrdersTable = [];
});

describe("погрузочный лист отказывает вместо двойной сборки", () => {
  it("удалённый заказ в лист не попадает", async () => {
    ordersTable = [order({ id: 1 }), order({ id: 2, orderNumber: "№2", deletedAt: new Date() })];

    await expect(create([1, 2])).rejects.toThrow(/удалены заказы/i);
  });

  it("закрытый заказ в лист не попадает", async () => {
    ordersTable = [order({ id: 1 }), order({ id: 2, orderNumber: "№2", status: "delivered" })];

    await expect(create([1, 2])).rejects.toThrow(/уже закрыты/i);
  });

  it("отказ по закрытому называет заказ и его состояние словом", async () => {
    // Не «delivered» латиницей: словарь подписей лежит в lib/order-status.
    ordersTable = [order({ id: 2, orderNumber: "№77", status: "cancelled" })];

    const err = await create([2]).catch((e: Error) => e);
    expect(String(err)).toContain("№77");
    expect(String(err)).toContain("отменён");
  });

  it("заказ из незакрытого листа во второй не берётся", async () => {
    ordersTable = [order({ id: 1, orderNumber: "№5" })];
    listsTable = [{ id: 50, tenantId: 1, listNumber: "ZL-СТАРЫЙ", status: "loading" }];
    listOrdersTable = [{ listId: 50, orderId: 1 }];

    const err = await create([1]).catch((e: Error) => e);
    expect(String(err)).toMatch(/незакрытом погрузочном листе/i);
    expect(String(err), "не сказано, в каком именно листе искать").toContain("ZL-СТАРЫЙ");
  });

  it("после закрытия прежнего листа заказ собирают заново", async () => {
    /*
      Второй круг заказа — законный случай: товар по первому листу уехал, лист
      закрыт, заказ вернули в работу и везут снова. Запрет обязан отличать это
      от двойной сборки, иначе он запретил бы работу.
    */
    ordersTable = [order({ id: 1, orderNumber: "№5" })];
    listsTable = [{ id: 50, tenantId: 1, listNumber: "ZL-СТАРЫЙ", status: "delivered" }];
    listOrdersTable = [{ listId: 50, orderId: 1 }];

    const out = await create([1]);
    expect(out.totalOrders).toBe(1);
  });

  it("обычный заказ проходит", async () => {
    // Страховка от «зелёного ни на чём»: если бы отказ срабатывал всегда,
    // проверки выше проходили бы, ничего не значив.
    ordersTable = [order({ id: 1 }), order({ id: 2, orderNumber: "№2" })];

    const out = await create([1, 2]);
    expect(out.totalOrders).toBe(2);
    expect(out.listNumber).toMatch(/^ZL-/);
  });

  it("чужая организация своих заказов не отдаёт", async () => {
    ordersTable = [order({ id: 1, tenantId: 2 })];

    await expect(create([1], 1)).rejects.toThrow(/не найдены/i);
  });
});

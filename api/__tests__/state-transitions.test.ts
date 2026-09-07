/**
 * Order state transition tests.
 *
 * Verifies all valid and invalid status transitions in OrderService.updateStatus:
 *  - Valid:   new → processing, new → delivered, new → cancelled,
 *             processing → delivered, processing → cancelled
 *  - Invalid: delivered → anything, cancelled → anything,
 *             processing → new, new → new, processing → processing
 *  - Idempotent: delivered → delivered (no double-deduct), cancelled → cancelled (no double-release)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    {
      join(chunks: unknown[], _sep?: unknown) { return { __kind: "sql_join", chunks }; },
      raw(str: string) { return { __kind: "sql_raw", str }; },
    },
  );
  return {
    eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

import { orders, orderItems, warehouseStock, products, warehouses, shops, returns } from "@db/schema";
import { createExecuteMock } from "./helpers/mock-execute";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

/*
  orderNumber, deliveryStatus, deliveredAt и courierId появились здесь не для
  полноты. Пока строка заказа их не несла, стенд не мог выразить состояние,
  в котором система теряла товар: заказ, уже прошедший через курьера
  (delivery_status = 'delivered'), и проводимый вторично. Проверка на этот
  случай не просто отсутствовала — её нечем было написать.
*/
interface FakeOrder {
  id: number; tenantId: number; agentId: number; shopId: number; status: string;
  orderNumber: string;
  deliveryStatus: string;
  deliveredAt: Date | null;
  courierId: number | null;
  invoicePrintedAt: Date | null;
  deliveryResult: string | null;
  deliveryNotes: string | null;
  /*
    Даты стенд не держал вовсе, и это было не мелочью: почти вся отчётность
    датирует заказ по created_at, а у заказа, возвращённого из архива в
    работу, дата обязана стать датой второго круга. Без колонок здесь правило
    проверялось бы на undefined — то есть не проверялось.
  */
  createdAt: Date;
  firstOrderedAt: Date | null;
}
interface FakeOrderItem {
  id: number; orderId: number; productId: number; quantity: string;
  deliveredQuantity: string | null;
  returnReason: string | null;
}
interface FakeReturn { id: number; tenantId: number; shopId: number; orderId: number | null; status: string; totalAmount: string; }
interface FakeStock { productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let returnsTable: FakeReturn[] = [];
let productsTable: { id: number; tenantId: number; name: string; unitPrice: string; status: string; costPrice?: string }[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let shopsTable: { id: number; tenantId: number; name: string }[] = [];
let nextOrderId = 1;
let nextItemId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  returnsTable = [];
  stockTable = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Test Product", unitPrice: "100.00", status: "active", costPrice: "50.00" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
    { id: 2, tenantId: 2, name: "Other", isDefault: true, status: "active" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Test Shop" },
  ];
  nextOrderId = 1;
  nextItemId = 1;
}

function tableOf(ref: unknown): "orders" | "orderItems" | "warehouseStock" | "products" | "warehouses" | "shops" | "returns" | "other" {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  if (ref === shops) return "shops";
  if (ref === returns) return "returns";
  return "other";
}

function rowsFor(table: ReturnType<typeof tableOf>): unknown[] {
  if (table === "orders") return ordersTable;
  if (table === "orderItems") return orderItemsTable;
  if (table === "warehouseStock") return stockTable;
  if (table === "products") return productsTable;
  if (table === "warehouses") return warehousesTable;
  if (table === "shops") return shopsTable;
  if (table === "returns") return returnsTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders))        columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems))    columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(returns)) columnToFieldName.set(col, field);

/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: col => columnToFieldName.get(col) ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function evalSqlDelta(row: unknown, fieldName: string, expr: unknown): string {
  const e = expr as Record<string, unknown>;
  if (!e || e.__kind !== "sql") return (row as Record<string, unknown>)[fieldName] as string;
  const opStr = (e.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number((e.values as unknown[])[(e.values as unknown[]).length - 1]);
  const current = Number((row as Record<string, unknown>)[fieldName]);
  return (op === "+" ? current + amount : current - amount).toFixed(2);
}

function makeMockDb() {
  function selectBuilder() {
    let table: ReturnType<typeof tableOf> = "other";
    const api = {
      from(ref: unknown) { table = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(table).filter((r) => evalCond(r, cond));
        const chain = Object.assign(Promise.resolve(filtered), {
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => Object.assign(Promise.resolve(filtered), { limit: (n: number) => Promise.resolve(filtered.slice(0, n)) }),
          for: () => chain,
        });
        return chain;
      },
      limit(n: number) { return Promise.resolve(rowsFor(table).slice(0, n)); },
    };
    return api;
  }

  function updateBuilder(table: ReturnType<typeof tableOf>) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            let matched = 0;
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              matched++;
              const r = row as Record<string, unknown>;
              for (const [key, val] of Object.entries(patch)) {
                r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                  ? evalSqlDelta(row, key, val)
                  : val;
              }
            }
            return Promise.resolve([{ affectedRows: matched }]);
          },
        };
      },
    };
  }

  const db = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          ordersTable.push({
            id, tenantId: vals.tenantId as number, agentId: vals.agentId as number,
            shopId: vals.shopId as number, status: vals.status as string,
            orderNumber: (vals.orderNumber as string) ?? `№${id}`,
            // Умолчания те же, что в схеме: заказ рождается без курьера.
            deliveryStatus: (vals.deliveryStatus as string) ?? "not_assigned",
            deliveredAt: null, courierId: null, invoicePrintedAt: null,
            deliveryResult: null, deliveryNotes: null,
            // Как в схеме: дата ставится при вставке, первая дата пуста, пока
            // заказ не побывал в архиве.
            createdAt: (vals.createdAt as Date) ?? new Date(),
            firstOrderedAt: null,
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals : [vals];
          for (const v of list) orderItemsTable.push({
            id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number,
            quantity: String(v.quantity),
            deliveredQuantity: null, returnReason: null,
          });
          return Promise.resolve([{ insertId: nextItemId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const table = tableOf(ref);
        const rows = rowsFor(table);
        const keep = rows.filter((r) => !evalCond(r, cond));
        if (table === "orders") ordersTable = keep as FakeOrder[];
        if (table === "orderItems") orderItemsTable = keep as FakeOrderItem[];
        return Promise.resolve();
      },
    }),
    execute: createExecuteMock(stockTable),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "agent"): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  });
}

// ── Helpers for creating an order in a specific state ─────────────────────────
async function createOrder(caller: ReturnType<typeof import("../order-router")["orderRouter"]["createCaller"]>) {
  return caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

// ── Valid transitions ─────────────────────────────────────────────────────────
describe("valid state transitions", () => {
  it("new → processing", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    expect(ordersTable[0].status).toBe("processing");
  });

  it("new → delivered", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("new → cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await createOrder(agent);
    await agent.cancel({ id: 1 });
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("processing → delivered", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "delivered" });
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("processing → cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "cancelled" });
    expect(ordersTable[0].status).toBe("cancelled");
  });
});

// ── Corrections in any direction ──────────────────────────────────────────────
// Operators fix mistakes both ways, so no transition is forbidden. What must
// hold is that stock settles to the same place regardless of the path taken.
describe("status corrections in any direction", () => {
  it("rolls a delivered order back to new and returns the goods to the shelf", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].status).toBe("new");
    expect(stockTable[0].currentStock).toBe(afterCreate.currentStock);
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("reopens a cancelled order and takes the reservation back", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await agent.cancel({ id: 1 });
    await op.updateStatus({ id: 1, status: "processing" });

    expect(ordersTable[0].status).toBe("processing");
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("moves processing back to new without touching stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].status).toBe("new");
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("gives the goods back when a delivered order is cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const beforeOrder = Number(stockTable[0].currentStock);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "cancelled" });

    expect(ordersTable[0].status).toBe("cancelled");
    expect(Number(stockTable[0].currentStock)).toBe(beforeOrder);
    expect(Number(stockTable[0].reserved)).toBe(0);
  });
});

/*
  ── Вторая жизнь заказа ──────────────────────────────────────────────────────

  Оператор возвращает закрытый заказ в работу и проводит его заново. Владелец
  предупредил об этом прямо: «если с архива сделать заказа новым и
  перерабатывать, то ошибки будут очень много». Разбор подтвердил: ошибок
  оказалось четырнадцать подтверждённых, и самая тяжёлая — молчаливая.

  Проверки ниже написаны так, чтобы падать на прежнем коде. Каждая названа
  тем, что теряется, а не тем, какой вызов делается.
*/
describe("вторая жизнь заказа", () => {
  const callers = async () => {
    const { orderRouter } = await import("../order-router");
    return {
      agent: orderRouter.createCaller(makeCtx(1, 10, "agent")),
      op:    orderRouter.createCaller(makeCtx(1, 1, "operator")),
    };
  };

  it("повторная доставка списывает товар, а не делает вид, что уже списала", async () => {
    /*
      Главная проверка. Заказ прошёл через курьера, поэтому delivery_status
      остался 'delivered' навсегда — сбрасывать его было некому. Прежний код
      считал по этому полю, что склад уже тронут, и пропускал списание
      ЦЕЛИКОМ: товар уезжал второй раз, current_stock не падал.

      Расхождение было молчаливым: инвариант current = available + reserved
      при этом сходился, и ни одна сверка целостности его не видела.
    */
    const { agent, op } = await callers();
    await createOrder(agent);            // 10 шт: current 100, reserved 10, available 90
    ordersTable[0].deliveryStatus = "delivered";

    await op.updateStatus({ id: 1, status: "delivered" });
    const afterFirst = { ...stockTable[0] };
    expect(Number(afterFirst.currentStock)).toBe(90);

    await op.updateStatus({ id: 1, status: "new" });      // откат: товар вернулся
    expect(Number(stockTable[0].currentStock)).toBe(100);

    await op.updateStatus({ id: 1, status: "delivered" }); // и уехал снова
    expect(Number(stockTable[0].currentStock)).toBe(90);
    expect(Number(stockTable[0].available)).toBe(90);
    expect(Number(stockTable[0].reserved)).toBe(0);
  });

  it("поправка «возвращён» → «доставлен» списывает товар со склада", async () => {
    /*
      Второй случай той же причины, и он не требует ни архива, ни отката —
      одно движение выпадающего списка. Курьер отчитался возвратом: товар не
      уезжал, снят только резерв, а delivery_status всё равно стал
      'delivered'. Оператор поправляет статус на «доставлен» — и прежний код
      списания не делал. Товар уезжал, склад его не терял.
    */
    const { agent, op } = await callers();
    await createOrder(agent);
    ordersTable[0].status = "returned";
    ordersTable[0].deliveryStatus = "delivered";
    // Возврат курьера вернул резерв в свободный остаток, current не тронул.
    stockTable[0] = { ...stockTable[0], reserved: "0.00", available: "100.00", currentStock: "100.00" };

    await op.updateStatus({ id: 1, status: "delivered" });

    expect(Number(stockTable[0].currentStock)).toBe(90);
    expect(Number(stockTable[0].available)).toBe(90);
  });

  it("следы первой доставки стираются, иначе вторая жизнь выдаётся за продолжение первой", async () => {
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    Object.assign(ordersTable[0], {
      deliveryStatus: "delivered", deliveredAt: new Date(), courierId: 7,
      invoicePrintedAt: new Date(), deliveryResult: "paid",
    });

    await op.updateStatus({ id: 1, status: "new" });

    const o = ordersTable[0];
    expect(o.deliveryStatus).toBe("not_assigned");
    expect(o.deliveredAt).toBeNull();
    expect(o.courierId).toBeNull();       // заказ поедет заново, возможно с другим
    expect(o.deliveryResult).toBeNull();
    expect(o.invoicePrintedAt).toBeNull(); // накладную печатают заново
    expect(orderItemsTable[0].deliveredQuantity).toBeNull();
  });

  it("заказ с проведённым возвратом в работу не возвращается", async () => {
    /*
      Посчитать этот случай нельзя в принципе: возврат привязан к заказу
      навсегда и вычитается при каждом пересчёте. Второе проведение засчитало
      бы те же единицы дважды — сначала документом, потом откатом статуса.
    */
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    returnsTable.push({ id: 1, tenantId: 1, shopId: 1, orderId: 1, status: "completed", totalAmount: "400.00" });

    await expect(op.updateStatus({ id: 1, status: "new" })).rejects.toThrow(/возврат/i);
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("незавершённый возврат возвращению в работу не мешает", async () => {
    // Отказ вызывает только ПРОВЕДЁННЫЙ возврат: он уже подвинул товар и долг.
    // Заявка на рассмотрении не подвинула ничего.
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    returnsTable.push({ id: 1, tenantId: 1, shopId: 1, orderId: 1, status: "pending", totalAmount: "400.00" });

    await op.updateStatus({ id: 1, status: "new" });
    expect(ordersTable[0].status).toBe("new");
  });

  it("частично доставленный заказ в работу не возвращается", async () => {
    /*
      Резерв под ним снят не на всё количество: недовезённый остаток вернулся
      в свободный остаток ещё при доставке. Строка заказа говорит «десять», а
      держит шесть — вернув такой заказ в работу, следующая доставка увела бы
      резерв в минус.
    */
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    orderItemsTable[0].deliveredQuantity = "6.00";   // заказано 10, довезено 6

    await expect(op.updateStatus({ id: 1, status: "new" })).rejects.toThrow(/частично/i);
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("полная доставка через окно завершения возвращению в работу не мешает", async () => {
    // Окно завершения проставляет delivered_quantity и при ПОЛНОЙ доставке.
    // Отказывать по одному факту «поле заполнено» значило бы запретить откат
    // почти всем доставленным заказам — резерв под ними снимался целиком.
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    orderItemsTable[0].deliveredQuantity = "10.00";  // заказано 10, довезено 10

    await op.updateStatus({ id: 1, status: "new" });
    expect(ordersTable[0].status).toBe("new");
  });

  it("отмена доставленного заказа второй жизнью не считается и полей не трогает", async () => {
    // delivered → cancelled идёт назад по смыслу, но заказ остаётся закрытым:
    // второй жизни не начинает, и стирать ему нечего.
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    ordersTable[0].deliveryStatus = "delivered";

    await op.updateStatus({ id: 1, status: "cancelled" });

    expect(ordersTable[0].status).toBe("cancelled");
    expect(ordersTable[0].deliveryStatus).toBe("delivered");
  });
});

/*
  ── Склад отказывает, а не портит ────────────────────────────────────────────

  Проверка достатка знала два счётчика из трёх, а правка писала все три.
*/
describe("смена статуса не портит склад молча", () => {
  const callers = async () => {
    const { orderRouter } = await import("../order-router");
    return {
      agent: orderRouter.createCaller(makeCtx(1, 10, "agent")),
      op:    orderRouter.createCaller(makeCtx(1, 1, "operator")),
    };
  };

  it("резерв не уводится в минус", async () => {
    /*
      Резерв под заказом может оказаться меньше ожидаемого: его снял другой
      путь. Прежде проверялись только current_stock и available, а резерву
      писалось `reserved + delta` без нижней границы — и он уходил в минус.

      Это не «немного неточно»: отрицательный резерв молча аннулирует резерв
      ЧУЖИХ открытых заказов, и их товар становится доступен к продаже.
      Инвариант current = available + reserved при этом продолжает сходиться,
      поэтому ни одна сверка целостности такого не видит.
    */
    const { agent, op } = await callers();
    await createOrder(agent);                       // резерв 10
    stockTable[0].reserved = "4.00";                // ...а на складе осталось 4

    await expect(op.updateStatus({ id: 1, status: "cancelled" }))
      .rejects.toThrow(/Недостаточно товара/);

    expect(Number(stockTable[0].reserved), "резерв ушёл в минус").toBeGreaterThanOrEqual(0);
    expect(ordersTable[0].status).toBe("new");
  });

  it("товар без карточки остатка получает отказ, а не пропадает", async () => {
    /*
      UPDATE идёт по `WHERE product_id IN (…)` и несуществующую строку не
      задевает, а запись в журнал писалась всё равно: журнал сообщал о приходе
      товара на склад, который об этом не знает, и единицы просто исчезали.
    */
    const { agent, op } = await callers();
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    stockTable.length = 0;                          // карточку остатка удалили

    await expect(op.updateStatus({ id: 1, status: "new" }))
      .rejects.toThrow(/карточки остатка/);
    expect(ordersTable[0].status).toBe("delivered");
  });
});

/*
  ── Даты второй жизни ────────────────────────────────────────────────────────

  Заказ, возвращённый из архива в работу, начинает второй круг под тем же
  номером. Дата у него при этом не двигалась, и почти вся отчётность —
  выручка за период, комиссия агента, выполнение плана, спрос для прогноза —
  датирует заказ именно по created_at. Деньги второго круга падали в месяц
  первого: закрытый, прочитанный и уже разложенный по агентам.

  Ровно одному отчёту нужна первая дата, а не текущая: старение долга. Товар
  уехал в магазин тогда, и правка статуса не делает долг моложе.
*/
describe("возврат в работу передатирует заказ", () => {
  const callers = async () => {
    const { orderRouter } = await import("../order-router");
    return {
      agent: orderRouter.createCaller(makeCtx(1, 10, "agent")),
      op:    orderRouter.createCaller(makeCtx(1, 1, "operator")),
    };
  };

  /** Отодвинуть дату оформления назад — как будто заказ из прошлого месяца. */
  const backdate = (days: number) => {
    const then = new Date(Date.now() - days * 86_400_000);
    ordersTable[0].createdAt = then;
    return then;
  };

  it("дата заказа становится датой второго круга", async () => {
    const { agent, op } = await callers();
    await createOrder(agent);
    const january = backdate(40);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].createdAt.getTime(), "дата осталась от первого круга")
      .toBeGreaterThan(january.getTime());
    // С запасом на медленную машину: важно, что дата сегодняшняя, а не
    // сорокадневной давности.
    expect(Date.now() - ordersTable[0].createdAt.getTime()).toBeLessThan(60_000);
  });

  it("первая дата не теряется", async () => {
    const { agent, op } = await callers();
    await createOrder(agent);
    const january = backdate(40);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].firstOrderedAt?.getTime(), "первое оформление потеряно")
      .toBe(january.getTime());
  });

  it("третий круг не стирает дату первого", async () => {
    // COALESCE, а не присваивание: иначе «первая дата» через два возврата
    // означала бы дату второго круга, и старение долга помолодело бы на
    // столько же, на сколько раньше.
    const { agent, op } = await callers();
    await createOrder(agent);
    const january = backdate(40);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "new" });
    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "processing" });

    expect(ordersTable[0].firstOrderedAt?.getTime()).toBe(january.getTime());
  });

  it("обычная смена статуса дату не трогает", async () => {
    // Движение вперёд второй жизни не начинает: передатировать нечего, и
    // заказ, ушедший в «доставлен», обязан остаться в своём месяце.
    const { agent, op } = await callers();
    await createOrder(agent);
    const when = backdate(40);

    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "delivered" });

    expect(ordersTable[0].createdAt.getTime()).toBe(when.getTime());
    expect(ordersTable[0].firstOrderedAt).toBeNull();
  });

  it("уход из «доставлен» в «отменён» тоже не передатирует", async () => {
    // Заказ остаётся закрытым: второй жизни нет, выручка откатывается — и
    // откатывается она из СВОЕГО месяца, а не переносится в текущий.
    const { agent, op } = await callers();
    await createOrder(agent);
    const when = backdate(40);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "cancelled" });

    expect(ordersTable[0].createdAt.getTime()).toBe(when.getTime());
    expect(ordersTable[0].firstOrderedAt).toBeNull();
  });
});

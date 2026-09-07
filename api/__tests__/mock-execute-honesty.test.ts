/**
 * Подделка склада отвечает за то, что обещает.
 *
 * ── Зачем проверять сам стенд ───────────────────────────────────────────────
 *
 * Через createExecuteMock проходят все складские правки восьми наборов
 * тестов. Ошибка здесь не роняет ни один из них — она делает их зелёными на
 * чём угодно, и это худший вид неверного теста: он не падает ложно, он молча
 * подтверждает.
 *
 * Две такие ошибки тут и жили.
 *
 * 1. Организация определялась как «последнее не-объектное значение запроса»:
 *
 *        const tenantId = s.values.filter(v => typeof v !== "object").pop();
 *
 *    А запрос кончается на `AND warehouse_id = ${whId}`. То есть строка
 *    остатка отбиралась сравнением её tenant_id с идентификатором СКЛАДА. В
 *    стендах организация 1 и склад 1 совпадают числом — сходилось. Сошлось бы
 *    и без фильтра по организации в продакшене.
 *
 * 2. Простая правка одного товара (`SET available = available - ?`) не
 *    разбиралась вовсе. Восстановление удалённого заказа пишет именно так, и
 *    список правок оставался пустым: склад в стенде не двигался, а проверка
 *    «после восстановления товар снова зарезервирован» проходила при любом
 *    коде.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createExecuteMock } from "./helpers/mock-execute";

interface Row {
  productId: number; tenantId: number;
  currentStock: string; reserved: string; available: string;
}

let stock: Row[];

/** Собрать объект sql`` так же, как это делают моки drizzle в тестах. */
const raw = (strings: string[], ...values: unknown[]) => ({ __kind: "sql", strings, values });

beforeEach(() => {
  stock = [
    { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    // Тот же товар у соседней организации на складе с НОМЕРОМ ОДИН — ровно то
    // сочетание, на котором прежняя ошибка была не видна.
    { productId: 1, tenantId: 7, currentStock: "500.00", reserved: "0.00", available: "500.00" },
  ];
});

describe("подделка склада: чья строка правится", () => {
  it("правка идёт в организацию из запроса, а не в номер склада", async () => {
    const execute = createExecuteMock(stock);

    // UPDATE … SET available = available - 10, reserved = reserved + 10
    // WHERE product_id = 1 AND tenant_id = 7 AND warehouse_id = 1
    await execute(raw(
      ["UPDATE warehouse_stock SET available = available - ", ", reserved = reserved + ",
       " WHERE product_id = ", " AND tenant_id = ", " AND warehouse_id = ", ""],
      10, 10, 1, 7, 1,
    ));

    expect(stock[1].available, "правка не дошла до своей организации").toBe("490.00");
    expect(stock[1].reserved).toBe("10.00");
    expect(stock[0].available, "задета чужая организация").toBe("100.00");
  });

  it("запрос без tenant_id роняет стенд, а не правит всех подряд", async () => {
    const execute = createExecuteMock(stock);

    // Отказ синхронный: он должен прозвучать до того, как хоть одна строка
    // будет тронута, а не превратиться в отклонённое обещание.
    expect(() => execute(raw(
      ["UPDATE warehouse_stock SET available = available - ", " WHERE product_id = ", ""],
      5, 1,
    ))).toThrow(/tenant_id/);
  });
});

describe("подделка склада: простая правка одного товара", () => {
  it("двигает остаток, а не молчит", async () => {
    // Так пишет восстановление удалённого заказа: резерв обратно, свободный
    // остаток вниз. Прежде список правок оставался пустым.
    const execute = createExecuteMock(stock);

    await execute(raw(
      ["UPDATE warehouse_stock SET available = available - ", ", reserved = reserved + ",
       " WHERE product_id = ", " AND tenant_id = ", " AND warehouse_id = ", ""],
      3, 3, 1, 1, 1,
    ));

    expect(stock[0].available).toBe("97.00");
    expect(stock[0].reserved).toBe("3.00");
    expect(stock[0].currentStock, "тронуто то, чего запрос не касался").toBe("100.00");
  });

  it("списание уменьшает и физический остаток", async () => {
    const execute = createExecuteMock(stock);

    await execute(raw(
      ["UPDATE warehouse_stock SET current_stock = current_stock - ", ", reserved = reserved - ",
       " WHERE product_id = ", " AND tenant_id = ", " AND warehouse_id = ", ""],
      4, 4, 1, 1, 1,
    ));

    expect(stock[0].currentStock).toBe("96.00");
    expect(stock[0].reserved).toBe("-4.00");
  });

  it("LEAST и GREATEST роняют стенд, а не считаются наполовину", async () => {
    /*
      Частичная доставка пишет `available = available - ? + LEAST(?, reserved)`.
      Разобрать первое слагаемое и промолчать о втором — значит развести
      остаток в стенде с настоящим и продолжить подтверждать. Такие пути
      проверяются набором real-db, где база настоящая.
    */
    const execute = createExecuteMock(stock);

    expect(() => execute(raw(
      ["UPDATE warehouse_stock SET available = available - ", " + LEAST(", ", reserved)",
       " WHERE product_id = ", " AND tenant_id = ", ""],
      5, 10, 1, 1,
    ))).toThrow(/LEAST/);
  });
});

/**
 * Подделка склада отвечает за то, что обещает.
 *
 * ── Зачем проверять сам стенд ───────────────────────────────────────────────
 *
 * Через createExecuteMock проходят все складские правки восьми наборов тестов.
 * Ошибка здесь не роняет ни один из них — она делает их зелёными на чём угодно,
 * и это худший вид неверного теста: он не падает ложно, он молча подтверждает.
 *
 * Три такие ошибки тут и жили.
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
 * 2. Простая правка одного товара не разбиралась вовсе: список правок
 *    оставался пустым, склад в стенде не двигался, а проверка проходила при
 *    любом коде.
 *
 * 3. Форма запроса угадывалась по обрывкам текста — «есть ли reserved =
 *    reserved +», «сколько раз встретилось LEAST», — и из этих обрывков
 *    выводился ЗНАК операции. Промах опознавателя тоже никого не ронял.
 *
 * ── Что изменилось ──────────────────────────────────────────────────────────
 *
 * Остаток меняет одна дверь (api/services/stock-ledger.ts), форм у неё три, и
 * подделка сверяет их целиком, а не угадывает. Незнакомая запись в
 * warehouse_stock роняет стенд. Проверяется здесь и это: подделка, которая
 * молча глотает складскую правку, хуже отсутствующей.
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
const join = (...chunks: unknown[]) => ({ __kind: "sql_join", chunks });
const when = (productId: number, delta: number) =>
  raw(["WHEN product_id = ", " THEN ", ""], productId, delta);

/**
 * Пакетный сдвиг двери — тот же текст, что собирает shiftStock.
 *
 * Строки шаблона выписаны здесь дословно нарочно: подделка сверяет форму
 * целиком, и если дверь перепишут, сверка обязана перестать совпадать. Стенд,
 * подогнанный под «примерно такой» запрос, — это тот же угадыватель, только
 * снаружи.
 */
const shift = (
  onHand: Array<[number, number]>,
  held: Array<[number, number]>,
  ids: number[],
  tenantId: number,
  warehouseId: number,
) => raw(
  [
    "\n    UPDATE warehouse_stock\n    SET current_stock = current_stock + CASE ",
    " ELSE 0 END,\n        reserved      = GREATEST(0, reserved + CASE ",
    " ELSE 0 END),\n        available     = current_stock - reserved\n    WHERE product_id IN (",
    ")\n      AND tenant_id = ",
    "\n      AND warehouse_id = ",
    "\n  ",
  ],
  join(...onHand.map(([id, d]) => when(id, d))),
  join(...held.map(([id, d]) => when(id, d))),
  join(...ids.map(id => raw(["", ""], id))),
  tenantId,
  warehouseId,
);

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

    // Резерв десяти единиц у организации 7 на складе номер 1.
    await execute(shift([[1, 0]], [[1, 10]], [1], 7, 1));

    expect(stock[1].reserved, "правка не дошла до своей организации").toBe("10.00");
    expect(stock[1].available).toBe("490.00");
    expect(stock[0].reserved, "задета чужая организация").toBe("0.00");
    expect(stock[0].available).toBe("100.00");
  });

  it("запрос без tenant_id роняет стенд, а не правит всех подряд", () => {
    const execute = createExecuteMock(stock);
    const noTenant = raw(
      [
        "\n    UPDATE warehouse_stock\n    SET current_stock = current_stock + CASE ",
        " ELSE 0 END,\n        reserved      = GREATEST(0, reserved + CASE ",
        " ELSE 0 END),\n        available     = current_stock - reserved\n    WHERE product_id IN (",
        ")\n  ",
      ],
      join(when(1, 0)), join(when(1, 5)), join(raw(["", ""], 1)),
    );

    // Отказ синхронный: он должен прозвучать до того, как хоть одна строка
    // будет тронута, а не превратиться в отклонённое обещание.
    expect(() => execute(noTenant)).toThrow(/tenant_id/);
    expect(stock[0].reserved, "строку успели тронуть до отказа").toBe("0.00");
  });
});

describe("подделка склада: арифметика двери", () => {
  it("available ВЫВОДИТСЯ, а не правится отдельно", async () => {
    /*
      Ровно та беда, из-за которой дверь и появилась. Снимаем из резерва
      больше, чем там лежит: ограничитель держит резерв на нуле.

      Прежняя формула прибавляла к available всю заявленную величину, и
      свободный остаток становился больше физического. Здесь available
      выводится, поэтому он не может разойтись с остальными двумя — как и в
      MySQL.
    */
    stock[0] = { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "3.00", available: "97.00" };
    const execute = createExecuteMock(stock);

    await execute(shift([[1, 0]], [[1, -10]], [1], 1, 1));

    expect(stock[0].reserved, "ограничитель не сработал").toBe("0.00");
    expect(stock[0].available, "в свободное вернулось больше, чем лежало в резерве").toBe("100.00");
    expect(stock[0].currentStock, "тронуто то, чего запрос не касался").toBe("100.00");
  });

  it("отгрузка снимает с резерва заказанное, а со склада — увезённое", async () => {
    // Частичная доставка: заказ держал пять, уехало три. Две единицы обязаны
    // вернуться в свободный остаток сами.
    stock[0] = { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "5.00", available: "95.00" };
    const execute = createExecuteMock(stock);

    await execute(shift([[1, -3]], [[1, -5]], [1], 1, 1));

    expect(stock[0].currentStock).toBe("97.00");
    expect(stock[0].reserved).toBe("0.00");
    expect(stock[0].available).toBe("97.00");
  });

  it("установка числом обрезает резерв по новому остатку", async () => {
    stock[0] = { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "40.00", available: "60.00" };
    const execute = createExecuteMock(stock);

    await execute(raw(
      [
        "\n    UPDATE warehouse_stock\n    SET current_stock = ",
        ",\n        reserved      = LEAST(reserved, ",
        "),\n        available     = current_stock - reserved\n    WHERE product_id = ",
        "\n      AND tenant_id = ",
        "\n      AND warehouse_id = ",
        "\n  ",
      ],
      25, 25, 1, 1, 1,
    ));

    expect(stock[0].currentStock).toBe("25.00");
    expect(stock[0].reserved, "резерв остался больше физического остатка").toBe("25.00");
    expect(stock[0].available).toBe("0.00");
  });

  it("приход заводит строку, если её нет", async () => {
    // Голый UPDATE на новом для склада товаре не совпадал ни с одной строкой:
    // возврат принимали, с магазина списывали, а на склад он не попадал.
    const execute = createExecuteMock(stock);

    await execute(raw(
      [
        "\n    INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)\n    VALUES (",
        ", ", ", ", ", ", ", 0, ", ")\n    ON DUPLICATE KEY UPDATE\n      current_stock = current_stock + ",
        ",\n      available     = current_stock - reserved\n  ",
      ],
      1, 1, 42, 7, 7, 7,
    ));

    const created = stock.find(r => r.productId === 42 && r.tenantId === 1);
    expect(created, "новая строка остатка не заведена").toBeDefined();
    expect(created?.currentStock).toBe("7.00");
    expect(created?.available).toBe("7.00");
  });
});

describe("подделка склада: незнакомая форма", () => {
  it("роняет стенд, а не глотает правку молча", () => {
    /*
      Здесь жил самый дорогой вид неверного теста. Подделка возвращала
      Promise.resolve() на всё, чего не поняла: складская правка исчезала, а
      проверка «после отмены товар вернулся в свободный остаток» проходила при
      любом коде — в том числе при коде, который не трогал склад вовсе.
    */
    const execute = createExecuteMock(stock);

    expect(() => execute(raw(
      ["UPDATE warehouse_stock SET available = available - ", " WHERE product_id = ", " AND tenant_id = ", ""],
      5, 1, 1,
    ))).toThrow(/не узнала запрос/);

    expect(stock[0].available, "строка тронута непонятым запросом").toBe("100.00");
  });

  it("запрос не про склад проходит мимо без шума", async () => {
    // Через тот же execute идут и другие запросы набора; ронять их нельзя.
    const execute = createExecuteMock(stock);
    await execute(raw(["UPDATE orders SET status = ", " WHERE id = ", ""], "delivered", 1));
    expect(stock[0].available).toBe("100.00");
  });
});

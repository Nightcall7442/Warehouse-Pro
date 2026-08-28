/**
 * Разбор ошибок драйвера, когда они приезжают завёрнутыми.
 *
 * Проверки на настоящей MySQL нашли, что обработка дубликатов молча отключена:
 * drizzle заворачивает ошибку драйвера в свою, у обёртки нет ни `code`, ни
 * `sqlMessage`, а весь код читал их с верхнего уровня. Тот набор тяжёлый и
 * ходит в базу; эта же поломка ловится здесь за миллисекунды.
 *
 * Формы ошибок ниже списаны с настоящего вывода CI, а не придуманы.
 */
import { describe, it, expect } from "vitest";
import { isDuplicateEntry, isDuplicateOf } from "../lib/db-errors";

/** Как ошибку отдаёт сам mysql2 — без обёртки. */
function driverError(index: string) {
  return Object.assign(new Error(`Duplicate entry '№1-1' for key '${index}'`), {
    code: "ER_DUP_ENTRY",
    errno: 1062,
    sqlState: "23000",
    sqlMessage: `Duplicate entry '№1-1' for key '${index}'`,
  });
}

/** Как её отдаёт drizzle: своя ошибка, драйверная — в cause. */
function wrapped(index: string) {
  return Object.assign(new Error("Failed query: insert into `orders` … params: 1,№1"), {
    cause: driverError(index),
  });
}

describe("нарушение уникального индекса", () => {
  it("узнаётся в ошибке драйвера", () => {
    expect(isDuplicateEntry(driverError("orders.uq_order_number_tenant"))).toBe(true);
  });

  it("узнаётся и когда drizzle завернул её в свою", () => {
    // Ровно этот случай отключил повтор номера заказа в продакшене.
    expect(isDuplicateEntry(wrapped("orders.uq_order_number_tenant"))).toBe(true);
  });

  it("узнаётся под двумя слоями обёрток", () => {
    const twice = Object.assign(new Error("Transaction failed"), {
      cause: wrapped("orders.uq_orders_idempotency"),
    });
    expect(isDuplicateEntry(twice)).toBe(true);
  });

  it("посторонняя ошибка за дубликат не выдаётся", () => {
    expect(isDuplicateEntry(new Error("Недостаточно товара на складе"))).toBe(false);
    expect(isDuplicateEntry(null)).toBe(false);
    expect(isDuplicateEntry({ code: "ER_LOCK_DEADLOCK" })).toBe(false);
  });

  it("кольцевая цепочка не зацикливает разбор", () => {
    // Не выдумка: cause сплошь и рядом ставят вручную, и замкнуть его недолго.
    const a: { cause?: unknown } = {};
    const b = { cause: a };
    a.cause = b;
    expect(isDuplicateEntry(a)).toBe(false);
  });
});

describe("какой именно индекс нарушен", () => {
  it("различает номер заказа и ключ идемпотентности", () => {
    // От этого различия зависит поведение: коллизия номера — повторить со
    // следующим, дубликат по ключу — вернуть уже созданный заказ. Спутать их
    // значит либо остановить офлайн-очередь, либо создать заказ дважды.
    const number = wrapped("orders.uq_order_number_tenant");
    const key = wrapped("orders.uq_orders_idempotency");

    expect(isDuplicateOf(number, "uq_orders_idempotency")).toBe(false);
    expect(isDuplicateOf(number, "uq_order_number_tenant")).toBe(true);
    expect(isDuplicateOf(key, "uq_orders_idempotency")).toBe(true);
    expect(isDuplicateOf(key, "uq_order_number_tenant")).toBe(false);
  });

  it("без имени индекса в тексте отвечает отрицательно", () => {
    // Умолчание вызывающего при таком ответе — «коллизия номера, повторить».
    // Обратное остановило бы очередь заказов у агента.
    const nameless = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
    });
    expect(isDuplicateEntry(nameless)).toBe(true);
    expect(isDuplicateOf(nameless, "uq_orders_idempotency")).toBe(false);
  });
});

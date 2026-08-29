import { describe, it, expect } from "vitest";
import "./sqlite-engine"; // требует Node 22.5+ и объясняет, если его нет
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Номера заказов: «№149» вместо «ORD-B650EBBC369B».
 *
 * Сам запрос считается в MySQL, поэтому его поведение проверяется на
 * движке-двойнике (node:sqlite) — важна арифметика выбора следующего номера, а
 * она одинакова. Отдельно проверяется, что в продукте не осталось прежней
 * генерации из UUID.
 */

type Row = Record<string, unknown>;

async function withDb(fn: (run: (sql: string) => Row[]) => void) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const run = (sql: string) => db.prepare(sql).all() as Row[];
  db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, tenant_id INT, order_number TEXT)");
  try { fn(run); } finally { db.close(); }
}

/**
 * Тот же расчёт, что в nextOrderNumber: большее из числа заказов организации и
 * максимума среди уже выданных №-номеров, плюс один.
 *
 * SUBSTRING(order_number, 2) на старом «ORD-…» даёт нечисловой хвост, а
 * приведение к числу — ноль, поэтому старые номера в максимум не попадают. В
 * sqlite это выражается через CAST так же.
 */
function nextNumber(run: (sql: string) => Row[], tenantId: number): string {
  const [row] = run(`
    SELECT COUNT(*) AS total,
           COALESCE(MAX(CAST(SUBSTR(order_number, 2) AS INTEGER)), 0) AS maxNumbered
    FROM orders WHERE tenant_id = ${tenantId}
  `);
  return `№${Math.max(Number(row.total), Number(row.maxNumbered)) + 1}`;
}

describe("следующий номер заказа", () => {
  it("продолжает счёт от существующих заказов, а не начинается с №1", async () => {
    await withDb(run => {
      // 148 старых заказов со случайными номерами — как в живой базе.
      const rows = Array.from({ length: 148 }, (_, i) =>
        `(${i + 1}, 12, 'ORD-B650EBBC${String(i).padStart(3, "0")}')`).join(",");
      run(`INSERT INTO orders VALUES ${rows}`);

      // Со ста сорока восемью заказами свежий заказ под номером один выглядел
      // бы ошибкой, поэтому счёт продолжается.
      expect(nextNumber(run, 12)).toBe("№149");
    });
  });

  it("дальше идёт по порядку", async () => {
    await withDb(run => {
      run(`INSERT INTO orders VALUES (1, 12, '№149'), (2, 12, '№150')`);
      expect(nextNumber(run, 12)).toBe("№151");
    });
  });

  it("номера не едут назад после удаления заказов", async () => {
    await withDb(run => {
      run(`INSERT INTO orders VALUES (1, 12, '№149'), (2, 12, '№150'), (3, 12, '№151')`);
      run(`DELETE FROM orders WHERE order_number = '№150'`);
      // Осталось две записи, но максимум — 151: иначе следующий заказ получил
      // бы №151 и столкнулся с уже выданным.
      expect(nextNumber(run, 12)).toBe("№152");
    });
  });

  it("у каждой организации своя нумерация", async () => {
    await withDb(run => {
      run(`INSERT INTO orders VALUES (1, 12, '№149'), (2, 12, '№150'), (3, 99, '№7')`);
      expect(nextNumber(run, 12)).toBe("№151");
      expect(nextNumber(run, 99)).toBe("№8");
    });
  });

  it("старые ORD-номера не ломают расчёт максимума", async () => {
    await withDb(run => {
      // Хвост старого номера нечисловой; приведение к числу даёт ноль, а не
      // случайную величину, которая утащила бы счётчик в небо.
      run(`INSERT INTO orders VALUES (1, 12, 'ORD-999999999999'), (2, 12, '№5')`);
      expect(nextNumber(run, 12)).toBe("№6");
    });
  });
});

describe("генерация номера в продукте", () => {
  it("прежней случайной генерации из UUID не осталось", () => {
    const src = readFileSync(join(process.cwd(), "api", "services", "order.ts"), "utf8");
    expect(src, "номер снова собирается из случайного UUID").not.toMatch(/ORD-\$\{/);
    expect(src).toContain("nextOrderNumber");
  });

  it("столкновение номеров обрабатывается повтором, а не падением", () => {
    // Два заказа, оформленные в одну секунду, посчитают один и тот же номер;
    // уникальный индекс отклонит второго, и он обязан взять следующий.
    //
    // Проверка искала здесь буквальное «ER_DUP_ENTRY». Строка уехала в общий
    // разбор ошибок (lib/db-errors) — и уехала правильно: читать код ошибки с
    // верхнего уровня нельзя, drizzle заворачивает её в свою, и проверка
    // давала false всегда. Ищем теперь сам повтор, а не название константы.
    const src = readFileSync(join(process.cwd(), "api", "services", "order.ts"), "utf8");
    const from = src.indexOf("nextOrderNumber(tx, tenantId)");
    const create = src.slice(from, from + 1500);
    expect(create, "распознавание дубликата убрано из ветки повтора").toMatch(/isDuplicateEntry\(err\)/);
    expect(create, "коллизия номера больше не отличается от дубликата по ключу").toMatch(/isIdempotencyDuplicate\(err\)/);
    expect(create, "следующий номер не берётся").toMatch(/№\$\{Number\(number\.slice\(1\)\) \+ 1\}/);
  });
});

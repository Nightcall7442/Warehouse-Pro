import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Ссылки на внешнюю таблицу внутри подзапросов должны быть уточнены именем
 * таблицы вручную, а не подставлены объектом колонки drizzle.
 *
 * ── Что случилось ────────────────────────────────────────────────────────────
 *
 * В СПИСКЕ ВЫБОРКИ (в отличие от WHERE) drizzle печатает колонку без имени
 * таблицы: `${supplies.id}` превращается в просто `id`. Внутри коррелирующего
 * подзапроса своё `id` есть и у внутренней таблицы, и MySQL разрешает
 * неуточнённое имя в её пользу. Условие
 *
 *     WHERE p.supply_id = `id`
 *
 * тихо становится `p.supply_id = p.id` и считает не то.
 *
 * Проверено на боевой базе на литеральных данных: неуточнённая форма вернула
 * 0 там, где верный ответ 500. Ошибки при этом нет — есть неверная сумма в
 * графе «оплачено», то есть неверный долг перед контрагентом.
 *
 * В arrival.list та же причина проявилась честнее — ER_NON_UNIQ_ERROR,
 * «Column 'id' in where clause is ambiguous», страница просто перестала
 * грузиться. Именно поэтому её и заметили; в подзапросах долга она молчала бы.
 *
 * ── Почему проверка именно такая ─────────────────────────────────────────────
 *
 * Мокнутые тесты роутера этот класс ошибок не ловят вовсе: SQL в них не
 * выполняется, а подзапросы подменены расчётом на JavaScript. Ловить можно
 * либо живой базой с данными, либо чтением исходника — здесь второе.
 *
 * Подстановка значений (`${currency}`, `${tenantId}`) остаётся разрешённой:
 * это параметры запроса, они уходят плейсхолдером и никакой неоднозначности
 * не создают. Запрещена подстановка ОБЪЕКТА КОЛОНКИ.
 */

/*
 * Файлы с коррелирующими подзапросами по поставщикам: сам роутер
 * поставщиков и роутер заказов поставщикам (итог, остаток к приёму и
 * непроведённые приходы в списке заказов считаются подзапросами по
 * purchase_orders).
 */
const FILES = [
  {
    name: "supplier-router",
    file: "../supplier-router.ts",
    /** Таблицы, чьи колонки нельзя подставлять внутрь sql``-подзапросов. */
    tables: ["suppliers", "supplies", "supplierPayments", "arrivals", "arrivalItems", "users"],
    minSelects: 5,
    qualified: ["\\`supplies\\`.\\`id\\`", "\\`suppliers\\`.\\`id\\`", "\\`arrivals\\`.\\`id\\`"],
  },
  {
    name: "purchase-order-router",
    file: "../purchase-order-router.ts",
    tables: ["purchaseOrders", "purchaseOrderItems", "suppliers", "warehouses", "products", "arrivals", "users"],
    minSelects: 3,
    qualified: ["\\`purchase_orders\\`.\\`id\\`"],
  },
] as const;

describe.each(FILES)("$name: подзапросы уточнены именем таблицы", ({ file, tables, minSelects, qualified }) => {
  const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");

  it("файл на месте и содержит sql-подзапросы", () => {
    // Иначе проверки ниже пройдут на пустом месте и не будут значить ничего.
    expect(src).toContain("sql<");
    expect(src.match(/SELECT/g)?.length ?? 0).toBeGreaterThan(minSelects);
  });

  it.each(tables)("не подставляет колонки %s объектом drizzle", (table) => {
    // Ищем `${table.something}` — подстановку объекта колонки.
    const found = [...src.matchAll(new RegExp(`\\$\\{${table}\\.[a-zA-Z]`, "g"))];
    // Строки, попавшие в комментарий-разбор, к делу не относятся: это текст,
    // а не код. Отсеиваем их по ведущей звёздочке блочного комментария.
    const real = found.filter(m => {
      const lineStart = src.lastIndexOf("\n", m.index!) + 1;
      return !/^\s*\*/.test(src.slice(lineStart, m.index!));
    });
    expect(real.map(m => src.slice(m.index! - 40, m.index! + 30))).toEqual([]);
  });

  it("корреляция написана уточнённой формой", () => {
    // Встречная проверка: если бы уточнённых ссылок не было вовсе, запрет
    // выше выполнялся бы сам собой и ничего не означал.
    for (const ref of qualified) expect(src).toContain(ref);
  });
});

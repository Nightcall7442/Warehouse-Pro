import { describe, it, expect } from "vitest";
import {
  formatOrdersForExport,
  formatWarehouseForExport,
  formatMovementsForExport,
  formatArrivalsForExport,
  formatShopsForExport,
  formatStockValuationForExport,
  formatProductsForExport,
  formatAgentsForExport,
  formatDeadStockForExport,
  formatReorderForExport,
  formatUsersForExport,
  formatPnLForExport,
} from "@/lib/excel";

/**
 * Подготовка строк для выгрузки в Excel.
 *
 * Эти функции решают, что человек увидит в отчёте, и молчат при любой беде:
 * пропущенное поле, строка вместо числа, пустая ссылка. Ошибка здесь не падает
 * — она приезжает в таблицу и живёт там, пока по ней не примут решение.
 *
 * Проверяется не пересказ кода, а места, где он способен соврать.
 */

describe("заказы в отчёте", () => {
  it("пропущенные поля дают пустую ячейку, а не слово undefined", () => {
    // Заказ без территории и примечаний — обычное дело. В таблице на его месте
    // должно быть пусто; «undefined» в отчёте для бухгалтерии выглядит как
    // поломка выгрузки.
    const [row] = formatOrdersForExport([{ orderNumber: "З-1" }]);
    expect(row["Территория"]).toBe("");
    expect(row["Примечания"]).toBe("");
    expect(row["Агент"]).toBe("");
    expect(Object.values(row).join(" ")).not.toMatch(/undefined|null|NaN/);
  });

  it("суммы уходят ЧИСЛАМИ, а не текстом", () => {
    /*
      Стояло .toFixed(2), то есть в клетку уходила строка «1250.00». Excel
      помечал такую клетку зелёным уголком «число сохранено как текст»: её
      нельзя ни сложить, ни отсортировать, ни взять в формулу. Файл
      открывался, а работать в нём было нельзя — с этого и началась жалоба
      на выгрузки.

      Разряды и два знака после запятой теперь задаёт числовой формат клетки
      (см. exportToExcel), а не строка: так число остаётся числом.
    */
    const [row] = formatOrdersForExport([{ subtotal: 1250, discount: "0", total: 1250.5 }]);
    expect(row["Сумма"]).toBe(1250);
    expect(row["Скидка"]).toBe(0);
    expect(row["Итого"]).toBe(1250.5);
    expect(typeof row["Итого"]).toBe("number");
  });

  it("отсутствие суммы — это ноль, а не пустота", () => {
    // Пустая клетка в денежном столбце ломает суммирование в Excel.
    const [row] = formatOrdersForExport([{}]);
    expect(row["Итого"]).toBe(0);
  });

  it("состояние заказа названо словом, а не кодом", () => {
    const [row] = formatOrdersForExport([{ status: "delivered" }]);
    expect(row["Статус"]).toBe("Доставлен");
  });
});

describe("склад в отчёте", () => {
  it("стоимость остатка считается, а не берётся из данных", () => {
    // 12 штук по 1500 — это 18000. Значение приходит не с сервера, его тут и
    // вычисляют, поэтому ошибка была бы незаметной.
    const [row] = formatWarehouseForExport([{ currentStock: "12", costPrice: "1500" }]);
    expect(row["Стоимость"]).toBe(18000);
  });

  it("нехватка отмечается строго ниже порога", () => {
    // Ровно на пороге — ещё не нехватка. Иначе половина склада каждый день
    // попадает в отчёт о дозаказе, и отчёт перестают читать.
    const rows = formatWarehouseForExport([
      { available: "9",  reorderPoint: "10" },
      { available: "10", reorderPoint: "10" },
      { available: "11", reorderPoint: "10" },
    ]);
    expect(rows.map(r => r["Запас"])).toEqual(["Мало", "Достаточно", "Достаточно"]);
  });

  it("количества уходят числами, точность задаёт формат клетки", () => {
    /*
      Точность раньше вшивалась в значение: .toFixed(2) превращал количество
      в текст, и Excel переставал его складывать. Теперь значение — число, а
      сколько знаков показать, решает числовой формат клетки (numFmtFor).

      Дробь при этом сохраняется полностью: 0.25 остаётся 0.25, а не
      округляется при записи.
    */
    const [row] = formatWarehouseForExport([
      { reorderPoint: "10.00", currentStock: "1250.500", reserved: "0.250" },
    ]);
    expect(row["Порог"]).toBe(10);
    expect(row["Всего"]).toBe(1250.5);
    expect(row["Резерв"]).toBe(0.25);
    expect(typeof row["Всего"]).toBe("number");
  });
});

describe("движения товара в отчёте", () => {
  /*
    Владелец открыл выгруженный файл и назвал его нечитаемым. В нём стояло:

        Status: out    Ссылка: manual_adjustment #null
        Примечания: Заказ: new → delivered

    «null» — это отсутствие номера документа, вылезшее в файл; остальное —
    внутренние слова, которых нет ни на одной бумаге. Проверка держит
    обратное: в файл выходит то, что человек может прочитать.
  */
  it("движение без документа не печатает «null»", () => {
    // Ручная правка счёта — событие без своего документа, номера у неё нет.
    const [row] = formatMovementsForExport([{ referenceType: "manual_adjustment", referenceId: null, type: "out", quantity: "5" }]);
    expect(row["Документ"]).toBe("Ручная правка");
    expect(JSON.stringify(row)).not.toContain("null");
  });

  it("документ называется словом и номером", () => {
    const [row] = formatMovementsForExport([{ referenceType: "order_delivery", referenceId: 1342 }]);
    expect(row["Документ"]).toBe("Доставка заказа №1342");
  });

  it("вид движения по-русски, а не «out»", () => {
    const [out] = formatMovementsForExport([{ type: "out" }]);
    const [inn] = formatMovementsForExport([{ type: "in" }]);
    expect(out["Вид"]).toBe("Расход");
    expect(inn["Вид"]).toBe("Приход");
  });

  it("состояния заказа в примечании названы словами", () => {
    const [row] = formatMovementsForExport([{ notes: "Заказ: new → delivered" }]);
    expect(row["Примечание"]).toBe("Заказ: Новый → Доставлен");
  });

  it("количество без хвостовых нулей", () => {
    // «1.00» вместо «1» в файле склада читается как небрежность.
    const [row] = formatMovementsForExport([{ quantity: "1.00" }]);
    expect(row["Количество"]).toBe("1");
  });

  it("имя товара в строках не повторяется: оно в заголовке файла", () => {
    const [row] = formatMovementsForExport([{ productName: "Кетчуп" }]);
    expect(Object.keys(row)).not.toContain("Товар");
  });
});

describe("приходы в отчёте", () => {
  it("расходы по рейсу выводятся все, включая нулевые", () => {
    // Нулевая пошлина — это «платили ноль», а не «неизвестно». Пустая ячейка
    // в столбце расходов ломает итог.
    const [row] = formatArrivalsForExport([{ arrivalNumber: "П-7", fuelCost: "150000", status: "unloading" }]);
    expect(row["Топливо"]).toBe(150000);
    expect(row["Платные дороги"]).toBe(0);
    expect(row["Прочее"]).toBe(0);
    expect(row["Расходы всего"]).toBe(0);
    // Состояние прихода — словом: печаталось «unloading».
    expect(row["Статус"]).toBe("Разгружается");
  });
});

describe("магазины и оценка склада", () => {
  it("строки магазинов собираются без потерь полей", () => {
    const rows = formatShopsForExport([{ name: "Магазин 1" }, { name: "Магазин 2" }]);
    expect(rows).toHaveLength(2);
    expect(Object.values(rows[0]).join(" ")).not.toMatch(/undefined|NaN/);
  });

  it("оценка склада не роняет строки без цены", () => {
    const rows = formatStockValuationForExport([{ productName: "Без цены" }]);
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0]).join(" ")).not.toMatch(/undefined|NaN/);
  });
});

describe("товары и агенты в отчёте", () => {
  it("вес показывается с тремя знаками, а порог целым", () => {
    // Вес в килограммах: 0.125 и 0.13 — разные упаковки, округление до сотых
    // склеило бы их. Порог заказа дробным не бывает.
    const [row] = formatProductsForExport([{ unitWeight: "0.125", reorderPoint: "10.00" }]);
    // Третий знак у веса не теряется: 0.125 кг и 0.13 кг — разный товар.
    // Показать его — забота формата клетки, хранить — забота значения.
    expect(row["Вес (кг)"]).toBe(0.125);
    expect(row["Мин. остаток"]).toBe(10);
  });

  it("товар без цен даёт нули, а не пустые ячейки", () => {
    const [row] = formatProductsForExport([{ code: "К-1", name: "Без цены" }]);
    expect(row["Цена"]).toBe(0);
    expect(row["Себестоимость"]).toBe(0);
    expect(Object.values(row).join(" ")).not.toMatch(/undefined|NaN/);
  });

  it("агент без имени показывается по номеру, а не пустой строкой", () => {
    // Строка без подписи в отчёте по агентам не даёт понять, о ком речь.
    const [row] = formatAgentsForExport([{ agentId: 7, visits: 3, orders: 2, revenue: "150000" }], 30);
    expect(row["Агент"]).toBe("Agent #7");
    expect(row["№"]).toBe(1);
    expect(row["Период"]).toBe("30 дней");
    expect(row["Выручка"]).toBe(150000);
  });

  it("нумерация в отчёте по агентам сквозная", () => {
    const rows = formatAgentsForExport([{ agentId: 1 }, { agentId: 2 }, { agentId: 3 }], 7);
    expect(rows.map(r => r["№"])).toEqual([1, 2, 3]);
  });
});

describe("мёртвый сток и дозаказ", () => {
  it("товар, который не продавали ни разу, помечен словом, а не пустой датой", () => {
    // Пустая ячейка читается как «данных нет», а тут данные есть: не продавали.
    const [row] = formatDeadStockForExport([{ productName: "Лежит с открытия" }]);
    expect(row["Последний заказ"]).toBe("Никогда");
  });

  it("дата последней продажи выводится, когда она есть", () => {
    const [row] = formatDeadStockForExport([{ lastOrderDate: "2026-03-15T10:00:00Z" }]);
    expect(row["Последний заказ"]).toMatch(/15\.03\.2026/);
  });

  it("продажи в день — с одним знаком, чтобы 0.4 не превратилось в ноль", () => {
    // При округлении до целого товар с продажами 0.4/день выглядит как
    // непродаваемый, и дозаказ по нему не сделают.
    const [row] = formatReorderForExport([{ avgDailySales: 0.44, daysUntilStockout: 12, suggestedQty: 50 }]);
    // Значение сохраняется как есть; один знак после запятой показывает
    // формат клетки, и 0.44 не превращается в ноль при округлении до целого.
    expect(row["Продажи/день"]).toBe(0.44);
    expect(row["Дней до конца"]).toBe(12);
    expect(row["Заказать"]).toBe(50);
  });
});

describe("пользователи в отчёте", () => {
  it("человек, ни разу не входивший, не даёт «Invalid Date»", () => {
    const [row] = formatUsersForExport([{ name: "Новый", email: "a@b.uz", role: "agent" }]);
    expect(row["Последний вход"]).toBe("");
    expect(Object.values(row).join(" ")).not.toMatch(/Invalid|undefined|NaN/);
  });
});

describe("отчёт о прибыли", () => {
  const base = {
    revenue: 1_000_000, cogs: 600_000, grossProfit: 400_000, grossMargin: 40,
    transportExpenses: 50_000, netProfit: 350_000, netMargin: 35,
  };

  it("маржа выводится со знаком процента", () => {
    const rows = formatPnLForExport({ ...base, products: [] });
    const margin = rows.find(r => r["Показатель"] === "Валовая маржа");
    expect(margin?.["Сумма"]).toBe("40.0%");
  });

  it("прибыль по товару считается как выручка минус себестоимость", () => {
    // Значение не приходит с сервера — его вычисляют здесь, поэтому ошибка
    // была бы незаметной: в отчёте просто стояло бы другое число.
    const rows = formatPnLForExport({
      ...base,
      products: [{ productName: "Кетчуп", totalQty: "100", totalRevenue: "500000", totalCost: "300000" }],
    });
    const row = rows.find(r => r["Показатель"] === "Кетчуп");
    expect(row?.["Прибыль"]).toBe("200000");
    expect(row?.["Выручка"]).toBe("500000");
  });

  it("товар без выручки не даёт деления на ноль", () => {
    // margin = profit / revenue; при нулевой выручке это NaN, и в отчёте
    // появилось бы «NaN%» вместо числа.
    const rows = formatPnLForExport({
      ...base,
      products: [{ productName: "Не продавался", totalQty: "0", totalRevenue: "0", totalCost: "0" }],
    });
    const row = rows.find(r => r["Показатель"] === "Не продавался");
    expect(Object.values(row ?? {}).join(" ")).not.toMatch(/NaN|Infinity/);
  });
});

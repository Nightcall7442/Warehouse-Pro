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

  it("суммы всегда с двумя знаками", () => {
    // Столбец, где рядом стоят 1250 и 1250.5, читается как разные величины.
    const [row] = formatOrdersForExport([{ subtotal: 1250, discount: "0", total: 1250.5 }]);
    expect(row["Сумма"]).toBe("1250.00");
    expect(row["Скидка"]).toBe("0.00");
    expect(row["Total"]).toBe("1250.50");
  });

  it("отсутствие суммы — это ноль, а не пустота", () => {
    // Пустая ячейка в денежном столбце ломает суммирование в Excel.
    const [row] = formatOrdersForExport([{}]);
    expect(row["Total"]).toBe("0.00");
  });
});

describe("склад в отчёте", () => {
  it("стоимость остатка считается, а не берётся из данных", () => {
    // 12 штук по 1500 — это 18000. Значение приходит не с сервера, его тут и
    // вычисляют, поэтому ошибка была бы незаметной.
    const [row] = formatWarehouseForExport([{ currentStock: "12", costPrice: "1500" }]);
    expect(row["Стоимость"]).toBe("18000.00");
  });

  it("нехватка отмечается строго ниже порога", () => {
    // Ровно на пороге — ещё не нехватка. Иначе половина склада каждый день
    // попадает в отчёт о дозаказе, и отчёт перестают читать.
    const rows = formatWarehouseForExport([
      { available: "9",  reorderPoint: "10" },
      { available: "10", reorderPoint: "10" },
      { available: "11", reorderPoint: "10" },
    ]);
    expect(rows.map(r => r["Low Stock"])).toEqual(["low", "ok", "ok"]);
  });

  it("порог показывается целым, а количества — с дробью", () => {
    const [row] = formatWarehouseForExport([
      { reorderPoint: "10.00", currentStock: "1250.500", reserved: "0.250" },
    ]);
    expect(row["Порог"]).toBe("10");
    expect(row["Всего"]).toBe("1250.50");
    expect(row["Резерв"]).toBe("0.25");
  });
});

describe("движения товара в отчёте", () => {
  it("движение без ссылки не даёт «undefined #undefined»", () => {
    // Ручная корректировка приходит без ссылки на документ.
    const [row] = formatMovementsForExport([{ productName: "Кетчуп", quantity: "5" }]);
    expect(row["Ссылка"]).toBe("");
  });

  it("ссылка на документ собирается целиком", () => {
    const [row] = formatMovementsForExport([{ referenceType: "order", referenceId: 42 }]);
    expect(row["Ссылка"]).toBe("order #42");
  });
});

describe("приходы в отчёте", () => {
  it("расходы по рейсу выводятся все, включая нулевые", () => {
    // Нулевая пошлина — это «платили ноль», а не «неизвестно». Пустая ячейка
    // в столбце расходов ломает итог.
    const [row] = formatArrivalsForExport([{ arrivalNumber: "П-7", fuelCost: "150000" }]);
    expect(row["Fuel Cost"]).toBe("150000.00");
    expect(row["Toll Cost"]).toBe("0.00");
    expect(row["Other Cost"]).toBe("0.00");
    expect(row["Total Expense"]).toBe("0.00");
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
    expect(row["Вес (кг)"]).toBe("0.125");
    expect(row["Мин. остаток"]).toBe("10");
  });

  it("товар без цен даёт нули, а не пустые ячейки", () => {
    const [row] = formatProductsForExport([{ code: "К-1", name: "Без цены" }]);
    expect(row["Цена"]).toBe("0.00");
    expect(row["Себестоимость"]).toBe("0.00");
    expect(Object.values(row).join(" ")).not.toMatch(/undefined|NaN/);
  });

  it("агент без имени показывается по номеру, а не пустой строкой", () => {
    // Строка без подписи в отчёте по агентам не даёт понять, о ком речь.
    const [row] = formatAgentsForExport([{ agentId: 7, visits: 3, orders: 2, revenue: "150000" }], 30);
    expect(row["Агент"]).toBe("Agent #7");
    expect(row["№"]).toBe(1);
    expect(row["Период"]).toBe("30 дней");
    expect(row["Total"]).toBe("150000.00");
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
    expect(row["Продажи/день"]).toBe("0.4");
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

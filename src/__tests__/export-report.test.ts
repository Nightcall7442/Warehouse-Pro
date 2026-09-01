// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildExcelSheets, buildPDFHtml, exportToPDF, type ReportData } from "@/lib/export";
import { printElement } from "@/lib/print";

/**
 * Выгрузка отчёта в Excel и PDF.
 *
 * Покрытие обоих файлов было 0%. Это то, что человек уносит из системы наружу
 * и по чему потом принимает решения: остатки по категориям, топ товаров,
 * оборачиваемость. Ошибка тут не роняет приложение — она отдаёт неверную
 * таблицу, и обнаруживается уже в чужой переписке.
 *
 * Проверяется состав листов и колонок (по ним читают), перенос чисел и то,
 * что название товара с угловой скобкой не ломает разметку PDF.
 */

function report(over: Partial<ReportData> = {}): ReportData {
  return {
    byCategory: [
      { category: "Кондитерские", totalProducts: 12, totalUnits: 340, totalValue: 3_000_000, totalRetail: 4_200_000, lowStockCount: 2 },
      { category: "Напитки",      totalProducts: 8,  totalUnits: 120, totalValue: 900_000,   totalRetail: 1_300_000, lowStockCount: 0 },
    ],
    topByValue: [
      { productName: "Печенье овсяное", productCode: "P-1", currentStock: 100, unit: "шт", costValue: 900_000, retailValue: 1_200_000, margin: 300_000 },
    ],
    turnover: [
      { productName: "Печенье овсяное", productCode: "P-1", currentStock: 100, soldQty: 40, turnoverRate: "0.4", daysToSell: 75 },
    ],
    days: 30,
    ...over,
  };
}

describe("выгрузка в Excel", () => {
  it("собирает три листа, а с расходами доставки — четыре", () => {
    // Четвёртый лист появляется только когда данные о приходах есть. Пустой
    // лист «Расходы доставки» читатель принял бы за нулевые расходы.
    expect(buildExcelSheets(report())).toHaveLength(3);

    const withArrivals = buildExcelSheets(report({
      arrivalSummary: {
        totalArrivals: 3, totalFuelCost: 40_000, totalTollCost: 15_000,
        totalOtherCost: 10_000, totalExpense: 65_000, totalUnits: 500,
      },
    }));
    expect(withArrivals).toHaveLength(4);
    expect(withArrivals[3].name).toBe("Расходы доставки");
    expect(withArrivals[3].data[0]).toMatchObject({ fuel: 40_000, tolls: 15_000, total: 65_000 });
  });

  it("листы названы и озаглавлены так, как их читают", () => {
    const sheets = buildExcelSheets(report());
    expect(sheets.map(s => s.name)).toEqual(["Категории", "Топ товаров", "Оборачиваемость"]);
    expect(sheets[0].columns.map(c => c.header)).toEqual(
      ["Категория", "Товаров", "Единиц", "Себестоимость", "Розница", "Низкие остатки"],
    );
  });

  it("каждая колонка листа находит своё значение в строке", () => {
    // Расхождение ключа колонки и ключа данных даёт пустой столбец в файле —
    // молча, без единой ошибки.
    for (const sheet of buildExcelSheets(report())) {
      for (const row of sheet.data) {
        for (const col of sheet.columns) {
          expect(Object.hasOwn(row as object, col.key), `лист «${sheet.name}», колонка «${col.header}» (${col.key})`).toBe(true);
        }
      }
    }
  });

  it("переносит числа как есть, без округления в строку", () => {
    const sheets = buildExcelSheets(report());
    expect(sheets[0].data[0]).toMatchObject({ category: "Кондитерские", units: 340, costValue: 3_000_000 });
    expect(typeof (sheets[0].data[0] as Record<string, unknown>).costValue).toBe("number");
  });

  it("пустой отчёт даёт листы без строк, а не падает", () => {
    const sheets = buildExcelSheets(report({ byCategory: [], topByValue: [], turnover: [] }));
    expect(sheets).toHaveLength(3);
    expect(sheets.every(s => s.data.length === 0)).toBe(true);
  });
});

describe("выгрузка в PDF", () => {
  /** Русская локаль разделяет разряды неразрывным пробелом (U+00A0). */
  const plain = (s: string) => s.replace(/\u00A0/g, " ");

  it("считает итоги по всем категориям", () => {
    const html = plain(buildPDFHtml(report()));
    // 3 000 000 + 900 000 = 3 900 000
    expect(html).toContain("3 900 000");
    // 340 + 120 = 460 единиц
    expect(html).toContain("460");
  });

  it("выводит строки товаров и оборачиваемость", () => {
    const html = buildPDFHtml(report());
    expect(html).toContain("Печенье овсяное");
    expect(html).toContain("0.4");
  });

  it("название товара с разметкой экранируется", () => {
    // Названия товаров и категорий заводят люди. В отчёте, который открывают
    // в браузере, неэкранированное название — это чужая разметка на странице.
    const html = buildPDFHtml(report({
      topByValue: [{
        productName: "<script>alert(1)</script>", productCode: "P-1",
        currentStock: 1, unit: "шт", costValue: 1, retailValue: 1, margin: 0,
      }],
    }));
    expect(html).not.toContain("<script>");
  });

  it("название категории экранируется", () => {
    const html = buildPDFHtml(report({
      byCategory: [{
        category: "<img src=x onerror=alert(1)>", totalProducts: 1, totalUnits: 1,
        totalValue: 1, totalRetail: 1, lowStockCount: 0,
      }],
    }));
    expect(html).not.toContain("<img src=x");
  });
});

describe("окна печати", () => {
  let written = "";
  /** Узел #print-content открытого окна: printElement вставляет клон сюда. */
  let container: HTMLElement;

  beforeEach(() => {
    written = "";
    container = document.createElement("div");
    const fake = {
      document: {
        write: (h: string) => { written += h; },
        close: () => {},
        // printElement ищет контейнер в ОТКРЫТОМ окне и добавляет в него
        // клон печатаемого узла. Без этого метода подделка не воспроизводит
        // сам способ переноса содержимого, и проверка ничего не значит.
        getElementById: (id: string) => (id === "print-content" ? container : null),
      },
      print: () => {}, close: () => {}, onload: null as unknown,
    };
    vi.stubGlobal("open", () => fake);
    vi.stubGlobal("setTimeout", ((fn: () => void) => { void fn; return 0; }) as unknown as typeof setTimeout);
  });

  it("PDF-выгрузка экранирует заголовок", () => {
    exportToPDF("<script>alert(1)</script>", "<p>тело</p>");
    expect(written).not.toContain("<script>alert");
    // Само содержимое передаётся как разметка намеренно — его собирает
    // buildPDFHtml, а не пользователь.
    expect(written).toContain("<p>тело</p>");
  });

  it("печать элемента берёт содержимое именно указанного узла", () => {
    document.body.innerHTML = `
      <div id="нужный">нужное содержимое</div>
      <div id="лишний">лишнее содержимое</div>`;

    printElement("нужный", "Отчёт");
    expect(container.textContent).toContain("нужное содержимое");
    expect(container.textContent).not.toContain("лишнее содержимое");
  });

  it("печать несуществующего элемента ничего не открывает", () => {
    document.body.innerHTML = "";
    expect(() => printElement("нет-такого", "Отчёт")).not.toThrow();
    expect(written).toBe("");
    expect(container.childNodes).toHaveLength(0);
  });
});

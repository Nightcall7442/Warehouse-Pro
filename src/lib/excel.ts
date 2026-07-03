/**
 * Excel export — профессиональный, со стилями.
 * Использует SheetJS через ES-import (не require).
 * Добавляет: заголовок отчёта, заморозку строки, ширины колонок,
 * цвета статусов, итоговую строку.
 */
import * as XLSX from "xlsx";

type Row = Record<string, string | number | null | undefined>;

// Цвета статусов для ячеек
const STATUS_FILLS: Record<string, string> = {
  new:        "C7D2FE", // indigo-200
  processing: "FDE68A", // amber-200
  completed:  "A7F3D0", // green-200
  cancelled:  "FECACA", // red-200
  active:     "A7F3D0",
  inactive:   "FECACA",
  pending:    "FDE68A",
  unloading:  "BAE6FD",
  low:        "FECACA",
  ok:         "A7F3D0",
};

// Колонки с числовым форматом
const CURRENCY_COLS = new Set(["Total", "Subtotal", "Discount", "Revenue",
  "Fuel Cost", "Toll Cost", "Other Cost", "Total Expense", "Unit Price",
  "Available", "Reserved", "Total Stock", "Reorder Point", "Amount"]);

const STATUS_COLS = new Set(["Status", "Low Stock"]);

export function exportToExcel(
  rows: Row[],
  filename: string,
  sheetName = "Данные",
  reportTitle?: string,
) {
  if (!rows.length) return;

  const wb = XLSX.utils.book_new();
  const headers = Object.keys(rows[0]);

  // Данные для листа: заголовок отчёта (2 строки) + шапка + данные + итог
  const titleDate = new Date().toLocaleDateString("ru-RU", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const sheetData: unknown[][] = [
    [reportTitle ?? `Отчёт: ${sheetName}`, ...Array(headers.length - 1).fill("")],
    [`Сформирован: ${titleDate}`, ...Array(headers.length - 1).fill("")],
    [], // пустая строка-разделитель
    headers,
    ...rows.map(r => headers.map(h => r[h] ?? "")),
  ];

  const dataStartRow = 4; // 0-based: шапка в строке 4 (5-я)

  // Итоговая строка для числовых колонок
  const totals: unknown[] = headers.map(h => {
    if (CURRENCY_COLS.has(h)) {
      const sum = rows.reduce((acc, r) => acc + Number(r[h] ?? 0), 0);
      return sum.toFixed(2);
    }
    return "";
  });
  totals[0] = "ИТОГО";
  sheetData.push(totals);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // ── Ширины колонок ──────────────────────────────────────────────────────────
  const colWidths = headers.map(h => {
    const max = Math.max(
      h.length,
      ...rows.map(r => String(r[h] ?? "").length),
    );
    return { wch: Math.min(max + 3, 40) };
  });
  ws["!cols"] = colWidths;

  // ── Заморозка первых 5 строк (заголовок + шапка) ───────────────────────────
  ws["!freeze"] = { xSplit: 0, ySplit: dataStartRow + 1 };

  // ── Стили ──────────────────────────────────────────────────────────────────
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const TITLE_FONT   = { bold: true, sz: 13, color: { rgb: "1E293B" } };
  const HEADER_FONT  = { bold: true, sz: 11, color: { rgb: "FFFFFF" } };
  const HEADER_FILL  = { fgColor: { rgb: "4F46E5" } };  // indigo-600
  const TOTAL_FONT   = { bold: true, sz: 11 };
  const TOTAL_FILL   = { fgColor: { rgb: "E0E7FF" } };   // indigo-100
  const BORDER_THIN  = { style: "thin", color: { rgb: "CBD5E1" } };
  const BORDER_ALL   = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddr]) ws[cellAddr] = { t: "z", v: "" };
      const cell = ws[cellAddr];

      // Строка 0: заголовок отчёта
      if (R === 0) {
        cell.s = { font: TITLE_FONT, alignment: { horizontal: "left" } };
      }
      // Строка 1: дата
      else if (R === 1) {
        cell.s = { font: { sz: 10, color: { rgb: "64748B" } } };
      }
      // Строка с шапкой таблицы (dataStartRow)
      else if (R === dataStartRow) {
        cell.s = {
          font:      HEADER_FONT,
          fill:      HEADER_FILL,
          border:    BORDER_ALL,
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
        };
      }
      // Строки данных
      else if (R > dataStartRow && R < range.e.r) {
        const isEven = (R - dataStartRow) % 2 === 0;
        const headerName = headers[C];
        const cellVal    = String(cell.v ?? "");

        let fill: { fgColor: { rgb: string } } = { fgColor: { rgb: isEven ? "F8FAFC" : "FFFFFF" } };

        // Цвет по статусу
        if (STATUS_COLS.has(headerName)) {
          const statusKey = cellVal.toLowerCase().replace(/\s+/g, "_");
          const rgb = STATUS_FILLS[statusKey] ?? STATUS_FILLS[cellVal.toLowerCase()];
          if (rgb) fill = { fgColor: { rgb } };
        }

        cell.s = {
          fill,
          border:    BORDER_ALL,
          alignment: { vertical: "center", horizontal: CURRENCY_COLS.has(headerName) ? "right" : "left" },
          numFmt:    CURRENCY_COLS.has(headerName) ? "#,##0.00" : undefined,
        };
      }
      // Итоговая строка (последняя)
      else if (R === range.e.r) {
        cell.s = {
          font:      TOTAL_FONT,
          fill:      TOTAL_FILL,
          border:    BORDER_ALL,
          alignment: { horizontal: CURRENCY_COLS.has(headers[C]) ? "right" : "left", vertical: "center" },
        };
      }
    }
  }

  // Объединяем ячейки заголовка
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Fallback CSV (на случай совсем старого окружения)
export function exportToCSV(rows: Row[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h] ?? "";
        return String(v).includes(",") ? `"${v}"` : v;
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Форматтеры ────────────────────────────────────────────────────────────────

export function formatOrdersForExport(orders: any[]) {
  return orders.map(o => ({
    "Заказ №":   o.orderNumber,
    "Дата":      o.createdAt ? new Date(o.createdAt).toLocaleDateString("ru-RU") : "",
    "Магазин":   o.shopName ?? "",
    "Агент":     o.agentName ?? "",
    "Status":    o.status ?? "",
    "Сумма":     Number(o.subtotal ?? 0).toFixed(2),
    "Скидка":    Number(o.discount ?? 0).toFixed(2),
    "Total":     Number(o.total ?? 0).toFixed(2),
    "Примечания":o.notes ?? "",
  }));
}

export function formatArrivalsForExport(arrivals: any[]) {
  return arrivals.map(a => ({
    "Приход №":      a.arrivalNumber,
    "Дата":          a.arrivalDate ? new Date(a.arrivalDate).toLocaleDateString("ru-RU") : "",
    "Грузовик":      a.truckId ?? "",
    "Водитель":      a.driverName ?? "",
    "Телефон":       a.driverPhone ?? "",
    "Status":        a.status ?? "",
    "Fuel Cost":     Number(a.fuelCost ?? 0).toFixed(2),
    "Toll Cost":     Number(a.tollCost ?? 0).toFixed(2),
    "Other Cost":    Number(a.otherCost ?? 0).toFixed(2),
    "Total Expense": Number(a.totalExpense ?? 0).toFixed(2),
    "Примечания":    a.notes ?? "",
  }));
}

export function formatWarehouseForExport(stock: any[]) {
  return stock.map(s => ({
    "Товар":         s.productName ?? "",
    "Код":           s.productCode ?? "",
    "Категория":     s.category ?? "",
    "Единица":       s.unit ?? "",
    "Цена продажи":  Number(s.unitPrice ?? 0).toFixed(2),
    "Себестоимость": Number(s.costPrice ?? 0).toFixed(2),
    "Всего":         Number(s.currentStock ?? 0).toFixed(2),
    "Резерв":        Number(s.reserved ?? 0).toFixed(2),
    "Доступно":      Number(s.available ?? 0).toFixed(2),
    "Порог":         Number(s.reorderPoint ?? 0).toFixed(0),
    "Стоимость":     (Number(s.currentStock ?? 0) * Number(s.costPrice ?? 0)).toFixed(2),
    "Low Stock":     Number(s.available ?? 0) < Number(s.reorderPoint ?? 0) ? "low" : "ok",
  }));
}

export function formatMovementsForExport(movements: any[]) {
  return movements.map(m => ({
    "Дата":      m.createdAt ? new Date(m.createdAt).toLocaleDateString("ru-RU") : "",
    "Товар":     m.productName ?? "",
    "Status":    m.type ?? "",
    "Количество":Number(m.quantity ?? 0).toFixed(2),
    "Ссылка":    m.referenceType ? `${m.referenceType} #${m.referenceId}` : "",
    "Примечания":m.notes ?? "",
  }));
}

export function formatAgentsForExport(agents: any[], days: number) {
  return agents.map((a, i) => ({
    "№":       i + 1,
    "Агент":   a.agentName ?? `Agent #${a.agentId}`,
    "Визиты":  Number(a.visits),
    "Заказы":  Number(a.orders),
    "Total":   Number(a.revenue ?? 0).toFixed(2),
    "Период":  `${days} дней`,
  }));
}

export function formatShopsForExport(shops: any[]) {
  return shops.map(s => ({
    "Название":    s.name ?? "",
    "Владелец":    s.ownerName ?? "",
    "Телефон":     s.phone ?? "",
    "Город":       s.city ?? "",
    "Район":       s.district ?? "",
    "Адрес":       s.address ?? "",
    "Агент":       s.agentName ?? "",
    "Долг":        Number(s.debt ?? 0).toFixed(0),
    "Status":      s.status ?? "",
  }));
}

export function formatUsersForExport(users: any[]) {
  return users.map(u => ({
    "Имя":         u.name ?? "",
    "Email":       u.email ?? "",
    "Телефон":     u.phone ?? "",
    "Роль":        u.role ?? "",
    "Status":      u.status ?? "",
    "Последний вход": u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString("ru-RU") : "",
  }));
}

export function formatStockValuationForExport(stock: any[]) {
  return stock.map(s => ({
    "Товар":         s.productName ?? "",
    "Код":           s.productCode ?? "",
    "Единица":       s.unit ?? "",
    "Остаток":       Number(s.currentStock ?? 0).toFixed(2),
    "Себестоимость": Number(s.costPrice ?? 0).toFixed(2),
    "Цена продажи":  Number(s.unitPrice ?? 0).toFixed(2),
    "Стоимость (себест.)": (Number(s.currentStock ?? 0) * Number(s.costPrice ?? 0)).toFixed(2),
    "Стоимость (розн.)":  (Number(s.currentStock ?? 0) * Number(s.unitPrice ?? 0)).toFixed(2),
  }));
}

export function formatDeadStockForExport(items: any[]) {
  return items.map(s => ({
    "Товар":         s.productName ?? "",
    "Код":           s.productCode ?? "",
    "Категория":     s.category ?? "",
    "Единица":       s.unit ?? "",
    "Остаток":       Number(s.currentStock ?? 0).toFixed(2),
    "Себестоимость": Number(s.costPrice ?? 0).toFixed(2),
    "Цена продажи":  Number(s.unitPrice ?? 0).toFixed(2),
    "Стоимость":     Number(s.value ?? 0).toFixed(2),
    "Последний заказ": s.lastOrderDate ? new Date(s.lastOrderDate).toLocaleDateString("ru-RU") : "Никогда",
    "Дней без продаж": Number(s.daysSinceOrder ?? 99999),
  }));
}

export function formatReorderForExport(items: any[]) {
  return items.map(s => ({
    "Товар":         s.productName ?? "",
    "Код":           s.productCode ?? "",
    "Единица":       s.unit ?? "",
    "Остаток":       Number(s.currentStock ?? 0).toFixed(2),
    "Порог":         Number(s.reorderPoint ?? 0).toFixed(2),
    "Продажи/день":  Number(s.avgDailySales ?? 0).toFixed(1),
    "Дней до конца": Number(s.daysUntilStockout ?? 0),
    "Заказать":      Number(s.suggestedQty ?? 0),
    "Стоимость":     Number(s.suggestedCost ?? 0).toFixed(2),
  }));
}

export function formatPnLForExport(data: {
  revenue: number; cogs: number; grossProfit: number; grossMargin: number;
  transportExpenses: number; netProfit: number; netMargin: number;
  products: any[];
}) {
  const rows: Row[] = [
    { Показатель: "Выручка", Сумма: data.revenue.toFixed(0) },
    { Показатель: "Себестоимость (COGS)", Сумма: data.cogs.toFixed(0) },
    { Показатель: "Валовая прибыль", Сумма: data.grossProfit.toFixed(0) },
    { Показатель: "Валовая маржа", Сумма: `${data.grossMargin.toFixed(1)}%` },
    { Показатель: "Расходы на доставку", Сумма: data.transportExpenses.toFixed(0) },
    { Показатель: "Чистая прибыль", Сумма: data.netProfit.toFixed(0) },
    { Показатель: "Чистая маржа", Сумма: `${data.netMargin.toFixed(1)}%` },
    {},
    { Показатель: "--- ПО ТОВАРАМ ---" },
  ];
  data.products.forEach(p => {
    const revenue = Number(p.totalRevenue);
    const cost = Number(p.totalCost);
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    rows.push({
      Показатель: p.productName,
      "Объём": Number(p.totalQty).toFixed(0),
      Выручка: revenue.toFixed(0),
      "Себестоимость": cost.toFixed(0),
      Прибыль: profit.toFixed(0),
      "Маржа %": `${margin.toFixed(0)}%`,
    });
  });
  return rows;
}

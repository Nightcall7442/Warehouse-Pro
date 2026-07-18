/**
 * Excel export — профессиональный, со стилями.
 * Использует ExcelJS (заменяет уязвимый SheetJS/xlsx).
 * Добавляет: заголовок отчёта, ширины колонок,
 * цвета статусов, итоговую строку.
 */
import ExcelJS from "exceljs";

type Row = Record<string, string | number | null | undefined>;

// Цвета статусов для ячеек
const STATUS_COLORS: Record<string, string> = {
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

export async function exportToExcel(
  rows: Row[],
  filename: string,
  sheetName = "Данные",
  reportTitle?: string,
) {
  if (!rows.length) return;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const headers = Object.keys(rows[0]);

  // Title date
  const titleDate = new Date().toLocaleDateString("ru-RU", {
    day: "2-digit", month: "long", year: "numeric",
  });

  // Title row
  ws.addRow([reportTitle ?? `Отчёт: ${sheetName}`, ...Array(headers.length - 1).fill("")]);
  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.font = { bold: true, size: 13, color: { argb: "FF1E293B" } };

  // Date row
  ws.addRow([`Сформирован: ${titleDate}`, ...Array(headers.length - 1).fill("")]);
  ws.mergeCells(2, 1, 2, headers.length);
  const dateCell = ws.getCell(2, 1);
  dateCell.font = { size: 10, color: { argb: "FF64748B" } };

  // Empty separator
  ws.addRow([]);

  // Header row
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 20;

  const dataStartRow = 5; // 1-based: row 5

  // Data rows
  rows.forEach((r, rowIdx) => {
    const dataRow = ws.addRow(headers.map(h => r[h] ?? ""));
    const isEven = rowIdx % 2 === 0;

    dataRow.eachCell((cell, colNumber) => {
      const headerName = headers[colNumber - 1];
      const cellVal = String(cell.value ?? "");

      // Status coloring
      if (STATUS_COLS.has(headerName)) {
        const statusKey = cellVal.toLowerCase().replace(/\s+/g, "_");
        const rgb = STATUS_COLORS[statusKey] ?? STATUS_COLORS[cellVal.toLowerCase()];
        if (rgb) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${rgb}` } };
        }
      } else {
        // Alternating row colors
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" } };
      }

      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };

      // Currency formatting
      if (CURRENCY_COLS.has(headerName)) {
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    });
  });

  // Totals row
  const totals: (string | number)[] = headers.map(h => {
    if (CURRENCY_COLS.has(h)) {
      const sum = rows.reduce((acc, r) => acc + Number(r[h] ?? 0), 0);
      return sum.toFixed(2);
    }
    return "";
  });
  totals[0] = "ИТОГО";
  const totalRow = ws.addRow(totals);
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    const headerName = headers[colNumber - 1];
    cell.alignment = { horizontal: CURRENCY_COLS.has(headerName) ? "right" : "left", vertical: "middle" };
  });

  // Column widths
  ws.columns = headers.map((h, i) => {
    const max = Math.max(
      h.length,
      ...rows.map(r => String(r[h] ?? "").length),
    );
    return { width: Math.min(max + 3, 40) };
  });

  // Generate and download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
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

export function formatOrdersForExport(orders: Record<string, unknown>[]) {
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

export function formatArrivalsForExport(arrivals: Record<string, unknown>[]) {
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

export function formatWarehouseForExport(stock: Record<string, unknown>[]) {
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

export function formatMovementsForExport(movements: Record<string, unknown>[]) {
  return movements.map(m => ({
    "Дата":      m.createdAt ? new Date(m.createdAt).toLocaleDateString("ru-RU") : "",
    "Товар":     m.productName ?? "",
    "Status":    m.type ?? "",
    "Количество":Number(m.quantity ?? 0).toFixed(2),
    "Ссылка":    m.referenceType ? `${m.referenceType} #${m.referenceId}` : "",
    "Примечания":m.notes ?? "",
  }));
}

export function formatAgentsForExport(agents: Record<string, unknown>[], days: number) {
  return agents.map((a, i) => ({
    "№":       i + 1,
    "Агент":   a.agentName ?? `Agent #${a.agentId}`,
    "Визиты":  Number(a.visits),
    "Заказы":  Number(a.orders),
    "Total":   Number(a.revenue ?? 0).toFixed(2),
    "Период":  `${days} дней`,
  }));
}

export function formatShopsForExport(shops: Record<string, unknown>[]) {
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

export function formatProductsForExport(products: Record<string, unknown>[]) {
  return products.map(p => ({
    "Код":         p.code ?? "",
    "Штрихкод":    p.barcode ?? "",
    "Название":    p.name ?? "",
    "Категория":   p.category ?? "",
    "Ед.":         p.unit ?? "",
    "Вес (кг)":    Number(p.unitWeight ?? 0).toFixed(3),
    "Себестоимость": Number(p.costPrice ?? 0).toFixed(2),
    "Цена":        Number(p.unitPrice ?? 0).toFixed(2),
    "Остаток":     Number(p.currentStock ?? 0).toFixed(2),
    "Мин. остаток": Number(p.reorderPoint ?? 0).toFixed(0),
    "Статус":      p.status ?? "",
  }));
}

export function formatUsersForExport(users: Record<string, unknown>[]) {
  return users.map(u => ({
    "Имя":         u.name ?? "",
    "Email":       u.email ?? "",
    "Телефон":     u.phone ?? "",
    "Роль":        u.role ?? "",
    "Status":      u.status ?? "",
    "Последний вход": u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString("ru-RU") : "",
  }));
}

export function formatStockValuationForExport(stock: Record<string, unknown>[]) {
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

export function formatDeadStockForExport(items: Record<string, unknown>[]) {
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

export function formatReorderForExport(items: Record<string, unknown>[]) {
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
  products: Record<string, unknown>[];
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

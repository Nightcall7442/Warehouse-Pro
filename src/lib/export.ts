import * as XLSX from "xlsx";

/**
 * Export data to Excel (.xlsx) file.
 * @param sheets - Array of { name, data, columns }
 */
export function exportToExcel(sheets: Array<{
  name: string;
  data: Record<string, unknown>[];
  columns: Array<{ key: string; header: string; width?: number }>;
}>) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // Build rows with headers
    const rows = sheet.data.map(row =>
      Object.fromEntries(sheet.columns.map(col => [col.header, row[col.key]]))
    );

    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws["!cols"] = sheet.columns.map(col => ({
      wch: col.width ?? Math.max(col.header.length, 12),
    }));

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  XLSX.writeFile(wb, `warehouse-report-${new Date().toISOString().split("T")[0]}.xlsx`);
}

/**
 * Export data to CSV file.
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  columns: Array<{ key: string; header: string }>,
  filename: string,
) {
  const header = columns.map(c => c.header).join(";");
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key];
      const str = String(val ?? "");
      // Escape semicolons and quotes
      return str.includes(";") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(";")
  );

  const csv = "\uFEFF" + header + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}-${new Date().toISOString().split("T")[0]}.csv`);
}

/**
 * Export to PDF via browser print dialog with print-optimized layout.
 */
export function exportToPDF(title: string, contentHtml: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; color: #111; font-size: 12px; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 12px; margin-bottom: 24px; }
        .section { margin-bottom: 24px; }
        .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e5e5; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        th { text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; border-bottom: 2px solid #e5e5e5; font-weight: 600; }
        td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
        tr:nth-child(even) td { background: #fafafa; }
        .right { text-align: right; }
        .bold { font-weight: 600; }
        .total { border-top: 2px solid #111; font-weight: 700; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .kpi { padding: 12px; border: 1px solid #e5e5e5; border-radius: 8px; }
        .kpi-label { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
        .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div class="subtitle">Warehouse Pro — ${new Date().toLocaleDateString("ru")}</div>
      ${contentHtml}
      <script>window.onload = () => { window.print(); }</script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Report builders ──────────────────────────────────────────────────────────
export interface ReportData {
  byCategory: Array<{ category: string; totalProducts: number; totalUnits: number; totalValue: number; totalRetail: number; lowStockCount: number }>;
  topByValue: Array<{ productName: string; productCode: string; currentStock: number; unit: string; costValue: number; retailValue: number; margin: number }>;
  turnover: Array<{ productName: string; productCode: string; currentStock: number; soldQty: number; turnoverRate: string; daysToSell: number }>;
  arrivalSummary?: { totalArrivals: number; totalFuelCost: number; totalTollCost: number; totalOtherCost: number; totalExpense: number; totalUnits: number };
  days: number;
}

export function buildExcelSheets(data: ReportData) {
  const sheets = [];

  // Sheet 1: Stock by category
  sheets.push({
    name: "Категории",
    data: data.byCategory.map(c => ({
      category: c.category,
      products: c.totalProducts,
      units: c.totalUnits,
      costValue: c.totalValue,
      retailValue: c.totalRetail,
      lowStock: c.lowStockCount,
    })),
    columns: [
      { key: "category", header: "Категория", width: 25 },
      { key: "products", header: "Товаров", width: 12 },
      { key: "units", header: "Единиц", width: 12 },
      { key: "costValue", header: "Себестоимость", width: 18 },
      { key: "retailValue", header: "Розница", width: 18 },
      { key: "lowStock", header: "Низкие остатки", width: 15 },
    ],
  });

  // Sheet 2: Top products
  sheets.push({
    name: "Топ товаров",
    data: data.topByValue.map(p => ({
      name: p.productName,
      code: p.productCode,
      stock: p.currentStock,
      unit: p.unit,
      costValue: p.costValue,
      retailValue: p.retailValue,
      margin: p.margin,
    })),
    columns: [
      { key: "name", header: "Товар", width: 30 },
      { key: "code", header: "Код", width: 15 },
      { key: "stock", header: "Остаток", width: 12 },
      { key: "unit", header: "Ед.", width: 8 },
      { key: "costValue", header: "Себестоимость", width: 18 },
      { key: "retailValue", header: "Розница", width: 18 },
      { key: "margin", header: "Маржа", width: 15 },
    ],
  });

  // Sheet 3: Turnover
  sheets.push({
    name: "Оборачиваемость",
    data: data.turnover.map(p => ({
      name: p.productName,
      code: p.productCode,
      stock: p.currentStock,
      sold: p.soldQty,
      rate: p.turnoverRate,
      daysToSell: p.daysToSell,
    })),
    columns: [
      { key: "name", header: "Товар", width: 30 },
      { key: "code", header: "Код", width: 15 },
      { key: "stock", header: "Остаток", width: 12 },
      { key: "sold", header: "Продано", width: 12 },
      { key: "rate", header: "Коэфф.", width: 10 },
      { key: "daysToSell", header: "Дней до продажи", width: 15 },
    ],
  });

  // Sheet 4: Arrival costs (if available)
  if (data.arrivalSummary) {
    sheets.push({
      name: "Расходы доставки",
      data: [{
        arrivals: data.arrivalSummary.totalArrivals,
        units: data.arrivalSummary.totalUnits,
        fuel: data.arrivalSummary.totalFuelCost,
        tolls: data.arrivalSummary.totalTollCost,
        other: data.arrivalSummary.totalOtherCost,
        total: data.arrivalSummary.totalExpense,
      }],
      columns: [
        { key: "arrivals", header: "Приходов", width: 12 },
        { key: "units", header: "Единиц", width: 12 },
        { key: "fuel", header: "Топливо", width: 15 },
        { key: "tolls", header: "Дороги", width: 15 },
        { key: "other", header: "Прочее", width: 15 },
        { key: "total", header: "Итого", width: 18 },
      ],
    });
  }

  return sheets;
}

export function buildPDFHtml(data: ReportData) {
  const fmt = (n: number) => n.toLocaleString("ru");
  let html = "";

  // KPIs
  const totalValue = data.byCategory.reduce((s, c) => s + Number(c.totalValue ?? 0), 0);
  const totalRetail = data.byCategory.reduce((s, c) => s + Number(c.totalRetail ?? 0), 0);
  const totalUnits = data.byCategory.reduce((s, c) => s + Number(c.totalUnits ?? 0), 0);
  const lowStock = data.byCategory.reduce((s, c) => s + Number(c.lowStockCount ?? 0), 0);

  html += `<div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Себестоимость</div><div class="kpi-value">${fmt(totalValue)} сум</div></div>
    <div class="kpi"><div class="kpi-label">Розница</div><div class="kpi-value">${fmt(totalRetail)} сум</div></div>
    <div class="kpi"><div class="kpi-label">Единицы</div><div class="kpi-value">${fmt(totalUnits)}</div></div>
    <div class="kpi"><div class="kpi-label">Низкие остатки</div><div class="kpi-value">${lowStock}</div></div>
  </div>`;

  // Stock by category
  html += `<div class="section"><h2>Остатки по категориям</h2>
    <table><thead><tr><th>Категория</th><th class="right">Товаров</th><th class="right">Единиц</th><th class="right">Себестоимость</th><th class="right">Розница</th><th class="right">Низкие</th></tr></thead><tbody>`;
  for (const c of data.byCategory) {
    html += `<tr><td>${c.category}</td><td class="right">${c.totalProducts}</td><td class="right">${fmt(Number(c.totalUnits))}</td><td class="right">${fmt(Number(c.totalValue))}</td><td class="right">${fmt(Number(c.totalRetail))}</td><td class="right">${c.lowStockCount}</td></tr>`;
  }
  html += `</tbody></table></div>`;

  // Top products
  html += `<div class="section"><h2>Топ товаров по стоимости</h2>
    <table><thead><tr><th>Товар</th><th>Код</th><th class="right">Остаток</th><th class="right">Стоимость</th><th class="right">Маржа</th></tr></thead><tbody>`;
  for (const p of data.topByValue.slice(0, 10)) {
    html += `<tr><td>${p.productName}</td><td>${p.productCode}</td><td class="right">${fmt(Number(p.currentStock))} ${p.unit}</td><td class="right">${fmt(Number(p.costValue))}</td><td class="right">${fmt(Number(p.margin))}</td></tr>`;
  }
  html += `</tbody></table></div>`;

  // Turnover
  html += `<div class="section"><h2>Оборачиваемость (за ${data.days} дней)</h2>
    <table><thead><tr><th>Товар</th><th class="right">Остаток</th><th class="right">Продано</th><th class="right">Коэфф.</th><th class="right">Дней до продажи</th></tr></thead><tbody>`;
  for (const p of data.turnover.slice(0, 10)) {
    html += `<tr><td>${p.productName}</td><td class="right">${fmt(Number(p.currentStock))}</td><td class="right">${fmt(Number(p.soldQty))}</td><td class="right bold">${p.turnoverRate}x</td><td class="right">${p.daysToSell < 999 ? p.daysToSell : "—"}</td></tr>`;
  }
  html += `</tbody></table></div>`;

  return html;
}

/**
 * Excel export — профессиональный, со стилями.
 * Использует ExcelJS (заменяет уязвимый SheetJS/xlsx).
 * Добавляет: заголовок отчёта, ширины колонок,
 * цвета статусов, итоговую строку.
 */
import ExcelJS from "exceljs";
import { movementKind, movementDocument, movementNote } from "@/lib/stock-movement-text";
import { formatQty } from "@/lib/format";
import { notify } from "@/lib/toast";
import { unitShort } from "@/lib/units";
import { cssVar } from "@/lib/css-var";
import {
  labelled, ACTIVE_STATUS_LABEL, ARRIVAL_STATUS_LABEL,
  ORDER_STATUS_LABEL, ROLE_LABEL, STOCK_LEVEL_LABEL,
} from "@/lib/entity-labels";

type Row = Record<string, string | number | null | undefined>;

/**
 * Цвет шапки выгрузки — арендатора, а не системы.
 *
 * Здесь стояло FF4F46E5 — индиго, которого нет ни в палитре приложения, ни
 * у арендатора. Файл уходит наружу: в нём цвет должен быть тот же, что на
 * экране. Берём его оттуда же, откуда берёт вся страница, — из переменной
 * темы, которую useBranding проставляет по настройкам арендатора.
 *
 * ExcelJS ждёт AARRGGBB, тема даёт #rrggbb. Всё, что не похоже на
 * шестизначный цвет (например color-mix или пустая строка), заменяется
 * запасным: файл не должен падать из-за оформления.
 */
function headerArgb(): string {
  const fallback = "FF4F46E5";
  const hex = cssVar("--color-primary", "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? "FF" + hex.slice(1).toUpperCase() : fallback;
}

// The formatters below take Record<string, unknown> and read fields off it, so
// `row.someField ?? ""` types as {} rather than as a string, and {} is not a
// cell. String() is what the value has to become anyway — a spreadsheet holds
// text or a number — and it keeps Row strict, which is what caught the export
// that shipped a blank column because it read a field name that did not exist.

// Цвета статусов для ячеек
/*
  Цвет клетки состояния. Ключи — то, что человек читает в файле.

  Раньше ключами были коды из базы («delivered», «low»), потому что и в
  клетках стояли коды. Теперь в клетках слова, и красить надо по ним.
*/
const STATUS_COLORS: Record<string, string> = {
  "новый":        "C7D2FE",
  "в обработке":  "FDE68A",
  "отгружен":     "DDD6FE",
  "ожидает":      "FED7AA",
  "доставлен":    "A7F3D0",
  "отменён":      "FECACA",
  "возвращён":    "FECACA",
  "работает":     "A7F3D0",
  "не работает":  "FECACA",
  "приостановлен":"FED7AA",
  "разгружается": "BAE6FD",
  "принят":       "A7F3D0",
  "мало":         "FECACA",
  "достаточно":   "A7F3D0",
  // Виды движения склада — колонка «Вид».
  "приход":       "A7F3D0",
  "расход":       "FECACA",
  "правка":       "FDE68A",
};

/*
  Колонки, которые имеет смысл складывать в строке «ИТОГО».

  ── Что было ────────────────────────────────────────────────────────────────

  Набор был выписан ПО-АНГЛИЙСКИ: «Total», «Fuel Cost», «Available»,
  «Reorder Point». А форматтеры ниже отдают русские заголовки — «Сумма»,
  «Топливо», «Доступно», «Порог». Совпадений почти не было, и всё, что
  привязано к этому набору, просто не срабатывало: ни числовой формат, ни
  выравнивание по правому краю, ни сама строка итогов. В выгрузке по складу
  не суммировалось НИ ОДНО денежное поле.

  ── Что складывать, а что нет ───────────────────────────────────────────────

  Здесь только величины, у которых сумма имеет смысл: деньги и количества.
  Цена за единицу, порог, вес, «дней до конца» сюда не входят намеренно —
  сумма цен по складу не значит ничего, а строка «ИТОГО» с таким числом хуже
  пустой: её прочитают.
*/
const SUMMABLE_COLS = new Set([
  // Деньги
  "Сумма", "Скидка", "Итого", "Выручка", "Долг", "Стоимость",
  "Стоимость (себест.)", "Стоимость (розн.)", "Себестоимость всего",
  "Топливо", "Платные дороги", "Прочее", "Расходы всего",
  // Возрастные корзины долга — их складывают по столбцу, чтобы увидеть,
  // сколько всего висит в каждом возрасте (см. lib/debtors-export.ts).
  "до 7 дней", "8–30 дней", "31–60 дней", "больше 60", "Не привязано к заказу",
  // Количества
  "Остаток", "Резерв", "Доступно", "Всего", "Количество",
  "Визиты", "Заказы", "Заказать",
]);

/**
 * Колонки-состояния: их клетки красятся по значению.
 *
 * Значения теперь русские (см. lib/entity-labels), поэтому и ключи цветов
 * ниже — русские. Прежний набор ждал «Status» и «Low Stock», которых в
 * заголовках уже не было.
 */
const STATUS_COLS = new Set(["Статус", "Запас", "Вид"]);

/**
 * Сколько знаков после запятой показывать в колонке.
 *
 * Точность раньше вшивалась в само значение: `.toFixed(3)` у веса,
 * `.toFixed(1)` у продаж в день. Это и делало клетку текстом. Значение теперь
 * число, а точность — свойство ОТОБРАЖЕНИЯ, то есть числовой формат клетки.
 *
 * Исключения по существу: у веса третий знак решает (0.125 кг и 0.13 кг —
 * разный товар), а «продажи в день» с одним знаком заведены нарочно, чтобы
 * 0.4 не округлилось до нуля и товар не выпал из дозаказа.
 */
const COLUMN_NUM_FMT: Record<string, string> = {
  "Вес (кг)":     "#,##0.000",
  "Продажи/день": "#,##0.0",
};

function numFmtFor(header: string, value: number): string {
  const special = COLUMN_NUM_FMT[header];
  if (special) return special;
  // Целое показывается целым: «10», а не «10.00» — в столбце порогов лишние
  // нули только мешают.
  return Number.isInteger(value) ? "#,##0" : "#,##0.00";
}

export async function exportToExcel(
  rows: Row[],
  filename: string,
  sheetName = "Данные",
  reportTitle?: string,
) {
  // Пустой набор — это отказ, а не успех.
  //
  // Раньше здесь стоял тихий выход: кнопка нажата, файла нет, объяснения нет.
  // Отличить это от сломанной кнопки человек не мог. Сообщение показывается
  // здесь, а не у вызывающих: выгрузку зовут из девятнадцати мест, и в
  // большинстве из них это одна строка в обработчике нажатия без разбора
  // ошибок. Одно место — значит ни одно из девятнадцати не промолчит.
  if (!rows.length) {
    notify.info("Нет данных для выгрузки");
    return;
  }

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
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerArgb() } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 20;

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

      /*
        Числовой формат — по ТИПУ значения, а не по названию колонки.

        Раньше формат вешался по списку заголовков, и стоило форматтеру
        назвать колонку иначе — клетка оставалась без формата. Хуже того:
        сами значения приходили СТРОКАМИ («5520500.00»), а строке формат не
        применяется вовсе. Excel помечал такие клетки зелёным уголком «число
        сохранено как текст», их нельзя было ни сложить, ни отсортировать, ни
        построить по ним диаграмму — то есть файл открывался, но работать в
        нём было нельзя.

        Теперь форматтеры отдают числа числами, а здесь у числа появляется
        разделитель разрядов и выравнивание по правому краю: в столбце цифры
        встают разряд под разряд.
      */
      if (typeof cell.value === "number") {
        cell.numFmt = numFmtFor(headerName, cell.value);
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    });
  });

  /*
    Строка «ИТОГО» — числами, а не строками.

    Стояло `sum.toFixed(2)`, то есть в клетку итога уходил ТЕКСТ. Итог нельзя
    было ни продолжить формулой, ни сравнить с другим файлом; Excel помечал
    его тем же «число сохранено как текст», что и остальные суммы.

    Складываются только те колонки, у которых сумма осмысленна (SUMMABLE_COLS
    выше): сумма цен за единицу или порогов запаса — число, которое кто-то
    обязательно прочитает как настоящее.
  */
  const totals: (string | number)[] = headers.map(h => {
    if (!SUMMABLE_COLS.has(h)) return "";
    const sum = rows.reduce((acc, r) => {
      const v = r[h];
      return acc + (typeof v === "number" ? v : Number(v ?? 0) || 0);
    }, 0);
    return Number(sum.toFixed(2));
  });
  totals[0] = "ИТОГО";
  const totalRow = ws.addRow(totals);
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 11 };
    if (typeof cell.value === "number") {
      cell.numFmt = numFmtFor(headers[colNumber - 1], cell.value);
    }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    const headerName = headers[colNumber - 1];
    cell.alignment = { horizontal: SUMMABLE_COLS.has(headerName) ? "right" : "left", vertical: "middle" };
  });

  /*
    Лист, в котором можно работать, а не только смотреть.

    Ничего этого не было: отчёт на пятьсот строк прокручивался вместе с
    шапкой (через экран уже не понять, что за колонка), не фильтровался, а при
    печати со второй страницы превращался в столбцы безымянных чисел — ровно
    то, на что владелец жаловался про бумажные документы.

    Шапка на четвёртой строке: выше заголовок отчёта, дата и пустая строка.
  */
  const HEADER_ROW = 4;
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: headers.length },
  };
  ws.pageSetup = {
    orientation: headers.length > 6 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  // Шапка повторяется на каждой печатной странице.
  ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;

  // Column widths
  ws.columns = headers.map((h) => {
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

// Здесь была exportToCSV — «запасной вариант на случай совсем старого окружения».
// Её не вызывали ниоткуда, и она была сломана сильнее одноимённой из export.ts:
// кавычки ставились только вокруг значений с запятой, внутренние кавычки не
// удваивались даже тогда, а перевод строки не обрабатывался вовсе. Название
// магазина в две строки разъезжалось на две строки файла, и отчёт ниже съезжал
// по колонкам — такой отчёт не падает, он просто врёт.
//
// Удалена, а не починена: весь настоящий экспорт идёт через exportToExcel выше,
// где ExcelJS отвечает за экранирование сам и заодно не даёт значению, начатому
// со знака равенства, стать формулой при открытии файла.

// ── Форматтеры ────────────────────────────────────────────────────────────────

/**
 * Every formatter below takes rows from a different query, so a timestamp cell
 * can arrive as a Date, an ISO string or an epoch number depending on which one
 * produced it. Anything else is not a date and is rendered as blank rather than
 * as "Invalid Date".
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return null;
}

export function formatOrdersForExport(orders: Record<string, unknown>[]) {
  return orders.map(o => ({
    "Заказ №":   String(o.orderNumber ?? ""),
    "Дата":      toDate(o.createdAt)?.toLocaleDateString("ru-RU") ?? "",
    "Магазин":   String(o.shopName ?? ""),
    "Территория":String(o.territoryName ?? ""),
    "Агент":     String(o.agentName ?? ""),
    "Статус":    labelled(ORDER_STATUS_LABEL, o.status),
    "Сумма":     Number(o.subtotal ?? 0),
    "Скидка":    Number(o.discount ?? 0),
    "Итого":     Number(o.total ?? 0),
    "Примечания":String(o.notes ?? ""),
  }));
}

export function formatArrivalsForExport(arrivals: Record<string, unknown>[]) {
  return arrivals.map(a => ({
    "Приход №":      String(a.arrivalNumber ?? ""),
    "Дата":          toDate(a.arrivalDate)?.toLocaleDateString("ru-RU") ?? "",
    "Грузовик":      String(a.truckId ?? ""),
    "Водитель":      String(a.driverName ?? ""),
    "Телефон":       String(a.driverPhone ?? ""),
    "Статус":         labelled(ARRIVAL_STATUS_LABEL, a.status),
    "Топливо":        Number(a.fuelCost ?? 0),
    "Платные дороги": Number(a.tollCost ?? 0),
    "Прочее":         Number(a.otherCost ?? 0),
    "Расходы всего":  Number(a.totalExpense ?? 0),
    "Примечания":    String(a.notes ?? ""),
  }));
}

export function formatWarehouseForExport(stock: Record<string, unknown>[]) {
  return stock.map(s => ({
    "Товар":         String(s.productName ?? ""),
    "Код":           String(s.productCode ?? ""),
    "Категория":     String(s.category ?? ""),
    "Единица":       unitShort(s.unit as string | null | undefined),
    "Цена продажи":  Number(s.unitPrice ?? 0),
    "Себестоимость": Number(s.costPrice ?? 0),
    "Всего":         Number(s.currentStock ?? 0),
    "Резерв":        Number(s.reserved ?? 0),
    "Доступно":      Number(s.available ?? 0),
    "Порог":         Number(s.reorderPoint ?? 0),
    "Стоимость":     Number(s.currentStock ?? 0) * Number(s.costPrice ?? 0),
    "Запас":         labelled(STOCK_LEVEL_LABEL, Number(s.available ?? 0) < Number(s.reorderPoint ?? 0) ? "low" : "ok"),
  }));
}

/**
 * История движений одного товара — для файла.
 *
 * Здесь печаталось то же, что и на экране, и так же неразборчиво: колонка
 * называлась «Status» по-английски и содержала «out», ссылка выходила как
 * «manual_adjustment #null», примечание — «Заказ: new → delivered».
 * Владелец открыл файл и сказал: нечитаемый. Разбор теперь общий с экраном
 * (lib/stock-movement-text) — разойтись им негде.
 *
 * Колонки «Товар» не стало: обе выгрузки этой истории идут по ОДНОМУ
 * товару, и его имя стоит в заголовке отчёта. Повторять его в каждой
 * строке значит занимать самое широкое место ничем.
 */
export function formatMovementsForExport(movements: Record<string, unknown>[], lang = "ru") {
  return movements.map(m => ({
    "Дата":       toDate(m.createdAt)?.toLocaleDateString("ru-RU") ?? "",
    "Вид":        movementKind(m.type as string, lang),
    "Количество": formatQty(m.quantity as number),
    "Документ":   movementDocument(m.referenceType as string, m.referenceId as number, lang),
    "Примечание": movementNote(m.notes as string, lang),
  }));
}

export function formatAgentsForExport(agents: Record<string, unknown>[], days: number) {
  return agents.map((a, i) => ({
    "№":       i + 1,
    "Агент":   String(a.agentName ?? `Agent #${a.agentId}`),
    "Визиты":  Number(a.visits),
    "Заказы":  Number(a.orders),
    "Выручка": Number(a.revenue ?? 0),
    "Период":  `${days} дней`,
  }));
}

export function formatShopsForExport(shops: Record<string, unknown>[]) {
  return shops.map(s => ({
    "Название":    String(s.name ?? ""),
    "Владелец":    String(s.ownerName ?? ""),
    "Телефон":     String(s.phone ?? ""),
    "Город":       String(s.city ?? ""),
    "Район":       String(s.district ?? ""),
    "Адрес":       String(s.address ?? ""),
    "Агент":       String(s.agentName ?? ""),
    "Долг":        Number(s.debt ?? 0),
    "Статус":      labelled(ACTIVE_STATUS_LABEL, s.status),
  }));
}

export function formatProductsForExport(products: Record<string, unknown>[]) {
  return products.map(p => ({
    "Код":         String(p.code ?? ""),
    "Штрихкод":    String(p.barcode ?? ""),
    "Название":    String(p.name ?? ""),
    "Категория":   String(p.category ?? ""),
    "Ед.":         unitShort(p.unit as string | null | undefined),
    "Вес (кг)":    Number(p.unitWeight ?? 0),
    "Себестоимость": Number(p.costPrice ?? 0),
    "Цена":        Number(p.unitPrice ?? 0),
    "Остаток":     Number(p.currentStock ?? 0),
    "Мин. остаток": Number(p.reorderPoint ?? 0),
    "Статус":      labelled(ACTIVE_STATUS_LABEL, p.status),
  }));
}

export function formatUsersForExport(users: Record<string, unknown>[]) {
  return users.map(u => ({
    "Имя":         String(u.name ?? ""),
    "Email":       String(u.email ?? ""),
    "Телефон":     String(u.phone ?? ""),
    "Роль":        labelled(ROLE_LABEL, u.role),
    "Статус":      labelled(ACTIVE_STATUS_LABEL, u.status),
    "Последний вход": toDate(u.lastSignInAt)?.toLocaleString("ru-RU") ?? "",
  }));
}

export function formatStockValuationForExport(stock: Record<string, unknown>[]) {
  return stock.map(s => ({
    "Товар":         String(s.productName ?? ""),
    "Код":           String(s.productCode ?? ""),
    "Единица":       unitShort(s.unit as string | null | undefined),
    "Остаток":       Number(s.currentStock ?? 0),
    "Себестоимость": Number(s.costPrice ?? 0),
    "Цена продажи":  Number(s.unitPrice ?? 0),
    "Стоимость (себест.)": Number(s.currentStock ?? 0) * Number(s.costPrice ?? 0),
    "Стоимость (розн.)":  Number(s.currentStock ?? 0) * Number(s.unitPrice ?? 0),
  }));
}

export function formatDeadStockForExport(items: Record<string, unknown>[]) {
  return items.map(s => ({
    "Товар":         String(s.productName ?? ""),
    "Код":           String(s.productCode ?? ""),
    "Категория":     String(s.category ?? ""),
    "Единица":       unitShort(s.unit as string | null | undefined),
    "Остаток":       Number(s.currentStock ?? 0),
    "Себестоимость": Number(s.costPrice ?? 0),
    "Цена продажи":  Number(s.unitPrice ?? 0),
    "Стоимость":     Number(s.value ?? 0),
    "Последний заказ": toDate(s.lastOrderDate)?.toLocaleDateString("ru-RU") ?? "Никогда",
    "Дней без продаж": Number(s.daysSinceOrder ?? 99999),
  }));
}

export function formatReorderForExport(items: Record<string, unknown>[]) {
  return items.map(s => ({
    "Товар":         String(s.productName ?? ""),
    "Код":           String(s.productCode ?? ""),
    "Единица":       unitShort(s.unit as string | null | undefined),
    "Остаток":       Number(s.currentStock ?? 0),
    "Порог":         Number(s.reorderPoint ?? 0),
    "Продажи/день":  Number(s.avgDailySales ?? 0),
    "Дней до конца": Number(s.daysUntilStockout ?? 0),
    "Заказать":      Number(s.suggestedQty ?? 0),
    "Стоимость":     Number(s.suggestedCost ?? 0),
  }));
}

export function formatPnLForExport(data: {
  revenue: number; cogs: number; grossProfit: number; grossMargin: number;
  transportExpenses: number; netProfit: number; netMargin: number;
  // The per-product rows the P&L query returns: SUM()s come back from MySQL as
  // decimal strings, hence the Number() calls below.
  products: Array<{
    productName: string;
    totalQty: string | number;
    totalRevenue: string | number;
    totalCost: string | number;
  }>;
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

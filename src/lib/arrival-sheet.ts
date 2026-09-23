/**
 * Приход как сетка: строка — товар, столбцы — что по накладной, что пришло,
 * почём купили, почём продаём, партия и срок.
 *
 * Логика отдельно от экрана, чтобы её можно было проверить без браузера:
 * сколько пришло против накладной, итоги, вставка столбца из Excel и то,
 * что уходит на сервер, — всё здесь.
 */

export type SheetRow = {
  productId: number;
  name: string;
  code: string;
  unit: string;
  unitWeight: number;
  /** Штук в упаковке; 0 — упаковкой не считают. */
  packSize: number;
  packLabel: string;
  /** По накладной поставщика; пусто — не сверяли. */
  expected: string;
  /** Сколько приняли; пусто — ещё не считали. */
  quantity: string;
  costPrice: string;
  sellingPrice: string;
  batchNumber: string;
  expiresAt: string;
};

/** Столбцы, которые правятся с клавиатуры, — в порядке слева направо. */
export const EDITABLE_COLS = ["expected", "quantity", "costPrice", "sellingPrice", "batchNumber", "expiresAt"] as const;
export type EditableCol = typeof EDITABLE_COLS[number];

const NUMERIC: ReadonlySet<EditableCol> = new Set(["expected", "quantity", "costPrice", "sellingPrice"]);

export type ProductLike = {
  id: number; name: string; code?: string | null; unit?: string | null; unitWeight?: string | number | null;
  packSize?: string | number | null; packLabel?: string | null; costPrice?: string | null; unitPrice?: string | null;
};

export function rowFromProduct(p: ProductLike): SheetRow {
  return {
    productId: p.id, name: p.name, code: p.code ?? "", unit: p.unit ?? "pcs",
    unitWeight: Number(p.unitWeight ?? 0) || 0,
    packSize: Number(p.packSize ?? 0) || 0, packLabel: p.packLabel ?? "",
    expected: "", quantity: "",
    // Цены карточки — подсказкой: чаще всего завод не меняет их от прихода к приходу.
    costPrice: Number(p.costPrice ?? 0) > 0 ? String(Number(p.costPrice)) : "",
    sellingPrice: Number(p.unitPrice ?? 0) > 0 ? String(Number(p.unitPrice)) : "",
    batchNumber: "", expiresAt: "",
  };
}

/** Добавить выбранные товары; уже стоящие в приходе не дублируются. */
export function addProducts(rows: SheetRow[], picked: ProductLike[]): { rows: SheetRow[]; added: number; skipped: number } {
  const have = new Set(rows.map(r => r.productId));
  const fresh: SheetRow[] = [];
  for (const p of picked) {
    if (have.has(p.id)) continue;
    have.add(p.id);
    fresh.push(rowFromProduct(p));
  }
  return { rows: [...rows, ...fresh], added: fresh.length, skipped: picked.length - fresh.length };
}

/** Скан: у товара в приходе +1 к «пришло», нового — строка с единицей. */
export function applyScan(rows: SheetRow[], p: ProductLike): SheetRow[] {
  const i = rows.findIndex(r => r.productId === p.id);
  if (i < 0) return [...rows, { ...rowFromProduct(p), quantity: "1" }];
  return rows.map((r, idx) => idx === i ? { ...r, quantity: String(num(r.quantity) + 1) } : r);
}

/** «Пришло как по накладной» — только там, где пришло ещё не вписано. */
export function fillFromExpected(rows: SheetRow[]): { rows: SheetRow[]; filled: number } {
  let filled = 0;
  const next = rows.map(r => {
    if (r.quantity.trim() !== "" || r.expected.trim() === "") return r;
    filled++;
    return { ...r, quantity: r.expected };
  });
  return { rows: next, filled };
}

/** Упаковки → штуки. Пусто или ноль — «пришло» очищается. */
export function boxesToQuantity(boxes: string, packSize: number): string {
  const n = Number(boxes);
  if (!(packSize > 0) || !Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * packSize * 100) / 100);
}

/** Сколько упаковок в «пришло»; дробное — пусто: целых упаковок нет. */
export function quantityToBoxes(quantity: string, packSize: number): string {
  if (!(packSize > 0)) return "";
  const b = num(quantity) / packSize;
  return b > 0 && Number.isInteger(Math.round(b * 1000) / 1000) ? String(Math.round(b)) : "";
}

/** Пришло минус по накладной; null — сверять нечего. */
export function diff(r: SheetRow): number | null {
  if (r.expected.trim() === "" || r.quantity.trim() === "") return null;
  return Math.round((num(r.quantity) - num(r.expected)) * 100) / 100;
}

/** Наценка продажи к закупке, %; null — не из чего считать. */
export function markupPct(cost: string, sale: string): number | null {
  const c = num(cost), s = num(sale);
  if (!(c > 0) || !(s > 0)) return null;
  return Math.round((s / c - 1) * 1000) / 10;
}

export type SheetTotals = {
  positions: number; units: number; expectedUnits: number; weightKg: number;
  costSum: number; saleSum: number; mismatches: number; notCounted: number;
};

export function totals(rows: SheetRow[]): SheetTotals {
  const t: SheetTotals = { positions: rows.length, units: 0, expectedUnits: 0, weightKg: 0, costSum: 0, saleSum: 0, mismatches: 0, notCounted: 0 };
  for (const r of rows) {
    const q = num(r.quantity);
    t.units += q;
    t.expectedUnits += num(r.expected);
    t.weightKg += q * (r.unitWeight || 0);
    t.costSum += q * num(r.costPrice);
    t.saleSum += q * num(r.sellingPrice);
    const d = diff(r);
    if (d != null && d !== 0) t.mismatches++;
    if (r.quantity.trim() === "") t.notCounted++;
  }
  t.costSum = Math.round(t.costSum * 100) / 100;
  t.saleSum = Math.round(t.saleSum * 100) / 100;
  t.weightKg = Math.round(t.weightKg * 1000) / 1000;
  return t;
}

/**
 * Вставка диапазона из Excel с ячейки (row, col) вниз и вправо.
 * Числовые столбцы принимают «1 200,50» и «1200.5»; нечисло — пропуск,
 * а не мусор в ячейке. Строк больше, чем в приходе, — лишние отбрасываются:
 * товар по строке не угадать.
 */
export function pasteRange(rows: SheetRow[], row: number, col: EditableCol, matrix: string[][]): { rows: SheetRow[]; cells: number } {
  const c0 = EDITABLE_COLS.indexOf(col);
  let cells = 0;
  const next = rows.map(r => ({ ...r }));
  matrix.forEach((line, dr) => {
    const target = next[row + dr];
    if (!target) return;
    line.forEach((raw, dc) => {
      const key = EDITABLE_COLS[c0 + dc];
      if (!key) return;
      const v = NUMERIC.has(key) ? normalizeNumber(raw) : raw;
      if (v == null) return;
      target[key] = v;
      cells++;
    });
  });
  return { rows: next, cells };
}

/** «1 200,50» → «1200.50»; пусто → ""; нечисло → null. */
export function normalizeNumber(raw: string): string | null {
  const s = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (s === "") return "";
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

export type PayloadItem = {
  productId: number; quantity: string; expectedQuantity?: string;
  costPrice?: string; sellingPrice?: string; batchNumber?: string; expiresAt?: string;
};

/**
 * Что уходит на сервер. Строка без «пришло» и без «по накладной» не
 * уходит — это выбранный и забытый товар. «Пришло» пустое при заполненной
 * накладной уходит нулём: приход заведён по бумаге, считать будут потом.
 */
export function toPayload(rows: SheetRow[]): PayloadItem[] {
  return rows
    .filter(r => r.quantity.trim() !== "" || r.expected.trim() !== "")
    .map(r => ({
      productId: r.productId,
      quantity: fixed2(r.quantity), // пусто → "0.00"
      expectedQuantity: r.expected.trim() === "" ? undefined : fixed2(r.expected),
      costPrice: r.costPrice.trim() === "" ? undefined : fixed2(r.costPrice),
      sellingPrice: r.sellingPrice.trim() === "" ? undefined : fixed2(r.sellingPrice),
      batchNumber: r.batchNumber.trim() || undefined,
      expiresAt: r.expiresAt || undefined,
    }));
}

export type SheetProblem = { row: number; col: EditableCol; message: { ru: string; uz: string } };

/** То, что сервер всё равно отвергнет, — показать в ячейке до отправки. */
export function problems(rows: SheetRow[], arrivalDate: string): SheetProblem[] {
  const out: SheetProblem[] = [];
  rows.forEach((r, row) => {
    if (r.expiresAt && arrivalDate && r.expiresAt < arrivalDate) {
      out.push({ row, col: "expiresAt", message: { ru: "Срок раньше даты прихода", uz: "Muddat kelish sanasidan oldin" } });
    }
    if (r.quantity.trim() === "" && r.expected.trim() === "") {
      out.push({ row, col: "quantity", message: { ru: "Нет количества", uz: "Miqdor yo'q" } });
    }
  });
  return out;
}

/** Строки документа из ответа arrival.getById. */
export function rowsFromDetail(items: Array<{
  productId: number; productName: string; productCode: string; quantity: number; expectedQuantity: number | null;
  costPrice: string; sellingPrice: string; batchNumber: string | null; expiresAt: string | null;
  unit?: string | null; unitWeight?: string | number | null; packSize?: string | number | null; packLabel?: string | null;
}>): SheetRow[] {
  return items.map(i => ({
    productId: i.productId, name: i.productName, code: i.productCode,
    unit: i.unit ?? "pcs", unitWeight: Number(i.unitWeight ?? 0) || 0,
    packSize: Number(i.packSize ?? 0) || 0, packLabel: i.packLabel ?? "",
    expected: i.expectedQuantity == null ? "" : String(i.expectedQuantity),
    // Ноль в документе — «ещё не считали»: так строку заводят по накладной.
    quantity: Number(i.quantity) > 0 ? String(i.quantity) : "",
    costPrice: Number(i.costPrice) > 0 ? String(Number(i.costPrice)) : "",
    sellingPrice: Number(i.sellingPrice) > 0 ? String(Number(i.sellingPrice)) : "",
    batchNumber: i.batchNumber ?? "", expiresAt: i.expiresAt ?? "",
  }));
}

/**
 * Сколько дней осталось до срока. Отрицательное — просрочен.
 *
 * Считается по календарю, а не через toISOString: местная полночь,
 * напечатанная в UTC, на ташкентском поясе даёт вчерашний день — и товар,
 * который горит сегодня, показывался бы вчерашним.
 */
export function daysLeft(day: string, now: Date = new Date()): number {
  const [y, m, d] = day.split("-").map(Number);
  const due = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fixed2(v: string): string {
  return (Math.round(num(v) * 100) / 100).toFixed(2);
}

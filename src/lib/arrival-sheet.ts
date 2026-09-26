/**
 * Приход как сетка: строка — товар, столбцы — что по накладной, что пришло,
 * почём купили, почём продаём, партия и срок.
 *
 * Логика отдельно от экрана, чтобы её можно было проверить без браузера:
 * сколько пришло против накладной, итоги, вставка столбца из Excel и то,
 * что уходит на сервер, — всё здесь.
 */
import { normalizeNumber } from "./grid-nav";

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
  /**
   * «Состояние» строки из прежней формы («Повреждено, 3 шт»). Сетка его не
   * правит, но возит туда и обратно: setItems заменяет строки целиком, и
   * без него сохранение стирало записанное. Черновики до 27.09 — без поля.
   */
  condition?: string;
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
export function addProducts(rows: SheetRow[], picked: ProductLike[]): { rows: SheetRow[]; added: number } {
  const have = new Set(rows.map(r => r.productId));
  const fresh: SheetRow[] = [];
  for (const p of picked) {
    if (have.has(p.id)) continue;
    have.add(p.id);
    fresh.push(rowFromProduct(p));
  }
  return { rows: [...rows, ...fresh], added: fresh.length };
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

/**
 * Наценка продажи к закупке, %; null — не из чего считать. Одна формула на
 * приход и прайс-лист (маржа к себестоимости там — она же).
 */
export function markupPct(cost: string | number, sale: string | number): number | null {
  const c = num(cost), s = num(sale);
  if (!(c > 0) || !(s > 0)) return null;
  return Math.round((s / c - 1) * 1000) / 10;
}

/** «+33.3%», «-7%»; нет процента — пусто. */
export const pctText = (p: number | null) => (p == null ? "" : `${p > 0 ? "+" : ""}${p}%`);

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
export function pasteRange(rows: SheetRow[], row: number, col: EditableCol, matrix: string[][]): SheetRow[] {
  const c0 = EDITABLE_COLS.indexOf(col);
  const next = rows.map(r => ({ ...r }));
  matrix.forEach((line, dr) => {
    const target = next[row + dr];
    if (!target) return;
    line.forEach((raw, dc) => {
      const key = EDITABLE_COLS[c0 + dc];
      if (!key) return;
      const v = NUMERIC.has(key) ? normalizeNumber(raw) : raw;
      if (v != null) target[key] = v;
    });
  });
  return next;
}

export type PayloadItem = {
  productId: number; quantity: string; expectedQuantity?: string;
  costPrice?: string; sellingPrice?: string; batchNumber?: string; expiresAt?: string; condition?: string;
};

/**
 * Что уходит на сервер. «Пришло» пустое при заполненной накладной уходит
 * нулём: приход заведён по бумаге, считать будут потом. Строку без того и
 * другого сюда не пускает problems().
 */
export function toPayload(rows: SheetRow[]): PayloadItem[] {
  return rows.map(r => ({
    productId: r.productId,
    quantity: fixed2(r.quantity), // пусто → "0.00"
    expectedQuantity: r.expected.trim() === "" ? undefined : fixed2(r.expected),
    costPrice: r.costPrice.trim() === "" ? undefined : fixed2(r.costPrice),
    sellingPrice: r.sellingPrice.trim() === "" ? undefined : fixed2(r.sellingPrice),
    batchNumber: r.batchNumber.trim() || undefined,
    expiresAt: r.expiresAt || undefined,
    condition: r.condition?.trim() || undefined,
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
    // Минус пропускает поле ввода (DecimalInput держит знак), а сервер
    // принимает только неотрицательное — и отказал бы всему сохранению.
    if (num(r.expected) < 0) out.push({ row, col: "expected", message: { ru: "Количество не может быть меньше нуля", uz: "Miqdor noldan kam bo'lmaydi" } });
    if (num(r.quantity) < 0) out.push({ row, col: "quantity", message: { ru: "Количество не может быть меньше нуля", uz: "Miqdor noldan kam bo'lmaydi" } });
    // Ноль без накладной — то же, что пусто: сервер (refine в arrival-router)
    // отверг бы всё сохранение, не назвав строку.
    else if (!(num(r.quantity) > 0) && r.expected.trim() === "") {
      out.push({ row, col: "quantity", message: { ru: "Нет количества", uz: "Miqdor yo'q" } });
    }
  });
  return out;
}

/** Строки документа из ответа arrival.getById. */
export function rowsFromDetail(items: Array<{
  productId: number; productName: string; productCode: string; quantity: number; expectedQuantity: number | null;
  costPrice: string; sellingPrice: string; batchNumber: string | null; expiresAt: string | null; condition?: string | null;
  unit?: string | null; unitWeight?: string | number | null; packSize?: string | number | null; packLabel?: string | null;
}>): SheetRow[] {
  return items.map(i => ({
    ...rowFromProduct({ ...i, id: i.productId, name: i.productName, code: i.productCode, unitPrice: i.sellingPrice }),
    expected: i.expectedQuantity == null ? "" : String(i.expectedQuantity),
    // Ноль в документе — «ещё не считали»: так строку заводят по накладной.
    quantity: Number(i.quantity) > 0 ? String(i.quantity) : "",
    batchNumber: i.batchNumber ?? "", expiresAt: i.expiresAt ?? "",
    condition: i.condition ?? "",
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

function num(v: string | number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fixed2(v: string): string {
  return (Math.round(num(v) * 100) / 100).toFixed(2);
}

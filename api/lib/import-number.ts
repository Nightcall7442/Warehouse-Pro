/*
  Число из ячейки импорта.

  Стояло `.replace(/[^\d.]/g, "")`: всё, кроме цифр и точки, выбрасывалось.
  Запятая — десятичный разделитель в русской и узбекской записи — пропадала
  вместе с пробелами, и «1 200,50» превращалось в 120050: цена, себестоимость
  и долг магазина в сто раз больше (бизнес-аудит 19.11.2026). Минус тоже
  выбрасывался молча: «−500» читалось как 500.

  Правила:
    · число из Excel (ячейка с числом, результат формулы) берётся как есть;
    · пробелы любого вида (обычный, неразрывный, узкий), апостроф и
      подчёркивание — разделители разрядов: «1 200 000», «1'200'000»;
    · есть и запятая, и точка — десятичный тот, что правее: «1.200,50» и
      «1,200.50» — оба 1200.5;
    · одна запятая — десятичная («1200,50», «0,250»), кроме записи разрядов в
      американском виде «12,000» / «1,200,000» (ровно по три цифры после
      каждой запятой и целая часть не ноль);
    · несколько точек — разряды («1.200.000»), одна — десятичная;
    · «сум», «so'm», «UZS», «$» по краям не мешают.

  Пустая ячейка — undefined (не указано), неразборчивая — null: её надо
  назвать человеку строкой ошибки, а не положить нулём.
*/
import type { CellValue } from "exceljs";

const CURRENCY = /(сум|сўм|so['\u02bb\u2019`]?m|uzs|руб|₽|\$|usd)\.?/gi;

export function parseImportNumber(raw: CellValue | undefined): number | null | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean" || raw instanceof Date) return null;
  if (typeof raw === "object") {
    // Формула: exceljs отдаёт { formula, result }; богатый текст — { richText }.
    const o = raw as { result?: unknown; richText?: Array<{ text: string }>; text?: unknown };
    if ("result" in o) return parseImportNumber(o.result as CellValue);
    if (Array.isArray(o.richText)) return parseImportNumber(o.richText.map(r => r.text).join(""));
    if (typeof o.text === "string") return parseImportNumber(o.text);
    return null;
  }

  let s = String(raw).replace(CURRENCY, "").trim();
  if (s === "") return undefined;
  s = s.replace(/[\s\u00a0\u202f\u2009'\u2019_]/g, "").replace(/^[\u2212\u2013]/, "-");
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    const [intPart, frac, ...rest] = s.split(dec);
    if (rest.length > 0) return null;
    normalized = intPart.split(thou).join("") + "." + frac;
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    const groupsOfThree = parts.slice(1).every(p => p.length === 3) && parts[0] !== "0" && parts[0] !== "";
    if (parts.length > 2) {
      if (!groupsOfThree) return null;
      normalized = parts.join("");
    } else {
      normalized = groupsOfThree ? parts.join("") : parts.join(".");
    }
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    if (parts.length > 2) {
      if (!parts.slice(1).every(p => p.length === 3)) return null;
      normalized = parts.join("");
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }

  if (!/^\d*(\.\d*)?$/.test(normalized) || normalized === "." ) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

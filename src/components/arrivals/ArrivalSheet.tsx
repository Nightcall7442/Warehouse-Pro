import { useMemo } from "react";
import { X, Package } from "lucide-react";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { unitShort } from "@/lib/units";
import { formatQty } from "@/lib/format";
import {
  type SheetRow, type EditableCol, diff, markupPct, boxesToQuantity, quantityToBoxes, pasteRange, problems, daysLeft,
} from "@/lib/arrival-sheet";
import { nextCell, focusCell, isRangePaste, parseClipboard } from "@/lib/grid-nav";

const GRID = "arrival";

/**
 * Сетка прихода: строка — товар, число — Enter — число.
 *
 * Прежняя форма давала на каждый товар карточку из десяти полей и
 * выпадающий список из всего каталога. Сорок позиций — сорок прокруток
 * списка и четыреста полей вразброс. Здесь товары выбираются сразу
 * пачкой, а количества вбиваются столбцом, как в Excel: Enter и стрелки
 * ходят по столбцу, столбец из Excel вставляется целиком.
 */
export function ArrivalSheet({ rows, onChange, readOnly, arrivalDate, onAddClick }: {
  rows: SheetRow[];
  onChange: (rows: SheetRow[]) => void;
  readOnly?: boolean;
  arrivalDate: string;
  onAddClick?: () => void;
}) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const withPacks = rows.some(r => r.packSize > 0);
  const bad = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of problems(rows, arrivalDate)) m.set(`${p.row}:${p.col}`, p.message[lang === "uz" ? "uz" : "ru"]);
    return m;
  }, [rows, arrivalDate, lang]);

  const set = (i: number, patch: Partial<SheetRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: string) => {
    const to = nextCell(e.key, { row, col }, rows.length, e.shiftKey);
    if (!to) return;
    e.preventDefault();
    focusCell(GRID, to);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number, col: EditableCol | "boxes") => {
    const text = e.clipboardData.getData("text");
    if (!isRangePaste(text)) return;
    e.preventDefault();
    const matrix = parseClipboard(text);
    if (col === "boxes") {
      onChange(rows.map((r, i) => {
        const line = matrix[i - row];
        return line && i >= row ? { ...r, quantity: boxesToQuantity(line[0] ?? "", r.packSize) || r.quantity } : r;
      }));
      return;
    }
    onChange(pasteRange(rows, row, col, matrix).rows);
  };

  const cell = (i: number, col: EditableCol, opts: { numeric?: boolean; type?: string; placeholder?: string; min?: string } = {}) => {
    const r = rows[i];
    const err = bad.get(`${i}:${col}`);
    const common = {
      "data-grid": GRID, "data-row": i, "data-col": col,
      className: `sheet-input${opts.numeric ? " num" : ""}`,
      "aria-invalid": err ? true : undefined, title: err,
      placeholder: opts.placeholder,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => onKeyDown(e, i, col),
      onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => onPaste(e, i, col),
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
      "data-testid": `arrival-cell-${col}-${i}`,
    };
    return opts.numeric
      ? <DecimalInput {...common} value={r[col]} onValueChange={v => set(i, { [col]: v })} />
      : <input {...common} type={opts.type ?? "text"} min={opts.min} value={r[col]} onChange={e => set(i, { [col]: e.target.value })} />;
  };

  if (rows.length === 0) {
    return (
      <div className="neo-card" data-testid="arrival-sheet-empty" style={{ borderRadius: 20, padding: "40px 24px", textAlign: "center", border: "1px dashed var(--color-border-strong)" }}>
        <Package size={28} style={{ color: "var(--color-text-tertiary)", margin: "0 auto 10px" }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
          {t("В приходе пока нет товаров", "Kelishda hali mahsulot yo'q")}
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "6px 0 16px" }}>
          {t("Выберите сразу все позиции из накладной — количества впишете столбцом.", "Hujjatdagi barcha pozitsiyalarni birdaniga tanlang — miqdorlarni ustun bo'yicha yozasiz.")}
        </p>
        {!readOnly && onAddClick && (
          <button className="neo-btn-primary" onClick={onAddClick} data-testid="arrival-add-empty">
            {t("Выбрать товары", "Mahsulotlarni tanlash")}
          </button>
        )}
      </div>
    );
  }

  const ro = (v: string, numeric = false) => (
    <span style={{ display: "block", padding: "6px 8px", textAlign: numeric ? "right" : "left", fontVariantNumeric: "tabular-nums", color: v ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
      {v || "—"}
    </span>
  );

  return (
    <div className="neo-card" style={{ borderRadius: 20, padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto", maxHeight: "min(70vh, 900px)", overflowY: "auto" }} data-testid="arrival-sheet">
        <table className="sheet-table" style={{ minWidth: withPacks ? 1180 : 1080 }}>
          <thead>
            <tr>
              <th className="sticky-col" style={{ minWidth: 240 }}>{t("Товар", "Mahsulot")}</th>
              <th>{t("Ед.", "O'lch.")}</th>
              <th className="num">{t("По накладной", "Hujjat bo'yicha")}</th>
              {withPacks && <th className="num">{t("Упак.", "Qadoq")}</th>}
              <th className="num">{t("Пришло", "Keldi")}</th>
              <th className="num">±</th>
              <th className="num">{t("Закупка", "Xarid")}</th>
              <th className="num">{t("Сумма", "Summa")}</th>
              <th className="num">{t("Продажа", "Sotuv")}</th>
              <th className="num">{t("Наценка", "Ustama")}</th>
              <th>{t("Партия", "Partiya")}</th>
              <th>{t("Годен до", "Muddati")}</th>
              {!readOnly && <th aria-label={t("Убрать", "Olib tashlash")} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const d = diff(r);
              const m = markupPct(r.costPrice, r.sellingPrice);
              const sum = Number(r.quantity || 0) * Number(r.costPrice || 0);
              return (
                <tr key={r.productId} data-testid={`arrival-row-${i}`}>
                  <td className="sticky-col" style={{ padding: "6px 10px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", minWidth: 18, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1.3 }}>{r.name}</div>
                        {r.code && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>{r.code}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: "var(--color-text-secondary)", padding: "0 8px" }}>{unitShort(r.unit)}</td>
                  <td className="num" style={{ width: 110 }}>{readOnly ? ro(r.expected ? formatQty(r.expected) : "", true) : cell(i, "expected", { numeric: true })}</td>
                  {withPacks && (
                    <td className="num" style={{ width: 90 }}>
                      {r.packSize > 0 && !readOnly ? (
                        <DecimalInput
                          data-grid={GRID} data-row={i} data-col="boxes"
                          className="sheet-input num"
                          title={`${r.packLabel || t("упаковка", "qadoq")} × ${formatQty(r.packSize)}`}
                          placeholder={`× ${formatQty(r.packSize)}`}
                          value={quantityToBoxes(r.quantity, r.packSize)}
                          onValueChange={v => set(i, { quantity: boxesToQuantity(v, r.packSize) })}
                          onKeyDown={e => onKeyDown(e, i, "boxes")}
                          onPaste={e => onPaste(e, i, "boxes")}
                          data-testid={`arrival-cell-boxes-${i}`}
                        />
                      ) : ro(r.packSize > 0 ? quantityToBoxes(r.quantity, r.packSize) : "", true)}
                    </td>
                  )}
                  <td className="num" style={{ width: 110 }}>{readOnly ? ro(r.quantity ? formatQty(r.quantity) : "", true) : cell(i, "quantity", { numeric: true, placeholder: r.expected || "0" })}</td>
                  <td className="num" data-testid={`arrival-diff-${i}`} style={{
                    padding: "0 8px", fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                    color: d == null || d === 0 ? "var(--color-text-tertiary)" : d < 0 ? "var(--color-danger-text)" : "var(--color-warning-text)",
                  }}>
                    {d == null ? "" : d === 0 ? "✓" : `${d > 0 ? "+" : ""}${formatQty(d)}`}
                  </td>
                  <td className="num" style={{ width: 120 }}>{readOnly ? ro(r.costPrice ? fmt(r.costPrice) : "", true) : cell(i, "costPrice", { numeric: true })}</td>
                  <td className="num" style={{ padding: "0 8px", whiteSpace: "nowrap", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{sum > 0 ? fmt(sum) : ""}</td>
                  <td className="num" style={{ width: 120 }}>{readOnly ? ro(r.sellingPrice ? fmt(r.sellingPrice) : "", true) : cell(i, "sellingPrice", { numeric: true })}</td>
                  <td className="num" style={{ padding: "0 8px", whiteSpace: "nowrap", color: m != null && m < 0 ? "var(--color-danger-text)" : "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {m == null ? "" : `${m > 0 ? "+" : ""}${m}%`}
                  </td>
                  <td style={{ width: 120 }}>{readOnly ? ro(r.batchNumber) : cell(i, "batchNumber", { placeholder: t("—", "—") })}</td>
                  <td style={{ width: 150 }}>
                    {readOnly ? ro(r.expiresAt ? r.expiresAt.split("-").reverse().join(".") : "") : cell(i, "expiresAt", { type: "date", min: arrivalDate })}
                    {/*
                      Просроченное и то, что горит на днях, — словом, а не только
                      цветом: кладовщик не станет вычитать дату из сегодняшнего
                      числа в уме.
                    */}
                    {r.expiresAt && daysLeft(r.expiresAt) <= 30 && (
                      <span data-testid={`arrival-expiry-${i}`} style={{ display: "block", padding: "0 8px 4px", fontSize: 10, fontWeight: 600, color: daysLeft(r.expiresAt) < 0 ? "var(--color-danger-text)" : "var(--color-warning-text)" }}>
                        {daysLeft(r.expiresAt) < 0 ? t("просрочен", "muddati o'tgan") : t(`${daysLeft(r.expiresAt)} дн.`, `${daysLeft(r.expiresAt)} kun`)}
                      </span>
                    )}
                  </td>
                  {!readOnly && (
                    <td style={{ width: 36, textAlign: "center" }}>
                      <button onClick={() => remove(i)} aria-label={t("Убрать строку", "Qatorni olib tashlash")} data-testid={`arrival-remove-${i}`}
                        style={{ border: "none", background: "transparent", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 6, borderRadius: 8 }}>
                        <X size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

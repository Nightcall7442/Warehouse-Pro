/**
 * Клавиатура в сетке ввода — как в Excel.
 *
 * Приход и прайс-лист набирают столбцом: «пришло» по сорока строкам подряд.
 * Мышью это сорок прицеливаний; здесь — число, Enter, число, Enter. Tab
 * браузер двигает сам, поэтому тут только вертикаль.
 */
/** Столбец — по имени: у прихода и прайс-листа свои наборы столбцов. */
export type CellPos = { row: number; col: string };

export function nextCell(key: string, at: CellPos, rowCount: number, shift = false): CellPos | null {
  if (key === "Enter") return shift ? (at.row > 0 ? { row: at.row - 1, col: at.col } : null) : (at.row + 1 < rowCount ? { row: at.row + 1, col: at.col } : null);
  if (key === "ArrowDown") return at.row + 1 < rowCount ? { row: at.row + 1, col: at.col } : null;
  if (key === "ArrowUp") return at.row > 0 ? { row: at.row - 1, col: at.col } : null;
  return null;
}

/**
 * Вставка из Excel: строки — переводы строки, столбцы — табуляция.
 * Хвостовой перевод строки Excel кладёт всегда — пустая последняя строка
 * отбрасывается, иначе вставка затирала бы ячейку под диапазоном.
 */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map(l => l.split("\t").map(c => c.trim()));
}

/** Одна ячейка без табуляций и переводов строки — обычный ввод, не вставка диапазона. */
export function isRangePaste(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r?\n$/, ""));
}

/** Фокус на ячейку сетки: [data-grid="…"][data-row][data-col]. */
export function focusCell(grid: string, pos: CellPos): void {
  const el = document.querySelector<HTMLInputElement>(`[data-grid="${grid}"][data-row="${pos.row}"][data-col="${pos.col}"]`);
  if (!el) return;
  el.focus();
  el.select?.();
}

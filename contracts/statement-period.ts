/* ═══════════════════════════════════════════════════════════════════════════
   Период акта сверки — так, как его называет бухгалтер.

   Было: «всё время / 30 дней / 90 дней / год / свой период». Скользящие
   тридцать дней — счёт программиста: бухгалтер сверяется «за сентябрь», «за
   третий квартал», «с начала года», и ровно эти слова арендатор просил
   (09.10.2026, «чтобы по период выбрать»). Тридцать дней назад от сегодня не
   совпадают ни с одним из них — акт приходилось собирать своими датами.

   Даты — местные, по календарю того, кто смотрит, а не по UTC: прежний код
   брал `toISOString().slice(0, 10)`, и в Ташкенте до пяти утра «сегодня»
   оказывалось вчерашним числом.

   Текущие отрезки («этот месяц», «этот квартал», «с начала года») кончаются
   сегодняшним днём, а не концом месяца: акт на дату, которая ещё не
   наступила, — бумага о будущем.
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatementPreset =
  | "all" | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "thisYear" | "lastYear" | "custom";

export const STATEMENT_PRESETS: ReadonlyArray<{ id: StatementPreset; ru: string; uz: string }> = [
  { id: "all",         ru: "За всё время",    uz: "Butun davr" },
  { id: "thisMonth",   ru: "Этот месяц",      uz: "Shu oy" },
  { id: "lastMonth",   ru: "Прошлый месяц",   uz: "O'tgan oy" },
  { id: "thisQuarter", ru: "Этот квартал",    uz: "Shu chorak" },
  { id: "lastQuarter", ru: "Прошлый квартал", uz: "O'tgan chorak" },
  { id: "thisYear",    ru: "С начала года",   uz: "Yil boshidan" },
  { id: "lastYear",    ru: "Прошлый год",     uz: "O'tgan yil" },
  { id: "custom",      ru: "Свой период",     uz: "O'z davri" },
];

/** Выбранный период: отрезок и его даты («ГГГГ-ММ-ДД»; пустая — открыт). */
export interface StatementPeriod { preset: StatementPreset; from: string; to: string }

export const ALL_TIME: StatementPeriod = { preset: "all", from: "", to: "" };

export function isStatementPreset(v: unknown): v is StatementPreset {
  return STATEMENT_PRESETS.some(p => p.id === v);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «ГГГГ-ММ-ДД» по местному календарю. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Две даты отрезка. «Всё время» — пустые строки; «свой период» — null:
 * его даты вводит человек, считать нечего.
 *
 * new Date(год, месяц, 0) — последний день предыдущего месяца; отрицательный
 * месяц уводит в прошлый год. На этом держатся январь («прошлый месяц» —
 * декабрь прошлого года) и первый квартал («прошлый» — четвёртый).
 */
export function presetRange(preset: StatementPreset, today: Date = new Date()): { from: string; to: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = (yy: number, mm: number, dd: number) => localDay(new Date(yy, mm, dd));
  const quarter = Math.floor(m / 3) * 3;
  switch (preset) {
    case "all":         return { from: "", to: "" };
    case "thisMonth":   return { from: day(y, m, 1), to: localDay(today) };
    case "lastMonth":   return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case "thisQuarter": return { from: day(y, quarter, 1), to: localDay(today) };
    case "lastQuarter": return { from: day(y, quarter - 3, 1), to: day(y, quarter, 0) };
    case "thisYear":    return { from: day(y, 0, 1), to: localDay(today) };
    case "lastYear":    return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
    case "custom":      return null;
  }
}

/** «ГГГГ-ММ-ДД» → «ДД.ММ.ГГГГ» без часовых поясов: строка как есть. */
export function dayToRu(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : day;
}

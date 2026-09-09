/*
  Месячная арифметика — общая для экрана и сервера.

  День здесь строка «ГГГГ-ММ-ДД», а весь счёт идёт в UTC — ровно как в
  api/services/visit-planning.ts. Организация живёт в Ташкенте (+5), и стоило
  бы взять местное время браузера, «первое октября» съехало бы на тридцатое
  сентября, а расстановка и её предпросмотр разошлись бы на один день.

  Отдельным файлом от компонентов не по вкусу, а по требованию сборщика: файл,
  который экспортирует и компонент, и функции, теряет горячую замену.
*/

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];

/** Дни месяца «ГГГГ-ММ» строками — тот же счёт, что у monthBounds на сервере. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Последнее число месяца, «ГГГГ-ММ-ДД». */
export function monthEnd(month: string): string {
  const days = monthDays(month);
  return days[days.length - 1];
}

/** День недели: 0 — воскресенье, как в колонке day_of_week. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function monthLabel(month: string, lang: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${(lang === "uz" ? MONTHS_UZ : MONTHS_RU)[m - 1]} ${y}`;
}

/** Сдвинуть «ГГГГ-ММ» на n месяцев. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

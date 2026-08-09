/**
 * Строки из результата db.execute.
 *
 * mysql2 возвращает кортеж [rows, fields]. Оба его элемента — массивы, поэтому
 * ни Array.isArray, ни .map, ни [0] не подскажут, что обращение идёт не туда:
 *
 *   const r = await db.execute(sql`SELECT ...`);
 *   r[0].maxCode          // undefined — r[0] это МАССИВ строк
 *   r.map(x => x.month)   // два элемента: сами строки и fields
 *
 * Ошибка не падает, а тихо даёт ноль или пустое значение, и потому доживает до
 * прода. В этой базе кода она встречалась уже в трёх местах разом: автокоды
 * товаров при импорте всегда начинались заново, два графика в кабинете
 * суперадмина рисовали точки без месяца, а сверка размеров таблиц при
 * резервном копировании докладывала нули по всем таблицам — то есть ровно ту
 * картину, ради обнаружения которой её и писали.
 *
 * Отсюда именованный помощник вместо трёх точечных приведений типа: место, где
 * кортеж разворачивается, должно называться, а не выглядеть как индексация.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  // Настоящий драйвер: [rows, fields].
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  // Некоторые обёртки и тестовые стенды отдают строки напрямую.
  if (Array.isArray(result)) return result as T[];
  return [];
}

/** Первая строка результата, или undefined, если строк нет. */
export function firstRow<T = Record<string, unknown>>(result: unknown): T | undefined {
  return rowsOf<T>(result)[0];
}

/**
 * Сколько строк изменил UPDATE — или undefined, если ответ этого не сообщает.
 *
 * Нужна там, где условная запись служит защитой: «перевести возврат в
 * completed может только тот вызов, который застал его approved». Проверка
 * `affectedRows === 1` и есть способ узнать, кто оказался первым.
 *
 * Разбирать ответ вручную через `const [res] = await tx.update(...)` нельзя:
 * настоящий драйвер отдаёт [ResultSetHeader, fields], а тестовые двойники —
 * кто объект, кто вообще ничего, и деструктуризация undefined роняет запрос
 * целиком. Отдельно от формы стоит и смысл: undefined здесь означает «ответ
 * промолчал», а не «изменено ноль строк», и путать эти два случая нельзя —
 * иначе на стенде защита будет срабатывать вхолостую.
 */
export function affectedRows(result: unknown): number | undefined {
  const head = Array.isArray(result) ? result[0] : result;
  const n = (head as { affectedRows?: unknown } | null | undefined)?.affectedRows;
  return typeof n === "number" ? n : undefined;
}

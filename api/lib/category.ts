/**
 * Название категории, приведённое к одному виду.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Категория — не таблица, а свободная строка в products.category, и список
 * категорий собирается запросом GROUP BY. Значит любое расхождение в написании
 * создаёт НОВУЮ категорию: «Напитки», «напитки », « Напитки» и «Напитки  » — в
 * выпадающем списке это четыре разные строки.
 *
 * Три пути записи расходились между собой: карточка товара чистила строку
 * через sanitizeString, а обмен с 1С и загрузка из Excel клали её как есть — с
 * пробелами по краям, которые в выгрузке встречаются постоянно. Так у Fresh и
 * набрались дубликаты в категориях.
 *
 * ── Почему регистр не трогаем ───────────────────────────────────────────────
 *
 * Заглавные и строчные — выбор владельца: «Бытовая химия» и «БЫТОВАЯ ХИМИЯ»
 * это одно и то же, но переписывать его написание за него нельзя. Поэтому
 * здесь только пробелы, а склейку одинаковых по смыслу написаний делает
 * sameCategory ниже — там, где есть с чем сравнить.
 */
export function normalizeCategory(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

/** Одна и та же категория, написанная по-разному. */
export function sameCategory(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCategory(a);
  const y = normalizeCategory(b);
  if (x === null || y === null) return x === y;
  return x.toLocaleLowerCase("ru") === y.toLocaleLowerCase("ru");
}

/**
 * Написание, уже принятое у этого арендатора.
 *
 * Если категория с таким же названием уже есть — берём ЕЁ написание, а не
 * присланное. Иначе выгрузка из 1С с «НАПИТКИ» заводила бы вторую строку
 * рядом с «Напитки», набранной руками.
 */
export function existingSpelling(value: string | null | undefined, known: readonly (string | null)[]): string | null {
  const normalized = normalizeCategory(value);
  if (normalized === null) return null;
  const match = known.find(k => sameCategory(k, normalized));
  return match ? normalizeCategory(match) : normalized;
}

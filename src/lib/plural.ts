/**
 * Русские три формы: 1 товар, 2 товара, 5 товаров.
 *
 * Экраны писали «2 заказов» и «1 действие ожидают отправки» — мелочь, по
 * которой сразу видно, что текст никто не читал.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = abs % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

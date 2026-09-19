/**
 * Цвет метрики из строки заливки: первый var(--…) или hex. Заливки заданы в
 * трёх десятках вызовов как градиенты; значку нужен один оттенок — для глифа.
 */
export function kpiAccent(gradient?: string): string {
  const m = gradient?.match(/var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : "var(--color-primary)";
}

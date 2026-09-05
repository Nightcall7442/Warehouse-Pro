/**
 * Границы отчётного периода — текущего или сдвинутого назад на offset периодов.
 *
 * Живёт отдельным модулем, а не внутри роутера: арифметика дат ошибается тихо —
 * на месяце с 31 днём, на границе года, на переходе через квартал, — и проверять
 * её надо прямо, а не через процедуру, которой нужна база.
 *
 * Сдвиг понадобился зарплатам: за сентябрь платят в октябре, а посмотреть
 * закрытый месяц было нельзя вовсе — экран знал только «с первого числа по
 * сегодня», и спор «за март не платили» разбирать было не по чему.
 *
 * У прошлого периода конец — его последний день, а не сегодня: иначе сентябрь
 * показывал бы заодно и весь октябрь.
 */
export function getPeriod(period: string, offset = 0): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const endOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

  if (period === "week") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * offset);
    const periodStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    return { periodStart, periodEnd: offset === 0 ? today : endOf(end) };
  }

  if (period === "quarter") {
    // Месяц с отрицательным номером Date переносит на прошлый год сам.
    const periodStart = new Date(now.getFullYear(), (Math.floor(now.getMonth() / 3) - offset) * 3, 1);
    const last = new Date(periodStart.getFullYear(), periodStart.getMonth() + 3, 0);
    return { periodStart, periodEnd: offset === 0 ? today : endOf(last) };
  }

  const periodStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const last = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
  return { periodStart, periodEnd: offset === 0 ? today : endOf(last) };
}

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

/* ═══════════════════════════════════════════════════════════════════════════
   Ключ месяца для колонок period_start / period_end.

   ── Что было ────────────────────────────────────────────────────────────────

   Одно и то же «первое число текущего месяца» считалось двумя способами:

       ymd(new Date(y, m, 1))                          → «2026-09-01»
       new Date(y, m, 1).toISOString().split("T")[0]   → «2026-08-31»

   Второй берёт МЕСТНУЮ полночь и печатает её в UTC. Пока сервер живёт в UTC,
   обе строки совпадают, и расхождения не видно. Но TZ нигде не закреплён — ни
   в Dockerfile, ни в railway.json, — а Ташкент (+5) для этой организации самый
   естественный выбор. Поставь его кто-нибудь, и второй способ начнёт отвечать
   «31 августа» на вопрос «какое первое число сентября».

   Дальше это разъезжается на деньгах: kpi.setSalary заводит план на
   «2026-09-01», а myQuota ищет «2026-08-31» и отвечает агенту «плана нет».
   Норма, сохранённая с экрана начальника, и норма, которую ищет экран агента,
   становятся двумя разными строками за один месяц.

   Ирония в том, что рядом с обоими местами уже стоял комментарий про этот
   самый сдвиг: «Date он развернул бы в часовом поясе сервера и мог сдвинуть
   день». Опасность знали, а половина кода всё равно печатала дату через UTC.

   ── Правило ─────────────────────────────────────────────────────────────────

   Ключ периода собирается ТОЛЬКО из календарных полей (getFullYear/getMonth/
   getDate) и никогда через toISOString. Держит это правило
   api/__tests__/period-key-is-one-way.test.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Дата как «ГГГГ-ММ-ДД» по календарю, а не по смещению UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Первое и последнее число месяца, в котором лежит `at`. */
export function monthRange(at: Date = new Date()): { start: string; end: string } {
  return {
    start: dayKey(new Date(at.getFullYear(), at.getMonth(), 1)),
    end:   dayKey(new Date(at.getFullYear(), at.getMonth() + 1, 0)),
  };
}

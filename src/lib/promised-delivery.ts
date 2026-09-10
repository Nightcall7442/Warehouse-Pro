/* ═══════════════════════════════════════════════════════════════════════════
   Обещанный срок доставки: перевод в поле ввода и обратно, и вывод о срыве.

   ── Почему отдельным файлом ─────────────────────────────────────────────────

   Здесь два места, где легко ошибиться молча, и обе ошибки видны только у
   клиента:

   1. Часовой пояс. Поле <input type="datetime-local"> не знает пояса вовсе:
      оно отдаёт «2026-09-11T18:00» — местное время того, кто вводил. Через
      toISOString() это превращается в мгновение правильно, а вот обратно
      Date.toISOString().slice(0,16) даёт UTC, и в поле показалось бы время на
      пять часов раньше введённого. Ташкент — UTC+5, то есть «привезём к
      шести» превращалось бы в «к часу дня» при каждом открытии.

   2. Вывод о срыве. «Просрочен» и «доставлен позже обещанного» — разные
      вещи, и оба возможны только когда срок НАЗВАЛИ. Без срока правильный
      ответ «неизвестно», а не «в срок».
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Мгновение → значение для <input type="datetime-local"> в МЕСТНОМ времени.
 *
 * Пусто на входе — пусто на выходе: пустое поле означает «срок не называли».
 */
export function toLocalInput(v: Date | string | null | undefined): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type PromiseState =
  /** Срок не называли. Вывода о просрочке быть не может. */
  | { kind: "none" }
  /** Срок назвали, время ещё не вышло. */
  | { kind: "due"; lateMs: 0 }
  /** Заказ в работе, а срок уже прошёл. */
  | { kind: "late"; lateMs: number }
  /** Довезли, и довезли вовремя. */
  | { kind: "on_time"; lateMs: 0 }
  /** Довезли, но позже обещанного. */
  | { kind: "late_delivered"; lateMs: number }
  /** Отменён или возвращён — обещание больше ни о чём не говорит. */
  | { kind: "closed" };

/**
 * Что можно сказать про обещание.
 *
 * `now` параметром, а не Date.now() внутри: иначе проверить «просрочен» можно
 * было бы только ожиданием, а поведение на границе — никак.
 */
export function promiseState(
  promised: Date | string | null | undefined,
  status: string,
  deliveredAt?: Date | string | null,
  now: Date = new Date(),
): PromiseState {
  if (promised == null) return { kind: "none" };
  const due = promised instanceof Date ? promised : new Date(promised);
  if (Number.isNaN(due.getTime())) return { kind: "none" };

  if (status === "delivered") {
    // Без времени доставки судить не о чем: статус говорит «довезли», а когда
    // именно — неизвестно. Придумывать здесь «вовремя» нельзя.
    if (deliveredAt == null) return { kind: "on_time", lateMs: 0 };
    const got = deliveredAt instanceof Date ? deliveredAt : new Date(deliveredAt);
    if (Number.isNaN(got.getTime())) return { kind: "on_time", lateMs: 0 };
    const late = got.getTime() - due.getTime();
    return late > 0 ? { kind: "late_delivered", lateMs: late } : { kind: "on_time", lateMs: 0 };
  }

  if (status === "cancelled" || status === "returned") return { kind: "closed" };

  const late = now.getTime() - due.getTime();
  return late > 0 ? { kind: "late", lateMs: late } : { kind: "due", lateMs: 0 };
}

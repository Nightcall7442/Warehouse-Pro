/* ═══════════════════════════════════════════════════════════════════════════
   Разговор — не список сообщений.

   ── Что было ────────────────────────────────────────────────────────────────

   Обе стороны чата рисовали `messages.map` и вешали время на КАЖДУЮ реплику.
   Пять сообщений подряд от одного человека давали пять одинаковых подписей
   «08.09 14:32» — и переписка за неделю читалась одним куском, потому что
   границы суток нигде не показаны.

   Именно это и делает чат дешёвым на вид: не цвета и не скругления, а то, что
   в нём не видно ни разговора, ни времени.

   ── Что здесь ───────────────────────────────────────────────────────────────

   Плоский список превращается в ряды для отрисовки: разделители суток и
   сообщения, у каждого — признаки «первое в группе» и «последнее в группе».
   Группа это подряд идущие реплики одной стороны в пределах пяти минут: у
   первой рисуется имя и лицо автора, у последней — время и хвостик пузыря,
   у остальных ничего.

   Считается один раз для обеих сторон: у поддержки и у клиента разговор один
   и тот же, и расходиться в том, где проходит граница суток, им нельзя.
   ═══════════════════════════════════════════════════════════════════════════ */

export type ChatMessage = {
  id: number;
  /** Реплика со стороны платформы (поддержки), а не организации. */
  fromPlatform: boolean;
  createdAt: Date | string;
};

export type ThreadRow<M> =
  | { kind: "day"; key: string; at: Date; when: "today" | "yesterday" | "earlier" }
  | { kind: "msg"; key: string; msg: M; at: Date; first: boolean; last: boolean };

/**
 * Насколько далеко разносятся реплики, чтобы перестать быть одной мыслью.
 *
 * Пять минут: за это время человек дописывает начатое. Разрыв больше — уже
 * возврат к разговору, и он заслуживает отдельного времени под пузырём.
 */
export const GROUP_GAP_MS = 5 * 60_000;

/**
 * Дата из того, что пришло с сервера.
 *
 * superjson отдаёт Date, голый JSON — строку, а сломанная запись может отдать
 * и мусор. Возвращается null, а не «сегодня»: подставленная дата поставила бы
 * старое сообщение под заголовок «Сегодня», и это была бы уже неправда, а не
 * пробел в оформлении.
 */
function toDate(value: Date | string): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Ключ суток по местному времени наблюдателя. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Разложить переписку на ряды для отрисовки.
 *
 * `now` передаётся, а не берётся из часов: от него зависят слова «Сегодня» и
 * «Вчера», и проверка обязана уметь назначить их сама.
 */
export function buildThread<M extends ChatMessage>(messages: M[], now: Date): Array<ThreadRow<M>> {
  const rows: Array<ThreadRow<M>> = [];
  if (messages.length === 0) return rows;

  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));

  // Сообщение без разбираемой даты не выбрасывается: текст в нём настоящий и
  // человеку нужен. Оно просто примыкает к соседнему по времени.
  let fallback = now;
  const dated = messages.map(msg => {
    const at = toDate(msg.createdAt) ?? fallback;
    fallback = at;
    return { msg, at };
  });

  for (let i = 0; i < dated.length; i++) {
    const { msg, at } = dated[i];
    const prev = i > 0 ? dated[i - 1] : null;
    const next = i + 1 < dated.length ? dated[i + 1] : null;

    const key = dayKey(at);
    const newDay = !prev || dayKey(prev.at) !== key;
    if (newDay) {
      rows.push({
        kind: "day",
        key: `day:${key}`,
        at,
        when: key === today ? "today" : key === yesterday ? "yesterday" : "earlier",
      });
    }

    const first = newDay
      || !prev
      || prev.msg.fromPlatform !== msg.fromPlatform
      || at.getTime() - prev.at.getTime() > GROUP_GAP_MS;

    const last = !next
      || dayKey(next.at) !== key
      || next.msg.fromPlatform !== msg.fromPlatform
      || next.at.getTime() - at.getTime() > GROUP_GAP_MS;

    rows.push({ kind: "msg", key: `msg:${msg.id}`, msg, at, first, last });
  }

  return rows;
}

/**
 * Кто из агентов на связи, а кто молчит.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Страница знала только тех, кто прислал точку: сервер отдаёт последнюю
 * позицию каждого агента за сутки, и человек с выключенной геолокацией в
 * ответе просто отсутствовал. На экране это выглядело как «ВСЕГО 0» и «Нет
 * данных о локации» — при том что агенты в организации есть, они работают, и
 * супервайзеру нужен ответ ровно на тот вопрос, которого не показывали: КТО
 * НЕ ДЕЛИТСЯ. Пустой список на него не отвечает, а ноль отвечает неправильно.
 *
 * Молчание тут не исключение, а обычный день: геолокацию включает сам агент,
 * и половина смены проходит без неё. Значит список должен состоять из ВСЕХ
 * агентов справочника, а точка — лишь менять то, что в строке написано.
 *
 * ── Про время ───────────────────────────────────────────────────────────────
 *
 * «Свежесть» считается по `at` — это COALESCE(recorded_at, created_at) с
 * сервера, то есть когда агент В ТОЙ ТОЧКЕ БЫЛ. Страница читала created_at —
 * когда телефон дозвонился. Разница появляется у точек, пролежавших в буфере
 * без связи: пачка вчерашних координат, приехавшая при возврате сети, делала
 * агента «онлайн» и ставила его метку туда, где его давно нет.
 */

import { format } from "date-fns";

/** Сколько сигнал считается свежим. Дольше — человек уже мог уехать. */
export const ONLINE_WINDOW_MS = 10 * 60_000;

export type TrackedState = "online" | "stale" | "silent";

/**
 * Цвет состояния — именем переменной темы и запасным значением.
 *
 * Именем, а не значением, потому что читать его приходится по-разному: в
 * разметке через var(), а для метки карты и для расчёта читаемых чернил —
 * через cssVar(), значением. Держать оба списка порознь значит однажды
 * покрасить список одним цветом, а карту другим.
 */
export const STATE_TINT: Record<TrackedState, [string, string]> = {
  online: ["--color-success",       "#34c473"],
  stale:  ["--color-warning",       "#d4973a"],
  silent: ["--color-text-tertiary", "#6b6760"],
};

/** «5 мин назад» — на экране слежения важна давность, а не точное время. */
export function timeAgo(date: Date, lang: string): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return lang === "uz" ? "Hozir"                       : "только что";
  if (diff < 3600)  return lang === "uz" ? `${Math.floor(diff / 60)} daq`   : `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return lang === "uz" ? `${Math.floor(diff / 3600)} soat` : `${Math.floor(diff / 3600)} ч назад`;
  return format(date, "dd.MM HH:mm");
}

/** Строка справочника: активные агенты организации. */
export interface RosterEntry {
  id: number;
  name: string | null;
}

/** Точка с сервера. Числа приходят строками — это DECIMAL из MySQL. */
export interface LocationPoint {
  agentId: number;
  agentName?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
  at?: Date | string | null;
  createdAt?: Date | string | null;
  batteryLevel?: number | null;
  accuracy?: string | number | null;
}

export interface TrackedAgent {
  id: number;
  /** null — имени нет ни в справочнике, ни в точке; подпись выбирает экран. */
  name: string | null;
  state: TrackedState;
  /** Когда агент был в этой точке. null — точки нет вовсе. */
  at: Date | null;
  lat: number | null;
  lng: number | null;
  batteryLevel: number | null;
  accuracy: number | null;
}

export interface Roster {
  rows: TrackedAgent[];
  counts: { online: number; stale: number; silent: number; total: number };
  /** Самый свежий сигнал по организации; null — сигналов не было вовсе. */
  lastSignalAt: Date | null;
}

/**
 * Координата числом.
 *
 * Ноль отбрасывается вместе с пустотой и мусором намеренно: широту 0 в
 * Узбекистане не выдаёт ни один прибор, зато её выдаёт незаполненное поле —
 * Number(null) и Number("") тоже дают ноль. Метка в Гвинейском заливе на
 * карте города вреднее отсутствующей.
 */
function coord(v: string | number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function time(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Когда агент был в точке, а не когда точка доехала до сервера. */
function pointTime(p: LocationPoint): Date | null {
  return time(p.at) ?? time(p.createdAt);
}

/** Порядок состояний: сначала те, по кому можно принять решение сейчас. */
const RANK: Record<TrackedState, number> = { online: 0, stale: 1, silent: 2 };

export function buildRoster(
  roster: readonly RosterEntry[],
  points: readonly LocationPoint[],
  now: number = Date.now(),
): Roster {
  // Одна точка на агента. Сервер и так отдаёт по одной, но полагаться на это
  // нельзя: дубль в ответе дал бы две строки на одного человека и удвоил счёт
  // в шапке.
  const byAgent = new Map<number, LocationPoint>();
  for (const p of points) {
    const prev = byAgent.get(p.agentId);
    if (!prev || (pointTime(p)?.getTime() ?? 0) > (pointTime(prev)?.getTime() ?? 0)) {
      byAgent.set(p.agentId, p);
    }
  }

  const names = new Map<number, string | null>();
  for (const a of roster) names.set(a.id, a.name);
  // Точка от того, кого нет в справочнике — уволенного вчера агента или
  // супервайзера, поделившегося своей, — всё равно строка: её метка на карте
  // есть, и список, который о ней молчит, врёт про карту.
  for (const [id, p] of byAgent) if (!names.has(id)) names.set(id, p.agentName ?? null);

  const rows: TrackedAgent[] = [];
  for (const [id, rosterName] of names) {
    const p = byAgent.get(id);
    const at = p ? pointTime(p) : null;
    const state: TrackedState = !at
      ? "silent"
      : now - at.getTime() <= ONLINE_WINDOW_MS ? "online" : "stale";
    const name = (rosterName ?? p?.agentName ?? "").trim();
    rows.push({
      id,
      name: name || null,
      state,
      at,
      lat: coord(p?.lat),
      lng: coord(p?.lng),
      batteryLevel: p?.batteryLevel ?? null,
      accuracy: p?.accuracy == null ? null : Number(p.accuracy),
    });
  }

  rows.sort((a, b) =>
    RANK[a.state] - RANK[b.state]
    || (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)
    || (a.name ?? "").localeCompare(b.name ?? "", "ru"),
  );

  const counts = { online: 0, stale: 0, silent: 0, total: rows.length };
  let lastSignalAt: Date | null = null;
  for (const r of rows) {
    counts[r.state]++;
    if (r.at && (!lastSignalAt || r.at > lastSignalAt)) lastSignalAt = r.at;
  }

  return { rows, counts, lastSignalAt };
}

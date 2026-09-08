/**
 * Ряды мониторинга — на одну секундную сетку.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ряды сливались в Map и отдавались графикам в порядке ВСТАВКИ. Ряды запросов
 * пишутся по целым секундам и только когда запрос действительно был; память —
 * раз в пять секунд, по произвольной миллисекунде. Ключи не совпадали, ключи
 * памяти ложились в конец — и ось времени уходила вспять:
 *
 *     19:52:58   19:53:33   19:53:59   19:51:52   19:52:47   19:53:52
 *
 * На графике это выглядело так: линии запросов обрывались на двух третях, а
 * память рисовалась отдельным куском в последней трети. Каждый график врал про
 * своё время, и сравнить два между собой было нельзя.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Точка на оси должна быть всегда, а не только когда кто-то что-то записал.
 * Здесь строится сетка на каждую секунду окна, и все ряды раскладываются по
 * ней. Ось у всех графиков после этого одна и та же, и всплеск времени ответа
 * можно приложить к всплеску очереди за соединением.
 */

export interface SeriesPoint {
  timestamp: number;
  value: number;
}

export type SeriesMap = Record<string, { data: SeriesPoint[] } | undefined>;

/** Одна секунда на графиках. Поля необязательные: ряда может не быть вовсе. */
export interface MetricRow {
  time: string;
  rps?: number;
  response?: number;
  /** Худший ответ за ту же секунду. */
  worst?: number;
  errors?: number;
  heap?: number;
  rss?: number;
  /** Занятых соединений с базой. */
  dbBusy?: number;
  /** Запросов, ждущих свободного соединения. */
  dbQueue?: number;
  /** Задержка цикла событий, хвост p99. */
  lag?: number;
}

/**
 * Скорости: отсутствие точки значит «за эту секунду не было ничего», то есть
 * ноль. Запросов не было — значит ноль запросов, а не «столько же, сколько
 * раньше».
 */
const RATES = [
  ["rps",      "req_per_sec"],
  ["response", "avg_response_ms"],
  ["worst",    "max_response_ms"],
  ["errors",   "errors_per_sec"],
] as const;

/**
 * Уровни: отсутствие точки значит лишь «в этот момент не замеряли». Величина
 * никуда не делась, поэтому тянется последнее известное значение. Ноль здесь
 * показал бы падение памяти до нуля четыре секунды из каждых пяти.
 */
const GAUGES = [
  ["heap",    "heap_used_mb"],
  ["rss",     "rss_mb"],
  ["dbBusy",  "db_pool_busy"],
  ["dbQueue", "db_pool_queue"],
  ["lag",     "event_loop_lag_ms"],
] as const;

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function buildMetricGrid(series: SeriesMap, spanSeconds: number): MetricRow[] {
  const at = (name: string) => series[name]?.data ?? [];

  /*
    «Сейчас» берётся из самих данных, а не с часов браузера: часы посетителя
    могут отличаться от серверных на минуты, и тогда окно уехало бы целиком, а
    графики оказались пустыми при исправном сборе.
  */
  let lastTs = 0;
  for (const [, name] of [...RATES, ...GAUGES]) {
    const points = at(name);
    if (points.length) lastTs = Math.max(lastTs, points[points.length - 1].timestamp);
  }
  if (!lastTs) return [];

  const rateAt = (name: string) => {
    const m = new Map<number, number>();
    for (const p of at(name)) m.set(Math.floor(p.timestamp / 1000), p.value);
    return (sec: number) => m.get(sec) ?? 0;
  };

  const gaugeAt = (name: string) => {
    // Ряд приходит по возрастанию времени, и сетка обходится тоже по
    // возрастанию, поэтому хватает одного прохода с запоминанием последнего
    // значения. Заодно это само подхватывает замер, сделанный ДО начала окна.
    const points = at(name);
    let i = 0;
    let last: number | undefined;
    return (sec: number) => {
      while (i < points.length && Math.floor(points[i].timestamp / 1000) <= sec) last = points[i++].value;
      return last;
    };
  };

  const rates  = RATES.map(([key, name]) => [key, rateAt(name)] as const);
  const gauges = GAUGES.map(([key, name]) => [key, gaugeAt(name)] as const);

  const lastSec = Math.floor(lastTs / 1000);
  const rows: MetricRow[] = [];
  for (let sec = lastSec - (spanSeconds - 1); sec <= lastSec; sec++) {
    const row: MetricRow = { time: formatClock(sec * 1000) };
    for (const [key, read] of rates) {
      // Десятых достаточно: миллисекунды с шестью знаками читать невозможно.
      row[key] = Math.round(read(sec) * 10) / 10;
    }
    for (const [key, read] of gauges) {
      const value = read(sec);
      if (value !== undefined) row[key] = value;
    }
    rows.push(row);
  }
  return rows;
}

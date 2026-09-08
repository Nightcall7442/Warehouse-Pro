import v8 from "node:v8";
import { register } from "../prometheus-metrics";
import { poolStats } from "../queries/connection";

/* ═══════════════════════════════════════════════════════════════════════════
   Насыщение: сколько запаса осталось.

   ── Четвёртый сигнал, которого не было ──────────────────────────────────────

   Страница показывала три вещи из четырёх, по которым судят о здоровье службы:
   трафик, время ответа и ошибки. Четвёртой — насыщения — не было вовсе.

   Разница между ними существенная. Первые три говорят, что происходит СЕЙЧАС;
   насыщение говорит, сколько осталось до того, как станет плохо. Упёршийся в
   потолок пул соединений виден в них только последствием: время ответа растёт
   при совершенно здоровой базе, и причину ищут не там.

   ── Что здесь считается ─────────────────────────────────────────────────────

   · соединения с базой — наш пул против своего потолка. Не «Threads_connected»
     из SHOW STATUS: то потоки всей базы, включая чужие, и по ним нельзя
     сказать, упёрлись ли МЫ;
   · очередь за соединением — сколько запросов уже ждут. Ненулевая очередь и
     есть тот момент, когда потолок начал стоить времени;
   · задержка цикла событий — сколько миллисекунд ждала очередная задача.
     Растёт от тяжёлой синхронной работы, и никакая база тут ни при чём;
   · куча — сколько занято из того, что вообще позволено этому процессу.

   ── Чего здесь нет намеренно ────────────────────────────────────────────────

   Памяти контейнера. Node не знает предела, выставленного платформой, а
   выдумывать его по process.memoryUsage нельзя: получилось бы число, которое
   выглядит как ответ, но им не является. Потолок кучи процесс знает точно —
   его и показываем.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SaturationItem {
  key: string;
  title: string;
  /** Текущее значение. */
  value: number;
  /** Потолок, если он известен. */
  limit: number | null;
  /** Приписка к числу: «мс», «МБ». Не единица измерения товара. */
  suffix: string;
  /** Доля занятого, 0..1. Пусто — потолок неизвестен. */
  ratio: number | null;
  /** Спокойно / близко к пределу / уже больно. */
  level: "ok" | "warn" | "hot";
  hint: string;
}

/** Задержка цикла событий из реестра prom-client, в миллисекундах. */
async function eventLoopLagMs(): Promise<number | null> {
  const metrics = await register.getMetricsAsJSON();
  /*
    Берётся p99, а не среднее. Среднее по циклу событий почти всегда близко к
    нулю даже тогда, когда часть запросов уже ждёт: одна тяжёлая синхронная
    операция в секунду теряется в тысяче лёгких. Хвост показывает именно её.
  */
  const m = metrics.find(x => x.name === "nodejs_eventloop_lag_p99_seconds")
    ?? metrics.find(x => x.name === "nodejs_eventloop_lag_seconds");
  const v = m?.values?.[0]?.value;
  return typeof v === "number" ? Math.round(v * 1000) : null;
}

function levelOf(ratio: number | null, warn: number, hot: number): "ok" | "warn" | "hot" {
  if (ratio === null) return "ok";
  if (ratio >= hot) return "hot";
  if (ratio >= warn) return "warn";
  return "ok";
}

export async function saturation(): Promise<SaturationItem[]> {
  const items: SaturationItem[] = [];

  const pool = poolStats();
  if (pool) {
    const ratio = pool.limit > 0 ? pool.busy / pool.limit : null;
    items.push({
      key: "db-pool",
      title: "Соединения с базой",
      value: pool.busy,
      limit: pool.limit,
      suffix: "",
      ratio,
      level: levelOf(ratio, 0.7, 0.9),
      hint: "Заняты из потолка DB_CONNECTION_LIMIT. У потолка запросы встают в очередь, и время ответа растёт при здоровой базе.",
    });

    items.push({
      key: "db-queue",
      title: "Очередь за соединением",
      value: pool.waiting,
      limit: null,
      suffix: "",
      ratio: null,
      // Очередь — не доля, а событие: ноль это норма, любое другое число уже
      // означает, что кто-то ждёт.
      level: pool.waiting === 0 ? "ok" : pool.waiting > 5 ? "hot" : "warn",
      hint: "Сколько запросов ждут свободного соединения. Ноль — норма; всё остальное значит, что потолок уже стоит времени.",
    });
  }

  const lag = await eventLoopLagMs();
  if (lag !== null) {
    // Сотня миллисекунд — тот порог, за которым задержку уже видно человеку в
    // отклике приложения; за двумя сотнями это заметно всем.
    items.push({
      key: "event-loop",
      title: "Задержка цикла событий",
      value: lag,
      limit: null,
      suffix: "мс",
      ratio: null,
      level: lag >= 200 ? "hot" : lag >= 100 ? "warn" : "ok",
      hint: "Сколько ждала очередная задача (хвост p99). Растёт от тяжёлой синхронной работы — база тут ни при чём.",
    });
  }

  const heap = v8.getHeapStatistics();
  if (heap.heap_size_limit > 0) {
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    items.push({
      key: "heap",
      title: "Куча",
      value: Math.round(heap.used_heap_size / 1024 / 1024),
      limit: Math.round(heap.heap_size_limit / 1024 / 1024),
      suffix: "МБ",
      ratio,
      level: levelOf(ratio, 0.75, 0.9),
      hint: "Занято из того, что позволено процессу. Предел контейнера Node не знает, поэтому показан предел кучи — его он знает точно.",
    });
  }

  return items;
}

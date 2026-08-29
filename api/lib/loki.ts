import { env } from "./env";

/* ═══════════════════════════════════════════════════════════════════════════
   Отправка журнала в Loki.

   Записи как шли в stdout, так и идут — журнал Railway остаётся на месте. Loki
   добавляется рядом: он умеет искать по всем запускам сразу, а не только по
   тому, что ещё не вытеснено из буфера панели.

   ── Почему ярлыков ровно три ───────────────────────────────────────────────

   Loki строит указатель по ярлыкам, и каждое их сочетание — отдельный поток.
   Заманчиво положить в ярлыки correlationId, userId или маршрут: тогда поиск
   был бы «по ярлыку». Но идентификатор запроса уникален, то есть каждая
   запись стала бы отдельным потоком — указатель распухнет и Loki встанет.
   Это та же ошибка, что и путь в ярлыке метрики, только дороже.

   Поэтому ярлыков три и все с малым числом значений: приложение, уровень,
   среда. Всё остальное — correlationId, userId, tenantId, маршрут — остаётся
   внутри строки JSON, и Loki ищет по ней разбором на лету.

   ── Почему отправка не может уронить приложение ────────────────────────────

   Очередь ограничена. Loki недоступен, отвечает медленно, отвечает ошибкой —
   записи копятся до потолка, дальше вытесняются самые старые. Ни ожидания в
   обработчике запроса, ни роста памяти без предела, ни исключения наружу.
   Журнал — вспомогательная вещь, из-за неё склад останавливаться не должен.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько записей держим, пока Loki недоступен. Дальше вытесняем старые. */
const MAX_QUEUE = 2000;
/** Сколько записей уходит за один раз. */
const MAX_BATCH = 200;
/** Как часто отправляем накопленное. */
const FLUSH_MS = 2000;
/** Сколько ждём ответа Loki, прежде чем считать попытку неудачной. */
const TIMEOUT_MS = 5000;

type Entry = { level: string; line: string; timeNs: string };

const queue: Entry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;

/** Сколько записей выброшено из-за переполнения — чтобы это не было тихо. */
let dropped = 0;
let lastComplaintAt = 0;

function enabled(): boolean {
  return Boolean(env.lokiUrl);
}

/**
 * Жалоба пишется прямо в stderr, а не через logger.
 *
 * Через logger получилась бы петля: неудача отправки порождает запись, запись
 * идёт в очередь, очередь снова не отправляется. И не чаще раза в минуту,
 * иначе недоступный Loki сам зальёт журнал Railway.
 */
function complain(message: string) {
  const now = Date.now();
  if (now - lastComplaintAt < 60_000) return;
  lastComplaintAt = now;
  process.stderr.write(JSON.stringify({
    level: "warn",
    time: new Date().toISOString(),
    msg: `loki: ${message}`,
    ...(dropped > 0 ? { droppedSinceStart: dropped } : {}),
  }) + "\n");
}

/**
 * Положить строку в очередь на отправку.
 *
 * Вызывается из logger.emit на каждую запись, поэтому здесь не должно быть
 * ничего тяжелее вставки в массив.
 */
export function queueForLoki(level: string, line: string) {
  if (!enabled()) return;

  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    dropped++;
    complain("очередь переполнена, самые старые записи вытесняются");
  }

  // Loki ждёт наносекунды строкой. Date.now() даёт миллисекунды.
  queue.push({ level, line, timeNs: `${Date.now()}000000` });

  if (!timer) {
    timer = setInterval(() => { void flushLoki(); }, FLUSH_MS);
    // Таймер не должен держать процесс живым при остановке.
    timer.unref?.();
  }
}

/** Записи группируются по уровню: у Loki поток — это набор ярлыков. */
function toStreams(batch: Entry[]) {
  const byLevel = new Map<string, [string, string][]>();
  for (const e of batch) {
    const values = byLevel.get(e.level) ?? [];
    values.push([e.timeNs, e.line]);
    byLevel.set(e.level, values);
  }
  return [...byLevel.entries()].map(([level, values]) => ({
    stream: {
      app: "warehouse-pro",
      level,
      env: env.isProduction ? "production" : "development",
    },
    values,
  }));
}

/**
 * Отправить накопленное.
 *
 * Возвращает управление и при неудаче — вызывающему знать о ней незачем.
 */
export async function flushLoki(): Promise<void> {
  if (!enabled() || sending || queue.length === 0) return;

  sending = true;
  const batch = queue.splice(0, MAX_BATCH);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.lokiBasicAuth) {
      headers.Authorization = `Basic ${Buffer.from(env.lokiBasicAuth).toString("base64")}`;
    }

    const res = await fetch(`${env.lokiUrl!.replace(/\/+$/, "")}/loki/api/v1/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ streams: toStreams(batch) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // 400 от Loki — это почти всегда наша ошибка в формате или порядке
      // времени, и повторять её бессмысленно: партия отбрасывается.
      // Всё остальное (5xx, недоступность) — повод попробовать ещё раз.
      if (res.status >= 500 || res.status === 429) {
        queue.unshift(...batch);
      } else {
        dropped += batch.length;
      }
      complain(`ответ ${res.status}`);
    }
  } catch (e) {
    // Сеть, разрешение имени, срок ожидания. Партию возвращаем в очередь.
    queue.unshift(...batch);
    complain(`отправка не удалась: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    sending = false;
  }
}

/**
 * Дослать остаток при остановке.
 *
 * Без этого последние секунды перед перезапуском теряются целиком — а это ровно
 * те записи, ради которых в журнал и заглядывают после падения.
 */
export async function shutdownLoki(): Promise<void> {
  if (!enabled()) return;
  if (timer) { clearInterval(timer); timer = null; }
  // Несколько подходов: за один уходит не больше MAX_BATCH.
  for (let i = 0; i < 5 && queue.length > 0; i++) {
    await flushLoki();
  }
}

/** Для проверок. */
export function _lokiQueueSize(): number {
  return queue.length;
}

import type { Server, ServerResponse } from "node:http";
import { logger } from "./logger";

/* ═══════════════════════════════════════════════════════════════════════════
   Остановка без обрыва запросов.

   ── Что было ────────────────────────────────────────────────────────────────

   Выкладка — около семи в день, в рабочее время. Старому экземпляру приходит
   SIGTERM, и обработчик сразу досылал журнал, закрывал пул базы и выходил. Кто
   в эту секунду оформлял заказ, отмечал доставку или загружал Excel, получал
   обрыв: запрос шёл, а базы под ним уже не было. К тому же Railway по
   умолчанию даёт между SIGTERM и SIGKILL ноль секунд — ждать было и некогда.

   ── Что теперь ──────────────────────────────────────────────────────────────

   По сигналу:
     1. проверка готовности отвечает 503;
     2. новые соединения не принимаются (server.close закрывает и простаивающие),
        а ответы запросов в полёте уходят с «Connection: close» — соединение
        закроется сразу за ответом, и прокси не пришлёт по нему следующий;
     3. расписание не начинает новых работ, потоки событий закрываются — иначе
        они держали бы остановку до конца срока: браузер переподключится сам,
        уже к новому экземпляру;
     4. ждём, пока закончатся запросы в полёте, идущие работы расписания и
        то, что запросы оставили после ответа (inBackground), — не дольше
        timeoutMs;
     5. что не успело — обрываем; досылаем журнал и закрываем пул (не дольше
        четверти срока) и выходим.

   Запросы считаются здесь, на уровне http-сервера, а не счётчиком Prometheus:
   тот живёт только при включённых метриках и отпускает запрос, как только
   обработчик вернул ответ, — а тело большой выгрузки ещё идёт. Здесь запрос
   закончен, когда ответ ушёл целиком или соединение оборвалось.

   Срок с четвертью на закрытие обязан укладываться в то, что платформа даёт
   до SIGKILL (railway.json → deploy.drainingSeconds), иначе ждать не дадут.
   ═══════════════════════════════════════════════════════════════════════════ */

let draining = false;

/** Идёт остановка — проверка готовности отвечает 503. */
export function isDraining(): boolean {
  return draining;
}

/*
  Работа, которую ответ не ждёт: колокольчик и push о новом заказе, Telegram о
  доставке, запись в журнал обмена. Ответ ушёл — для сервера запрос кончился, а
  она ещё идёт. Без учёта остановка закрывала бы пул прямо под ней, а выход
  обрывал бы отправку: заказ, оформленный в секунду выкладки, оставался бы без
  уведомления.
*/
const detached = new Set<Promise<unknown>>();

/**
 * Запустить без ожидания — вместо `void`: остановка процесса дождётся и этого.
 * Отказ не глотается — как у `void`, он доходит до unhandledRejection.
 */
export function inBackground(p: Promise<unknown>): void {
  detached.add(p);
  void p.finally(() => { detached.delete(p); });
}

type Options = {
  /** Сколько ждать незаконченное, мс. */
  timeoutMs: number;
  /** Перестать брать новое: расписание, потоки событий. */
  stopIntake: () => void;
  /** Сколько работ расписания ещё идёт. */
  busyJobs: () => number;
  /** Дослать журнал и закрыть пул — когда ждать больше нечего. */
  cleanup: () => Promise<void>;
  /** Для проверок; в бою — process.exit. */
  exit?: (code: number) => void;
};

/**
 * Подключить учёт запросов к серверу и вернуть остановку.
 *
 * Вызывать сразу после создания сервера: запрос, пришедший до подключения
 * учёта, дожидаться не будут. Повторный сигнал получает ту же остановку, а не
 * вторую поверх первой.
 */
export function gracefulShutdown(server: Server, o: Options): (signal: string) => Promise<void> {
  const open = new Set<ServerResponse>();
  server.on("request", (_req, res) => {
    open.add(res);
    res.once("close", () => { open.delete(res); });
  });
  const pending = () => open.size + o.busyJobs() + detached.size;

  let started: Promise<void> | null = null;
  return (signal) => (started ??= run(signal));

  async function run(signal: string): Promise<void> {
    draining = true;
    logger.info(`${signal} received, draining`, { requests: open.size, jobs: o.busyJobs(), background: detached.size, timeoutMs: o.timeoutMs });
    server.close();
    for (const res of open) {
      if (!res.headersSent) res.setHeader("Connection", "close");
    }
    o.stopIntake();

    const deadline = Date.now() + o.timeoutMs;
    while (pending() > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (pending() > 0) {
      logger.warn("shutdown timeout — cutting what is left", { requests: open.size, jobs: o.busyJobs(), background: detached.size });
    }
    // Остались простаивающие соединения — или те, чей срок вышел.
    server.closeAllConnections();

    /*
      Закрытию — четверть срока, и не больше. pool.end() ждёт запрос, который
      ещё выполняется в базе (проверено на MySQL: SELECT SLEEP(5) держит его
      пять секунд), а после срока такой запрос как раз и может остаться;
      досылка журнала при недоступном Loki — до 5 с на пачку. 20 с ожидания и
      5 с закрытия укладываются в 30 с до SIGKILL.
    */
    const closing = o.cleanup().catch(e => { logger.error("shutdown cleanup failed", { error: String(e) }); });
    const closeLimit = new Promise<"limit">(r => setTimeout(() => r("limit"), o.timeoutMs / 4).unref());
    if (await Promise.race([closing, closeLimit]) === "limit") {
      logger.error("shutdown cleanup did not finish in time — exiting anyway", { limitMs: o.timeoutMs / 4 });
    }
    (o.exit ?? process.exit)(0);
  }
}

import { getPool, getDb } from "../queries/connection";
import { cronRuns } from "@db/schema";
import { logger } from "../lib/logger";
import { cronLastSuccessTimestamp } from "../prometheus-metrics";

/* ═══════════════════════════════════════════════════════════════════════════
   Расписание работ — внутри приложения.

   ── Что было ────────────────────────────────────────────────────────────────

   Работы по расписанию оформлены ручками HTTP: /api/cron/debt-reminders,
   /api/cron/trial-reminders, /api/cron/backup. Ручки написаны, ключом закрыты,
   в коде разобраны до мелочей — и НИ ОДНА ИЗ НИХ НИКОГДА НЕ ВЫЗЫВАЛАСЬ.
   Проверено по счётчикам Prometheus: за всё время наблюдения по путям
   /api/cron/* нет ни одного запроса.

   То есть напоминания о долгах не уходили, об окончании пробного периода тоже,
   а ночная копия базы не делалась (см. api/services/db-dump.ts — там сошлись
   сразу две причины). Снаружи всё выглядело настроенным: код на месте, ключ
   задан, ручка отвечает 401 без ключа — то есть «работает».

   ── Почему расписание здесь, а не снаружи ───────────────────────────────────

   Внешний вызыватель — ещё одна вещь, которую надо не забыть настроить, и
   единственный признак её отсутствия — тишина. Ровно так это и вышло. Пока
   расписание живёт в приложении, оно выкладывается вместе с кодом: забыть
   нельзя, потому что забывать нечего.

   Ручки HTTP остаются: по ним работу запускают руками, когда надо проверить
   или догнать пропущенное.

   ── Про несколько экземпляров ───────────────────────────────────────────────

   Замок MySQL GET_LOCK — тот же приём, что у миграций. Он привязан к
   соединению: умер процесс посреди работы — замок освободился сам. Без него
   вторая реплика разошлёт вторые копии тех же уведомлений.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Часовой пояс, в котором названы часы ниже. Ташкент, UTC+5 без перехода. */
const OFFSET_MS = 5 * 3600 * 1000;

type Job = {
  name: string;
  /** Час и минута по Ташкенту — для ежедневных; weekday (0 = воскресенье) — раз в неделю. */
  daily?: { hour: number; minute: number; weekday?: number };
  /** Либо просто «раз в столько-то минут». */
  everyMinutes?: number;
  /**
    Сколько часов после назначенного времени работу ещё стоит догонять.
    Без значения — до следующего назначенного времени. Напоминаниям и сводкам
    хватает трёх: сводка за день, пришедшая в полночь, никому не нужна.
  */
  catchUpHours?: number;
  run: () => Promise<unknown>;
};

const JOBS: Job[] = [
  {
    // Ночная очередь Telegram. Часто, потому что в восемь утра накопленное
    // должно уйти сразу, а не «когда-нибудь в течение часа».
    name: "telegram-outbox",
    everyMinutes: 5,
    run: async () => (await import("../services/telegram-notify")).drainOutbox(),
  },
  {
    // Вечерняя сводка. Двадцать часов: рабочий день закрыт, до тихих часов ещё
    // два часа — сообщение успевает прийти сегодня, а не лечь в очередь.
    name: "telegram-digest",
    daily: { hour: 20, minute: 0 },
    catchUpHours: 3,
    run: async () => (await import("./telegram-digest")).runTelegramDigest(),
  },
  {
    // Долги — утром рабочего дня: по ним звонят, а не читают на ночь.
    name: "debt-reminders",
    daily: { hour: 9, minute: 0 },
    catchUpHours: 3,
    run: async () => (await import("./debt-reminders")).runDebtReminders(),
  },
  {
    name: "trial-reminders",
    daily: { hour: 9, minute: 30 },
    catchUpHours: 3,
    run: async () => (await import("./trial-reminders")).runTrialReminders(),
  },
  {
    // Копия базы — ночью, когда склад не работает и запросов меньше всего.
    name: "backup",
    daily: { hour: 3, minute: 0 },
    run: async () => {
      const r = await (await import("./backup")).runBackup();
      // Неудача копии — провал работы, а не «результат»: пусть идёт той же
      // дорогой, что исключение, и доходит до суперадмина.
      if (!r.success) throw new Error(r.message);
      return r;
    },
  },
  {
    // Сводка суперадмину — после вечерних сводок арендаторам (20:00).
    name: "admin-digest",
    daily: { hour: 21, minute: 0 },
    catchUpHours: 3,
    run: async () => (await import("./admin-digest")).runAdminDigest(),
  },
  {
    /*
      Уборка чата поддержки: закрыть молчащие разговоры и стереть тексты тех,
      что закрыты неделю назад.

      Полчетвёртого — после копии базы, а не до неё. Порядок здесь имеет
      смысл: в ночной копии переписка ещё есть, и если стирание окажется
      ошибочным, восстановить будет откуда.
    */
    name: "support-cleanup",
    daily: { hour: 3, minute: 30 },
    run: async () => {
      const s = await import("../services/support-chat");
      const closed = await s.autoCloseSilent();
      const purged = await s.purgeClosedThreads();
      return { ...closed, ...purged };
    },
  },
  {
    /*
      Срок хранения уведомлений: прочитанное месяц, непрочитанное три.

      Своей работой, а не вместе с уборкой чата: обе стирают, и споткнись
      первая — вторая не выполнилась бы вовсе, а узнали бы мы об этом по
      размеру базы через полгода.
    */
    name: "notifications-cleanup",
    daily: { hour: 3, minute: 40 },
    run: async () => {
      const { getDb } = await import("../queries/connection");
      const { NotificationService } = await import("../services/NotificationService");
      return NotificationService.purgeOld(getDb());
    },
  },
  {
    /*
      Срок хранения журнала выгрузок наружу — тридцать дней.

      Суточное испытание приёмки (17-H) укладывается с большим запасом, а
      расти без конца журналу обращений нельзя: при потолке в шестьдесят
      запросов в минуту на ключ это восемьдесят шесть тысяч строк в сутки в
      худшем случае.

      Своей работой, а не вместе с соседней уборкой: обе стирают, и споткнись
      первая — вторая не выполнилась бы вовсе.
    */
    name: "api-export-log-cleanup",
    daily: { hour: 3, minute: 50 },
    run: async () => (await import("../public/export-log")).purgeOldExports(),
  },
  {
    /*
      Точка заказа: раз в полчаса — кто пересёк порог с прошлой проверки.
      Не на каждом списании: тогда приход из десяти позиций и день продаж
      давали бы поток одиночных сообщений; здесь — одно на организацию, списком.
    */
    name: "low-stock-alerts",
    everyMinutes: 30,
    run: async () => (await import("../services/reorder")).runLowStockAlerts(),
  },
  {
    /*
      Старые фото из базы — в хранилище, пачкой в ночь. Без S3 не делает
      ничего. После ночной копии, как и уборки: в копии картинки ещё есть.
    */
    name: "photos-to-s3",
    daily: { hour: 4, minute: 30 },
    run: async () => (await import("../services/photo-offload")).runPhotoOffload(),
  },
  {
    /*
      Сырые GPS-точки старше девяноста дней. Своей работой по тому же правилу,
      что и соседние стирающие: споткнись одна — остальные выполняются.
      После ночной копии (03:00), как и все уборки: в копии точки ещё есть.
    */
    name: "agent-locations-cleanup",
    daily: { hour: 4, minute: 0 },
    run: async () => (await import("../services/location-retention")).purgeOldLocations(),
  },
  {
    /*
      Репетиция восстановления — раз в неделю, в воскресенье, после ночной
      копии: разворачивает последнюю загруженную копию в черновую базу и
      сверяет числа. Копия, которую никто не разворачивал, — надежда, а не копия.
    */
    name: "restore-drill",
    daily: { hour: 5, minute: 0, weekday: 0 },
    run: async () => {
      const r = await (await import("./restore-drill")).runRestoreDrill();
      if (!r.success) throw new Error(r.message);
      return r;
    },
  },
];

/** Когда работа выполнялась в последний раз — чтобы не повторяться в ту же минуту. */
const lastRun = new Map<string, string>();

/* ═══════════════════════════════════════════════════════════════════════════
   Догон пропущенного.

   ── Что было ────────────────────────────────────────────────────────────────

   Ежедневная работа срабатывала ровно в свою минуту — и только в неё. Процесс
   перезапустился в 02:59 и поднялся в 03:02 — копии за эту ночь нет. Упала
   сама работа (хранилище ответило «повторите позже») — тоже до завтра. Узнать
   об этом можно было только по тревоге через 26 часов.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Ежедневная работа ДОЛЖНА выполниться после своего часа. Планировщик помнит
   в cron_runs, когда она удавалась в последний раз, и пока удачи после
   назначенного момента нет — пробует раз в час, в окне catchUpHours.

   Догоняются только работы, удававшиеся хотя бы однажды: у работы без отметки
   планировщик не знает, делалась ли она сегодня старым процессом, и после
   каждой выкладки слал бы напоминания второй раз. Такая работа идёт как
   прежде — ровно в свою минуту, — пока не удастся впервые.

   Ежедневные работы одного тика идут по одной, в порядке списка: уборки
   стоят после ночной копии не случайно, и догон обязан это сохранить.
   Работы «раз в N минут» догона не знают: следующий запуск и есть догон.
   ═══════════════════════════════════════════════════════════════════════════ */
const RETRY_MS = 60 * 60_000;

const lastSuccess = new Map<string, number>();   // из cron_runs; мс
const lastAttempt = new Map<string, number>();   // только память; мс
const notified = new Map<string, number>();      // работа → назначенный момент, о провале которого уже сказано
let stateLoaded = false;
let ticking = false;

/** Отметки в базе. Отдельным объектом — чтобы проверки подменяли его, а не drizzle. */
const store = {
  async load(): Promise<Array<{ job: string; lastSuccessAt: Date | null }>> {
    return getDb().select({ job: cronRuns.job, lastSuccessAt: cronRuns.lastSuccessAt }).from(cronRuns);
  },
  async saveSuccess(job: string, at: Date): Promise<void> {
    await getDb().insert(cronRuns).values({ job, lastSuccessAt: at })
      .onDuplicateKeyUpdate({ set: { lastSuccessAt: at } });
  },
  async saveFailure(job: string, at: Date, error: string): Promise<void> {
    const lastError = error.slice(0, 2000);
    await getDb().insert(cronRuns).values({ job, lastErrorAt: at, lastError })
      .onDuplicateKeyUpdate({ set: { lastErrorAt: at, lastError } });
  },
};

async function loadState(): Promise<void> {
  try {
    for (const r of await store.load()) {
      if (!r.lastSuccessAt) continue;
      lastSuccess.set(r.job, r.lastSuccessAt.getTime());
      cronLastSuccessTimestamp.set({ job: r.job }, Math.floor(r.lastSuccessAt.getTime() / 1000));
    }
    stateLoaded = true;
  } catch (e) {
    logger.warn("cron state not loaded — no catch-up until it is", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Последний назначенный момент работы не позже `now`; для еженедельной — в её день. */
function lastDue(job: Job, now: Date): Date | null {
  const d = job.daily!;
  const local = new Date(now.getTime() + OFFSET_MS);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), d.hour, d.minute) - OFFSET_MS;
  for (let back = 0; back < 8; back++) {
    const at = today - back * 86_400_000;
    if (at > now.getTime()) continue;
    if (d.weekday !== undefined && new Date(at + OFFSET_MS).getUTCDay() !== d.weekday) continue;
    return new Date(at);
  }
  return null;
}

/** Ради какого назначенного момента работу надо запустить сейчас — или null. */
function dueSlot(job: Job, now: Date): Date | null {
  const due = lastDue(job, now);
  if (!due) return null;
  if (now.getTime() - due.getTime() > (job.catchUpHours ?? 24) * 3_600_000) return null;
  if ((lastSuccess.get(job.name) ?? 0) >= due.getTime()) return null;
  if (now.getTime() - (lastAttempt.get(job.name) ?? -Infinity) < RETRY_MS) return null;
  return due;
}

/** Как прежде: ровно в свою минуту и не дважды в неё. */
function exactMinute(job: Job, now: Date): boolean {
  if (!isDue(job, now)) return false;
  const key = stamp(now);
  if (lastRun.get(job.name) === key) return false;
  lastRun.set(job.name, key);
  return true;
}

async function tick(now = new Date()): Promise<void> {
  for (const job of JOBS) {
    if (job.everyMinutes && exactMinute(job, now)) void runExclusively(job);
  }
  // Ежедневные — по одной. Прошлый тик ещё не закончил (идёт копия) — ждём его.
  if (ticking) return;
  ticking = true;
  try {
    if (!stateLoaded) await loadState();
    for (const job of JOBS) {
      if (job.everyMinutes) continue;
      const known = stateLoaded && lastSuccess.has(job.name);
      const due = known ? dueSlot(job, now) : (exactMinute(job, now) ? now : null);
      if (!due) continue;
      lastAttempt.set(job.name, now.getTime());
      await runExclusively(job, due);
    }
  } finally {
    ticking = false;
  }
}

/** Отметка «год-месяц-день час:минута» по Ташкенту. */
function stamp(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

function isDue(job: Job, at: Date): boolean {
  const local = new Date(at.getTime() + OFFSET_MS);
  if (job.everyMinutes) {
    return local.getUTCMinutes() % job.everyMinutes === 0;
  }
  const d = job.daily!;
  if (d.weekday !== undefined && local.getUTCDay() !== d.weekday) return false;
  return local.getUTCHours() === d.hour && local.getUTCMinutes() === d.minute;
}

/**
 * Выполнить работу под замком.
 *
 * Замок не ждёт очереди (нулевой тайм-аут): если его держит другая реплика,
 * значит работа уже идёт, и вторая копия не нужна.
 */
async function runExclusively(job: Job, due?: Date): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  // Соединение берётся ВНУТРИ защиты. Стояло снаружи: когда в минуту тика база
  // недоступна (перезапуск MySQL, сетевой сбой, пул опустел после idleTimeout),
  // getConnection отклонял промис, тик запускал работу через `void`, и ловить
  // отказ было некому — Node 22 завершает процесс на необработанном отказе.
  // Кратковременный сбой базы превращался в падение всего приложения, а после
  // десяти перезапусков Railway — в простой до ручного вмешательства.
  let conn: Awaited<ReturnType<typeof pool.getConnection>>;
  try {
    conn = await pool.getConnection();
  } catch (e) {
    logger.error("cron job skipped: database unavailable", {
      job: job.name, error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, 0) AS ok", [`warehouse_pro:cron:${job.name}`]);
    const ok = Number((rows as Array<{ ok: number | null }>)[0]?.ok ?? 0) === 1;
    if (!ok) return;

    try {
      const started = Date.now();
      const result = await job.run();
      logger.info("cron job finished", { job: job.name, ms: Date.now() - started, result });
      const at = new Date();
      lastSuccess.set(job.name, at.getTime());
      cronLastSuccessTimestamp.set({ job: job.name }, Math.floor(at.getTime() / 1000));
      await store.saveSuccess(job.name, at).catch(e => logger.warn("cron run not recorded", {
        job: job.name, error: e instanceof Error ? e.message : String(e),
      }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error("cron job failed", { job: job.name, error });
      await store.saveFailure(job.name, new Date(), error).catch(() => {});
      // Суперадмину: тихий провал ночной работы иначе замечают через месяцы
      // (см. шапку файла — так и вышло с копией базы). Но один раз на
      // назначенный момент (частой работе — раз в час): догон пробует снова
      // каждый час, и то же сообщение час за часом — шум, за которым потеряется
      // настоящее.
      const slot = due?.getTime() ?? Math.floor(Date.now() / 3_600_000);
      if (notified.get(job.name) !== slot) {
        notified.set(job.name, slot);
        const { notifyAdmin, tgMessages } = await import("../lib/telegram");
        void notifyAdmin(tgMessages.cronFailed(job.name, error, due !== undefined));
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?) AS ok", [`warehouse_pro:cron:${job.name}`]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Запустить расписание.
 *
 * Тик раз в минуту: работы назначены с точностью до минуты, и опрашивать чаще
 * незачем. Отметка последнего запуска не даёт выполнить одно и то же дважды,
 * если тик придёт в ту же минуту повторно.
 */
export function startScheduler(): void {
  if (timer) return;

  void loadState();
  timer = setInterval(() => { void tick(); }, 60_000);

  // Таймер не должен держать процесс живым при остановке.
  timer.unref?.();
  logger.info("cron scheduler started", { jobs: JOBS.map(j => j.name) });
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Список работ — для страницы мониторинга и проверок. */
export function scheduledJobs(): Array<{ name: string; when: string }> {
  return JOBS.map(j => ({
    name: j.name,
    when: j.everyMinutes ? `каждые ${j.everyMinutes} мин` : `${String(j.daily!.hour).padStart(2, "0")}:${String(j.daily!.minute).padStart(2, "0")} по Ташкенту`,
  }));
}

/** Оставлено ради проверки: тот же расчёт, что и в тике. */
export const _internals = {
  isDue, stamp, JOBS, runExclusively, tick, lastDue, dueSlot, store,
  /** Забыть всё между проверками: отметки, попытки, флаг загрузки. */
  reset(): void {
    lastRun.clear(); lastSuccess.clear(); lastAttempt.clear(); notified.clear();
    stateLoaded = false; ticking = false;
  },
};

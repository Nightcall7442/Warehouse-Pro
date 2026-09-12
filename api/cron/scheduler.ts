import { getPool } from "../queries/connection";
import { logger } from "../lib/logger";

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
    run: async () => (await import("./telegram-digest")).runTelegramDigest(),
  },
  {
    // Долги — утром рабочего дня: по ним звонят, а не читают на ночь.
    name: "debt-reminders",
    daily: { hour: 9, minute: 0 },
    run: async () => (await import("./debt-reminders")).runDebtReminders(),
  },
  {
    name: "trial-reminders",
    daily: { hour: 9, minute: 30 },
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
async function runExclusively(job: Job): Promise<void> {
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
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error("cron job failed", { job: job.name, error });
      // Суперадмину: тихий провал ночной работы иначе замечают через месяцы
      // (см. шапку файла — так и вышло с копией базы).
      const { notifyAdmin, tgMessages } = await import("../lib/telegram");
      void notifyAdmin(tgMessages.cronFailed(job.name, error));
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

  timer = setInterval(() => {
    const now = new Date();
    const key = stamp(now);
    for (const job of JOBS) {
      if (!isDue(job, now)) continue;
      if (lastRun.get(job.name) === key) continue;
      lastRun.set(job.name, key);
      void runExclusively(job);
    }
  }, 60_000);

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
export const _internals = { isDue, stamp, JOBS, runExclusively };

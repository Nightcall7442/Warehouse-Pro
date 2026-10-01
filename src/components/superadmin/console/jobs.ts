import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";

/* Фоновые задачи (api/cron/scheduler.ts) — словами для раздела «Система». */

export type JobRow = inferRouterOutputs<AppRouter>["system"]["jobs"]["jobs"][number];

export const JOB_LABEL: Record<string, string> = {
  "telegram-outbox":         "Очередь Telegram",
  "telegram-digest":         "Вечерняя сводка в Telegram",
  "telegram-morning":        "Утренняя сводка в Telegram",
  "money-evening":           "Вечерний отчёт по деньгам",
  "debt-reminders":          "Напоминания о долгах",
  "trial-reminders":         "Напоминания о конце пробного",
  "backup":                  "Резервная копия базы",
  "admin-digest":            "Сводка владельцу платформы",
  "support-cleanup":         "Уборка старых обращений",
  "notifications-cleanup":   "Уборка уведомлений",
  "api-export-log-cleanup":  "Уборка журнала выгрузок API",
  "low-stock-alerts":        "Тревоги о низком остатке",
  "photos-to-s3":            "Перенос фото в хранилище",
  "photos-mirror":           "Копирование чужих фото к себе",
  "agent-locations-cleanup": "Уборка GPS-точек",
  "restore-drill":           "Учебное восстановление копии",
  "onec-sync":               "Обмен с 1С",
};

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const hm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function jobSchedule(j: Pick<JobRow, "everyMinutes" | "daily" | "inSchedule">): string {
  if (!j.inSchedule) return "нет в расписании";
  if (j.everyMinutes) return `каждые ${j.everyMinutes} мин`;
  if (j.daily) return j.daily.weekday !== null
    ? `${WEEKDAY[j.daily.weekday]} ${hm(j.daily.hour, j.daily.minute)}`
    : `ежедневно ${hm(j.daily.hour, j.daily.minute)}`;
  return "—";
}

export const OUTCOME: Record<JobRow["outcome"], { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  ok:      { label: "Удачно",      tone: "success" },
  failed:  { label: "Ошибка",      tone: "danger" },
  overdue: { label: "Просрочена",  tone: "warning" },
  never:   { label: "Не запускалась", tone: "neutral" },
};

export function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} мс`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

/** Копия базы старше 26 часов — тревога: ночная работа пропустила сутки (тот же порог, что у Prometheus). */
export const BACKUP_STALE_HOURS = 26;
export function backupState(jobs: JobRow[] | undefined, now = new Date()): { at: Date | null; stale: boolean } {
  const b = jobs?.find(j => j.name === "backup");
  const at = b?.lastSuccessAt ? new Date(b.lastSuccessAt) : null;
  return { at, stale: !at || now.getTime() - at.getTime() > BACKUP_STALE_HOURS * 3_600_000 };
}

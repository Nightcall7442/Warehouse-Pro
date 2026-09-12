import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { getDb } from "../queries/connection";
import { checkRateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { checkTotpStepUp } from "../auth/step-up";
import { isAppError } from "@contracts/errors";
import { cronDenied } from "./cron-guard";

/*
  Резервные копии: ежедневный крон и скачивание дампа суперадмином.
  Вынесено из boot.ts; монтируется там же, где стояло — до общего
  bodyLimit и после вебхуков.
*/
const routes = new Hono();

// ── Cron: daily database backup ──────────────────────────────────────────────
routes.get("/api/cron/backup", async (c) => {
  const denied = cronDenied(c);
  if (denied) return c.json({ error: denied }, 401);
  const { runBackup } = await import("../cron/backup");
  const result = await runBackup();
  // Non-200 on failure so an external cron/uptime monitor watching this
  // endpoint's status code (not just its body) actually notices a bad backup.
  return c.json(result, result.success ? 200 : 500);
});

// ── Резервная копия по требованию: суперадмин скачивает SQL-дамп ────────────
//
// Снимки диска, которые делает платформа, — первая линия и остаются на месте.
// Но они защищают только от смерти диска. От ошибки человека — «удалили не тот
// заказ», «испортили цены импортом» — они предлагают откатить базу целиком на
// сутки назад, вместе со всем, что записано после. Вдобавок восстановление
// снимка на Railway удаляет все копии, сделанные позже восстанавливаемой,
// поэтому и проверить его нельзя, не израсходовав сам запас.
//
// Этот путь даёт то, чего там нет: копию вне платформы, из которой можно
// достать одну таблицу, и которую можно развернуть у себя и убедиться, что она
// разворачивается, ничего при этом не потратив.
//
// Отдаётся потоком, файл на сервере не появляется: писать копию всей базы на
// диск контейнера незачем — он не переживает следующий деплой, а до тех пор
// лежит лишней целью.
routes.get("/api/admin/backup/download", async (c) => {
  let auth;
  try {
    auth = await authenticateRequest(c.req.raw.headers);
  } catch (e) {
    if (!isAppError(e)) return c.json({ error: "Не удалось проверить сессию" }, 503);
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Выгрузка содержит данные всех организаций разом, поэтому доступна только
  // суперадмину — владелец одной организации не вправе получить чужие.
  if (auth.user.role !== "superadmin") {
    logger.warn("backup download refused: not a superadmin", { userId: auth.user.id, role: auth.user.role });
    return c.json({ error: "Forbidden" }, 403);
  }

  /*
    Второй фактор перед выгрузкой всей базы — обязателен.

    Сессия суперадмина живёт 30 дней, и украденной куки хватало, чтобы
    унести данные всех организаций одним запросом. Код из приложения
    подтверждает, что это сам человек, здесь и сейчас; без включённого
    второго фактора выгрузка закрыта вовсе — включается в профиле.
  */
  {
    const step = await checkTotpStepUp(getDb(), auth.user.id, c.req.header("x-totp-code"));
    if (!step.ok) {
      if (step.code === "TOTP_INVALID") logger.warn("backup download refused: bad TOTP", { userId: auth.user.id });
      return c.json({ error: step.message, code: step.code }, step.code === "TOTP_NOT_ENROLLED" ? 403 : 401);
    }
  }

  // Выгрузка стоит дорого и базе, и процессу. Ограничение считается по
  // пользователю, а не по адресу: адрес подделывается заголовком, а
  // идентификатор берётся из проверенной сессии.
  const allowed = await checkRateLimit(String(auth.user.id), { limit: 3, windowMs: 60 * 60_000, namespace: "backup-download" });
  if (!allowed) {
    return c.json({ error: "Слишком часто. Выгрузка доступна три раза в час." }, 429);
  }

  const { startDump, DumpUnavailableError } = await import("../services/db-dump");
  let dump;
  try {
    dump = await startDump();
  } catch (e) {
    // Ответ об ошибке возможен только здесь: startDump доводит до конца всё,
    // что может не получиться — соединение, снимок, перечень таблиц, — и лишь
    // потом отдаёт поток. После отправки заголовков сменить код ответа уже
    // нельзя, и сорвавшаяся выгрузка выглядела бы успешной загрузкой.
    const message = e instanceof DumpUnavailableError ? e.message : String(e);
    logger.error("backup download failed to start", { userId: auth.user.id, error: message });
    return c.json({ error: `Не удалось сделать выгрузку: ${message}` }, 500);
  }

  // Кто и когда унёс полную копию базы — это то, что обязано остаться в
  // журнале. Запись делается до отдачи потока: оборвись передача на середине,
  // данные всё равно уже покинули сервер.
  const { recordAudit } = await import("../services/audit-log");
  await recordAudit(getDb(), {
    tenantId: auth.tenant.id,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "system.backup_downloaded",
    targetType: "database",
    meta: { filename: dump.filename },
  });

  const { Readable } = await import("node:stream");
  return new Response(Readable.toWeb(dump.stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${dump.filename}"`,
      // Копия базы не должна осесть ни в одном промежуточном кеше.
      "Cache-Control": "no-store",
    },
  });
});

export default routes;

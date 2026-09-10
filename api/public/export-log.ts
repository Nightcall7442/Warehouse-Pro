import { and, desc, eq, gte, sql } from "drizzle-orm";
import { apiExportLog } from "@db/schema";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";

/* ═══════════════════════════════════════════════════════════════════════════
   Журнал выгрузок наружу.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Приёмка (17-H) требует суточного испытания, где записаны последняя успешная
   выгрузка и ошибки. И это же — единственный способ разобрать спор «мы не
   получили заказы за вторник»: без журнала у нас нет ни следа того, что мы
   отдали, ни того, чем ответили, и разговор сводится к тому, кто увереннее.

   Записывается НАША половина правды: что отдали и чем ответили. Сошлась ли
   сверка у получателя и не задвоил ли он строки — знает только он; выдавать
   его выводы за свои нельзя, и поэтому их здесь нет.

   ── Почему запись не может уронить выгрузку ─────────────────────────────────

   Журнал — это подстраховка, а не работа. Упади вставка (кончилось место,
   отвалилась база) — выгрузка обязана всё равно отдать заказы: иначе
   средство разбора аварий само становится причиной аварии. Поэтому вся
   запись обёрнута в try/catch и ошибка уходит в общий журнал сервера.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ExportLogEntry {
  tenantId: number;
  apiKeyId: number | null;
  endpoint: string;
  mode: "snapshot" | "changes";
  cursorIn?: string | null;
  cursorOut?: string | null;
  httpStatus: number;
  rows?: number;
  totalCount?: number | null;
  amountTotal?: string | null;
  durationMs: number;
  error?: string | null;
}

/** Курсоры длинные; в поле их 512 знаков, и обрезка не должна ронять вставку. */
const cut = (v: string | null | undefined, max: number) =>
  v == null ? null : v.length > max ? v.slice(0, max) : v;

export async function recordExport(entry: ExportLogEntry): Promise<void> {
  try {
    await getDb().insert(apiExportLog).values({
      tenantId: entry.tenantId,
      apiKeyId: entry.apiKeyId ?? undefined,
      endpoint: cut(entry.endpoint, 64)!,
      mode: entry.mode,
      cursorIn: cut(entry.cursorIn, 512),
      cursorOut: cut(entry.cursorOut, 512),
      httpStatus: entry.httpStatus,
      rows: entry.rows ?? 0,
      totalCount: entry.totalCount ?? null,
      amountTotal: entry.amountTotal ?? null,
      durationMs: entry.durationMs,
      error: cut(entry.error, 300),
    });
  } catch (e) {
    logger.error("api export log write failed", {
      error: e instanceof Error ? e.message : String(e),
      tenantId: entry.tenantId,
    });
  }
}

/**
 * Состояние выгрузки за сутки — то, что показывают человеку.
 *
 * Именно за сутки, потому что таков срок испытания в ТЗ (17-H) и потому что
 * на вопрос «работает ли обмен» отвечают сегодняшние числа, а не месячные.
 */
export interface ExportHealth {
  /** Последняя УСПЕШНАЯ выгрузка — та, что вернула 2xx. */
  lastSuccessAt: Date | null;
  /** Точка возобновления последней успешной: с неё продолжат после обрыва. */
  lastCursor: string | null;
  /** Последняя ошибка за сутки — код и текст. */
  lastError: { at: Date; status: number; message: string | null } | null;
  requests24h: number;
  errors24h: number;
  rows24h: number;
}

export async function exportHealth(tenantId: number): Promise<ExportHealth> {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const [lastOk] = await db.select({
    createdAt: apiExportLog.createdAt,
    cursorOut: apiExportLog.cursorOut,
  }).from(apiExportLog)
    .where(and(eq(apiExportLog.tenantId, tenantId), sql`${apiExportLog.httpStatus} < 300`))
    .orderBy(desc(apiExportLog.id)).limit(1);

  const [lastBad] = await db.select({
    createdAt: apiExportLog.createdAt,
    httpStatus: apiExportLog.httpStatus,
    error: apiExportLog.error,
  }).from(apiExportLog)
    .where(and(
      eq(apiExportLog.tenantId, tenantId),
      sql`${apiExportLog.httpStatus} >= 300`,
      gte(apiExportLog.createdAt, since),
    ))
    .orderBy(desc(apiExportLog.id)).limit(1);

  const [totals] = await db.select({
    requests: sql<number>`COUNT(*)`,
    errors: sql<number>`SUM(CASE WHEN ${apiExportLog.httpStatus} >= 300 THEN 1 ELSE 0 END)`,
    rows: sql<number>`COALESCE(SUM(${apiExportLog.rows}), 0)`,
  }).from(apiExportLog)
    .where(and(eq(apiExportLog.tenantId, tenantId), gte(apiExportLog.createdAt, since)));

  return {
    lastSuccessAt: lastOk?.createdAt ?? null,
    lastCursor: lastOk?.cursorOut ?? null,
    lastError: lastBad
      ? { at: lastBad.createdAt, status: lastBad.httpStatus, message: lastBad.error }
      : null,
    requests24h: Number(totals?.requests ?? 0),
    errors24h: Number(totals?.errors ?? 0),
    rows24h: Number(totals?.rows ?? 0),
  };
}

/** Последние обращения — список для разбора: что просили и чем ответили. */
export async function recentExports(tenantId: number, limit = 50) {
  return getDb().select({
    id: apiExportLog.id,
    createdAt: apiExportLog.createdAt,
    endpoint: apiExportLog.endpoint,
    mode: apiExportLog.mode,
    httpStatus: apiExportLog.httpStatus,
    rows: apiExportLog.rows,
    totalCount: apiExportLog.totalCount,
    amountTotal: apiExportLog.amountTotal,
    durationMs: apiExportLog.durationMs,
    error: apiExportLog.error,
  }).from(apiExportLog)
    .where(eq(apiExportLog.tenantId, tenantId))
    .orderBy(desc(apiExportLog.id))
    .limit(Math.min(limit, 200));
}

/**
 * Уборка: журнал обращений живёт тридцать дней.
 *
 * Суточное испытание укладывается с запасом, а расти без конца журналу
 * обращений нельзя: при потолке в шестьдесят запросов в минуту на ключ это
 * восемьдесят шесть тысяч строк в сутки в худшем случае.
 */
export async function purgeOldExports(days = 30): Promise<{ deleted: number }> {
  const before = new Date(Date.now() - days * 86_400_000);
  const r = await getDb().delete(apiExportLog)
    .where(sql`${apiExportLog.createdAt} < ${before}`);
  const deleted = Number((r as unknown as { affectedRows?: number }).affectedRows ?? 0);
  return { deleted };
}

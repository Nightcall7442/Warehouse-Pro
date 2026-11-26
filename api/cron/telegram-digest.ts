import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { plansWithProTools } from "../../contracts/constants";
import { tenants, users } from "@db/schema";
import { sendTelegram } from "../lib/telegram";
import { answerSummary, currencyOf, type Reply } from "../telegram/answers";
import { logger } from "../lib/logger";
import { hasSubscriptionAccess } from "../lib/feature-gating";
import type { Lang } from "../telegram/texts";

/**
 * Вечерняя сводка в Telegram.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Итоги дня смотрят те, кто и так открывает приложение. Директор, у которого
 * день прошёл в разъездах, узнаёт про выручку завтра утром — если вспомнит
 * зайти. Одно сообщение в конце дня закрывает этот разрыв, и его не надо
 * просить.
 *
 * ── Кому ────────────────────────────────────────────────────────────────────
 *
 * Тем, кому бот вообще отвечает: тариф Pro и выше, роль руководителя,
 * привязанный Telegram. Сводка — это те же цифры, что бот отдаёт по команде
 * «Сводка», и раздавать их шире, чем ответы бота, было бы непоследовательно.
 *
 * ── Про время ───────────────────────────────────────────────────────────────
 *
 * Час выбирает расписание снаружи, а не эта функция: она отправляет то, что
 * есть на момент вызова. Так её можно позвать руками и проверить, не дожидаясь
 * вечера.
 */
const ROLES = ["ceo", "operator", "supervisor"] as const;

export async function runTelegramDigest(): Promise<{ sent: number; tenants: number }> {
  const db = getDb();

  const rows = await db
    .select({
      tenantId: users.tenantId,
      chatId: users.telegramChatId,
      lang: users.telegramLang,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(
      eq(users.status, "active"),
      isNotNull(users.telegramChatId),
      inArray(users.role, [...ROLES]),
      eq(tenants.status, "active"),
      inArray(tenants.plan, plansWithProTools(new Date())),
    ));

  if (rows.length === 0) return { sent: 0, tenants: 0 };

  /*
    Сводка считается один раз на организацию, а не на человека: в конторе с
    пятью руководителями это пять одинаковых наборов запросов к базе за один
    вечер, и разница видна на счётчике соединений.
  */
  const ready = new Map<string, Reply>();
  const currencies = new Map<number, string>();
  let sent = 0;

  /*
    Сводка — тем, у кого доступ открыт (подписка не кончилась), и по
    получателю под своим try: ошибка расчёта у одной организации оставляла
    без сводки всех следующих (бизнес-аудит 19.11.2026, пп. 14 и 26).
  */
  const open = new Map<number, boolean>();
  for (const row of rows) {
    const lang: Lang = row.lang === "uz" ? "uz" : "ru";
    const key = `${row.tenantId}:${lang}`;
    try {
      if (!open.has(row.tenantId)) open.set(row.tenantId, await hasSubscriptionAccess(row.tenantId));
      if (!open.get(row.tenantId)) continue;
      let reply = ready.get(key);
      if (!reply) {
        let currency = currencies.get(row.tenantId);
        if (!currency) { currency = await currencyOf(row.tenantId); currencies.set(row.tenantId, currency); }
        reply = await answerSummary({ tenantId: row.tenantId, lang, currency }, "today");
        ready.set(key, reply);
      }
      if (await sendTelegram(row.chatId!, reply.text, reply.extra)) sent++;
    } catch (e) {
      logger.warn("telegram digest: получатель пропущен", { tenantId: row.tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  logger.info("telegram digest sent", { sent, recipients: rows.length });
  return { sent, tenants: new Set(rows.map(r => r.tenantId)).size };
}

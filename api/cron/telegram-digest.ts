import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants, users } from "@db/schema";
import { sendTelegram } from "../telegram-router";
import { answerSummary } from "../telegram/answers";
import { logger } from "../lib/logger";
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
const PLANS_WITH_BOT = ["pro", "exclusive"] as const;
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
      inArray(tenants.plan, [...PLANS_WITH_BOT]),
    ));

  if (rows.length === 0) return { sent: 0, tenants: 0 };

  /*
    Сводка считается один раз на организацию, а не на человека: в конторе с
    пятью руководителями это пять одинаковых наборов запросов к базе за один
    вечер, и разница видна на счётчике соединений.
  */
  const ready = new Map<string, string>();
  let sent = 0;

  for (const row of rows) {
    const lang: Lang = row.lang === "uz" ? "uz" : "ru";
    const key = `${row.tenantId}:${lang}`;

    let text = ready.get(key);
    if (!text) {
      text = await answerSummary(row.tenantId, lang);
      ready.set(key, text);
    }
    if (await sendTelegram(row.chatId!, text)) sent++;
  }

  logger.info("telegram digest sent", { sent, recipients: rows.length });
  return { sent, tenants: new Set(rows.map(r => r.tenantId)).size };
}

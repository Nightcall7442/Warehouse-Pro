import { eq } from "drizzle-orm";
import { leads } from "@db/schema";
import { sendTelegram } from "../telegram-router";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Приём заявки: сначала запись, потом уведомление.

   ── Почему именно в таком порядке ───────────────────────────────────────────

   Форма, которая только шлёт сообщение в телеграм, теряет обращения МОЛЧА:
   бота отключили, токен просрочили, чат переименовали — человек видит
   «спасибо», а к владельцу ничего не приходит, и узнать об этом неоткуда.

   Здесь наоборот: заявка ложится в базу, и только потом уходит уведомление.
   Не ушло — заявка всё равно лежит с `notified = false`, и её видно в разборе
   заявок у суперадмина.

   ── Почему это отдельная функция ────────────────────────────────────────────

   Заявок стало две: с лендинга («перезвоните») и из подписки («докупите нам
   места сверх тарифа»). Порядок «запись → уведомление → отметка» в них один и
   тот же, и вторая копия однажды разъехалась бы с первой — обычно в сторону
   «уведомили, но не записали», то есть ровно в ту беду, ради которой всё это
   и устроено.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface LeadInput {
  name: string;
  company?: string | null;
  phone: string;
  comment?: string | null;
  /** Откуда пришла: «сайт», «подписка: сверх тарифа». Свободная строка. */
  source?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Записать заявку и попытаться уведомить владельца платформы.
 *
 * Возвращает номер заявки и ушло ли уведомление. Отказ уведомления НЕ является
 * ошибкой приёма: заявка уже сохранена, и врать человеку «не получилось» из-за
 * молчащего бота нельзя.
 */
export async function recordLead(
  db: Db,
  input: LeadInput,
  title = "Новая заявка с сайта",
): Promise<{ id: number; notified: boolean }> {
  const [inserted] = await db.insert(leads).values({
    name:    input.name,
    company: input.company || null,
    phone:   input.phone,
    comment: input.comment || null,
    source:  input.source || null,
  });
  const id = Number(inserted.insertId);

  let notified = false;
  if (env.telegramAdminChatId) {
    const lines = [
      `<b>${escapeHtml(title)}</b>`,
      `Имя: ${escapeHtml(input.name)}`,
      input.company ? `Компания: ${escapeHtml(input.company)}` : null,
      `Телефон: ${escapeHtml(input.phone)}`,
      input.comment ? `Комментарий: ${escapeHtml(input.comment)}` : null,
      input.source ? `Откуда: ${escapeHtml(input.source)}` : null,
    ].filter(Boolean);
    notified = await sendTelegram(env.telegramAdminChatId, lines.join("\n"));
  }

  if (notified) {
    await db.update(leads).set({ notified: true }).where(eq(leads.id, id));
  } else {
    // Громко в журнал: заявка есть, но её никто не увидел.
    logger.warn("заявка сохранена, уведомление не ушло", {
      leadId: id,
      telegramConfigured: !!env.telegramAdminChatId,
    });
  }

  return { id, notified };
}

import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { env } from "./env";
import type { Role } from "@contracts/types";

/*
  Транспорт Telegram: отправка, экранирование, адресаты, шаблоны сообщений.
  Раньше жил в telegram-router.ts, и службы (order, stock, leads, cron)
  тянули tRPC-роутер ради одной функции отправки. Роутер остался в
  telegram-router.ts и берёт транспорт отсюда; правило «службы не
  импортируют роутеры» держит страж.
*/

/** Сколько ждать ответ api.telegram.org. Вызов стоит на пути заказа. */
export const TELEGRAM_TIMEOUT_MS = 5_000;

/**
 * Escape a value that is about to be dropped into a Telegram message.
 *
 * Messages here are sent with parse_mode "HTML" so the templates can use <b>.
 * That makes every interpolated value markup too, and Telegram's parser is not
 * forgiving: a shop called «Восток <Азия>» makes it reject the whole message
 * with 400, an order named with & does the same. sendTelegram then returned
 * false and nobody heard about it — the notification simply never arrived, and
 * the failure looked exactly like Telegram not being configured.
 *
 * The lenient-looking cases are worse than the loud ones. A shop named
 * «<b>СРОЧНО</b>» renders as bold in the director's chat, and the org name from
 * the public signup form reaches the platform owner's chat — where an <a href>
 * becomes a real, clickable link sent by a bot the owner trusts.
 *
 * Escape at the template, not inside sendTelegram: by the time text reaches
 * sendTelegram it legitimately contains the <b> tags the templates put there.
 */
export function tgEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Core send function ───────────────────────────────────────────────────────
// Exported for the AI bot cron, which replies to whichever chat messaged it and
// so can't go through the notify* helpers below.
export async function sendTelegram(
  chatId: string,
  text: string,
  /*
    Клавиатура и прочие поля Telegram. Отдельным необязательным доводом, а не
    новой функцией: отправка одна на всё приложение, и вторая копия рано или
    поздно разошлась бы с этой в обработке ошибок и экранировании.
  */
  extra?: Record<string, unknown>,
): Promise<boolean> {
  const token = env.telegramBotToken;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra }),
      // Предел обязателен: этот вызов ждёт оформление заказа после commit.
      // Без него замедлившийся Telegram растягивал подтверждение заказа
      // агенту до минут — заказ при этом уже записан, но выглядит зависшим.
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Say why. A rejected message is indistinguishable from a disabled
      // integration when the only signal is `false`, which is how unescaped
      // markup managed to drop notifications quietly for so long.
      const detail = await res.text().catch(() => "");
      console.error(`[telegram] sendMessage ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("[telegram] sendMessage failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ── Notification helpers (used from other routers) ───────────────────────────
export async function notifyAdmin(message: string) {
  return sendTelegram(env.telegramAdminChatId, message);
}

export async function notifyUserById(userId: number, message: string) {
  const db = getDb();
  const [user] = await db.select({ chatId: users.telegramChatId })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (user?.chatId) return sendTelegram(user.chatId, message);
  return false;
}

export async function notifyTenantRole(
  tenantId: number, role: Role, message: string
) {
  const db     = getDb();
  const targets = await db.select({ id: users.id, chatId: users.telegramChatId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, role)));
  const withChat = targets.filter(u => u.chatId);
  await Promise.all(withChat.map(u => sendTelegram(u.chatId!, message)));
}

// ── Message templates ────────────────────────────────────────────────────────
// Every interpolation below goes through tgEscape: all of these values —
// shop names, product names, org names from the public signup form, contact
// strings, user names — are typed by people, and any of them containing
// <, > or & would otherwise make Telegram reject the whole notification.
export const tgMessages = {
  newOrder: (n: string, shop: string, total: string, cur: string) =>
    `🛒 <b>Новый заказ</b>\n📋 ${tgEscape(n)}\n🏪 ${tgEscape(shop)}\n💰 ${tgEscape(total)} ${tgEscape(cur)}`,

  lowStock: (name: string, qty: string) =>
    `⚠️ <b>Мало на складе</b>\n📦 ${tgEscape(name)}\n📉 Остаток: ${tgEscape(qty)} кг`,

  supportMessage: (org: string, who: string, preview: string) =>
    `💬 <b>Вопрос в поддержку</b>\n🏢 ${tgEscape(org)}\n👤 ${tgEscape(who)}\n\n${tgEscape(preview)}`,

  newRegistration: (org: string, email: string) =>
    `🆕 <b>Новая регистрация</b>\n🏢 ${tgEscape(org)}\n📧 ${tgEscape(email)}`,

  upgradeRequest: (org: string, plan: string, price: string, contact: string) =>
    `💳 <b>Запрос на апгрейд</b>\n🏢 ${tgEscape(org)}\n📈 Тариф: ${tgEscape(plan)}\n💰 ${tgEscape(price)} сум/мес\n📞 ${tgEscape(contact)}`,

  /*
    ── Суперадмину ──────────────────────────────────────────────────────────

    Всё ниже уходит в TELEGRAM_ADMIN_CHAT_ID через notifyAdmin. Числа тоже
    экранируются: правило «экранируется всё, что подставлено» переживает
    правки, правило «всё, кроме чисел» кто-нибудь однажды нарушит.

    Каждый шаблон здесь обязан иметь вызов — это держит тест
    admin-telegram.test.ts. Три шаблона до него лежали годами без единого
    вызова (paymentReceived, agentPlan, orderStatusChange) и сняты.
  */
  paid: (org: string, plan: string) =>
    `💰 <b>Оплата тарифа</b>\n🏢 ${tgEscape(org)}\n📈 ${tgEscape(plan)}`,

  paymentFailed: (org: string) =>
    `⛔ <b>Платёж не прошёл</b>\n🏢 ${tgEscape(org)}\nПодписка переведена в past_due, владельцу ушло письмо`,

  subscriptionCanceled: (org: string) =>
    `🚫 <b>Подписка отменена</b>\n🏢 ${tgEscape(org)}`,

  trials: (ending: Array<{ org: string; days: number }>, expired: string[]) => {
    const lines = ["⏳ <b>Пробные периоды</b>"];
    if (ending.length) {
      lines.push("", "Заканчиваются:");
      for (const t of ending) lines.push(`• ${tgEscape(t.org)} — ${tgEscape(t.days)} дн.`);
    }
    if (expired.length) {
      lines.push("", "Закончились за сутки:");
      for (const org of expired) lines.push(`• ${tgEscape(org)}`);
    }
    return lines.join("\n");
  },

  cronFailed: (job: string, error: string) =>
    `🟠 <b>Крон упал</b>\n⚙️ ${tgEscape(job)}\n${tgEscape(error.slice(0, 300))}`,

  serverUp: (version: string, caughtUp: string[]) =>
    `🚀 <b>Сервер запущен</b>\n🏷 ${tgEscape(version.slice(0, 12))}` +
    (caughtUp.length ? `\n🛠 Догнаны миграции: ${caughtUp.map(tgEscape).join(", ")}` : ""),

  usersLimitHit: (org: string, limit: number) =>
    `📈 <b>Упёрлись в лимит пользователей</b>\n🏢 ${tgEscape(org)}\n👥 Лимит ${tgEscape(limit)} — повод предложить тариф выше или сверхлимит`,

  adminDigest: (d: {
    registrations: number; orders: number; revenue: number;
    unanswered: number; trialsEnding: number; pastDue: number; activeTenants: number;
  }) =>
    `📊 <b>Сводка за сутки</b>\n` +
    `🆕 Регистраций: ${tgEscape(d.registrations)}\n` +
    `🛒 Заказов: ${tgEscape(d.orders)} на ${tgEscape(Math.round(d.revenue).toLocaleString("ru-RU"))} сум\n` +
    `💬 Ждут ответа поддержки: ${tgEscape(d.unanswered)}\n` +
    `⏳ Пробных заканчивается (3 дня): ${tgEscape(d.trialsEnding)}\n` +
    `⛔ Просрочили оплату: ${tgEscape(d.pastDue)}\n` +
    `🏢 Активных организаций: ${tgEscape(d.activeTenants)}`,
};

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

/**
 * Один вызов Bot API на всё приложение: sendMessage, answerCallbackQuery,
 * editMessageText. Ошибки — словами в журнал: отклонённое сообщение иначе
 * неотличимо от выключенной интеграции, и так уведомления терялись молча.
 */
export async function tgCall(method: string, body: Record<string, unknown>): Promise<boolean> {
  const token = env.telegramBotToken;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Предел обязателен: этот вызов ждёт оформление заказа после commit.
      // Без него замедлившийся Telegram растягивал подтверждение заказа
      // агенту до минут — заказ при этом уже записан, но выглядит зависшим.
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[telegram] ${method} ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[telegram] ${method} failed:`, e instanceof Error ? e.message : String(e));
    return false;
  }
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
  if (!chatId) return false;
  return tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

/** Погасить «часики» на нажатой кнопке; без этого Telegram крутит их полминуты. */
export async function answerCallback(callbackId: string, text?: string): Promise<boolean> {
  return tgCall("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/* ── Кнопки и ссылки ──────────────────────────────────────────────────────── */

/** Кнопки под сообщением: ряды из {text, data} (callback) или {text, url}. */
export function inlineKeyboard(rows: Array<Array<{ text: string; data?: string; url?: string }>>): Record<string, unknown> {
  return {
    reply_markup: {
      inline_keyboard: rows.map(row => row.map(b => b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "" })),
    },
  };
}

/** Адрес страницы приложения — для кнопки «Открыть». */
export function appLink(path: string): string {
  return `${env.appUrl.replace(/\/$/, "")}${path}`;
}

/* ── Числа на бумаге сообщения ────────────────────────────────────────────── */

/** «1 234 567 сум» — тысячи через пробел, без копеек, валюта словом. */
export function fmtMoney(n: unknown, currency = "сум"): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString("ru-RU")} ${currency}`;
}

/** «12» или «1,5» — без хвоста «.00». */
export function fmtQty(n: unknown): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

/** Как платит магазин — словом. */
export const PAY_LABEL: Record<string, string> = { cash: "наличные", card: "карта", transfer: "перечисление", debt: "в долг" };

/** Состояние заказа — значком и словом. */
export const ORDER_STATE: Record<string, { icon: string; ru: string; uz: string }> = {
  new:        { icon: "🆕", ru: "новый",        uz: "yangi" },
  pending:    { icon: "⏳", ru: "ожидает",      uz: "kutmoqda" },
  processing: { icon: "🔧", ru: "в работе",     uz: "jarayonda" },
  shipped:    { icon: "🚚", ru: "отгружен",     uz: "jo'natildi" },
  delivered:  { icon: "✅", ru: "доставлен",    uz: "yetkazildi" },
  cancelled:  { icon: "❌", ru: "отменён",      uz: "bekor" },
  returned:   { icon: "↩️", ru: "возврат",      uz: "qaytarildi" },
};

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
  /*
    ── Событие — карточка ─────────────────────────────────────────────────────

    Заголовок значком и жирным, дальше строки «что — сколько». Каждый шаблон
    говорит то, по чему человек примет решение: кто выписал, сколько позиций,
    как платят, а не только номер и сумму. Кнопка «Открыть» ведёт на страницу
    заказа — из чата в приложение одним нажатием.
  */
  newOrder: (o: { number: string; shop: string; total: string; agent?: string | null; items?: number; payment?: string | null; discountPct?: number }) =>
    `🛒 <b>Новый заказ ${tgEscape(o.number)}</b>\n` +
    `🏪 ${tgEscape(o.shop)}\n` +
    `💰 ${tgEscape(o.total)}${o.payment ? ` · ${tgEscape(PAY_LABEL[o.payment] ?? o.payment)}` : ""}` +
    (o.discountPct ? ` · скидка ${tgEscape(o.discountPct)}%` : "") + "\n" +
    (o.items ? `📦 Позиций: ${tgEscape(o.items)}\n` : "") +
    (o.agent ? `👤 ${tgEscape(o.agent)}` : ""),

  /** Заказ ждёт офиса: скидка выше порога или другая причина — его надо подтвердить. */
  orderPending: (o: { number: string; shop: string; total: string; agent?: string | null; reason?: string | null }) =>
    `⏳ <b>Заказ ${tgEscape(o.number)} ждёт подтверждения</b>\n` +
    `🏪 ${tgEscape(o.shop)}\n💰 ${tgEscape(o.total)}\n` +
    (o.agent ? `👤 ${tgEscape(o.agent)}\n` : "") +
    (o.reason ? `❗ ${tgEscape(o.reason)}\n` : "") +
    `\nПодтвердить или отклонить: Заказы → «Ожидает»`,

  /** Курьер отдал товар: агенту магазина — как закрылся его заказ. */
  orderDelivered: (o: { number: string; shop: string; total: string; result: string; paid?: string | null; debt?: string | null; courier?: string | null }) =>
    `✅ <b>Заказ ${tgEscape(o.number)} доставлен</b>\n` +
    `🏪 ${tgEscape(o.shop)}\n💰 ${tgEscape(o.total)} — ${tgEscape(o.result)}\n` +
    (o.paid ? `💵 Получено: ${tgEscape(o.paid)}\n` : "") +
    (o.debt ? `🧾 В долг: ${tgEscape(o.debt)}\n` : "") +
    (o.courier ? `🚚 ${tgEscape(o.courier)}` : ""),

  /** Доставка сорвалась: оператору и агенту — разобраться сегодня. */
  deliveryFailed: (o: { number: string; shop: string; total: string; reason?: string | null; courier?: string | null }) =>
    `❌ <b>Заказ ${tgEscape(o.number)} не доставлен</b>\n` +
    `🏪 ${tgEscape(o.shop)}\n💰 ${tgEscape(o.total)}\n` +
    (o.reason ? `❗ ${tgEscape(o.reason)}\n` : "") +
    (o.courier ? `🚚 ${tgEscape(o.courier)}` : ""),

  /** Сборка листа закрылась с недостачей: что не доложили. */
  pickingShort: (listNumber: string, lines: Array<{ name: string; required: number; picked: number; unit: string }>) =>
    `📋 <b>Лист ${tgEscape(listNumber)}: недостача при сборке</b>\n` +
    lines.slice(0, 10).map(l => `• ${tgEscape(l.name)} — ${tgEscape(fmtQty(l.picked))} из ${tgEscape(fmtQty(l.required))} ${tgEscape(l.unit)}`).join("\n") +
    (lines.length > 10 ? `\n… и ещё ${tgEscape(lines.length - 10)}` : "") +
    `\n\nКурьер повезёт столько, сколько собрано; магазину скажите заранее.`,

  /** Одним сообщением на организацию — списком, а не по товару; единица — своя у каждого. */
  lowStockList: (items: Array<{ name: string; qty: string; unit: string; point: string }>, more = 0) =>
    `📉 <b>Заканчивается на складе</b>\n` +
    items.map(i => `• ${tgEscape(i.name)} — <b>${tgEscape(i.qty)}</b> ${tgEscape(i.unit)} (порог ${tgEscape(i.point)})`).join("\n") +
    (more > 0 ? `\n… и ещё ${tgEscape(more)}` : "") +
    `\n\nДозаказ: Склад → «Дозаказ»`,

  supportMessage: (org: string, who: string, preview: string) =>
    `💬 <b>Вопрос в поддержку</b>\n🏢 ${tgEscape(org)}\n👤 ${tgEscape(who)}\n\n${tgEscape(preview)}`,

  newRegistration: (org: string, email: string) =>
    `🆕 <b>Новая регистрация</b>\n🏢 ${tgEscape(org)}\n📧 ${tgEscape(email)}`,

  tenantOffboarded: (org: string, slug: string, who: string, rows: number) =>
    `🗑 <b>Организация удалена</b>\n🏢 ${tgEscape(org)} (${tgEscape(slug)})\n👤 ${tgEscape(who)}\n📦 Стёрто строк: ${tgEscape(rows)}`,

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

  cronFailed: (job: string, error: string, willRetry = false) =>
    `🟠 <b>Крон упал</b>\n⚙️ ${tgEscape(job)}\n${tgEscape(error.slice(0, 300))}` +
    (willRetry ? "\n🔁 Попробую снова через час; о повторных провалах молчу, об удаче — тоже" : ""),

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

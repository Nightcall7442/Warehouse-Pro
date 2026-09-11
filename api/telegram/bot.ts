import { Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants, telegramGroups, users } from "@db/schema";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { safeEqual } from "../lib/safe-compare";
import { checkRateLimit } from "../lib/rate-limit";
import { sendTelegram, tgEscape } from "../telegram-router";
import { readLinkToken, readGroupToken } from "./link-token";
import { T, MENU, detectIntent, type Lang } from "./texts";
import { answerStock, answerOrders, answerSummary, answerTop, answerDebts, answerSearch, answerStaff, answerPlans } from "./answers";

/* ═══════════════════════════════════════════════════════════════════════════
   Телеграм-бот: приём сообщений.

   ── Что было ────────────────────────────────────────────────────────────────

   Этот вебхук существовал в api/cron/telegram-ai-bot.ts и НЕ БЫЛ ПОДКЛЮЧЁН ни
   к одному приложению: в бою POST /api/webhooks/telegram отвечал 404. То есть
   бот не работал ни дня. Вместе с ним молча не работала кнопка «связать
   Telegram одним нажатием»: ссылка вида t.me/бот?start=… вела к боту, которому
   некому было ответить, и человек оставался без уведомлений, не понимая почему.

   ── Кого сюда пускают ───────────────────────────────────────────────────────

   Три ворот, и каждые о своём:

     · чат должен быть привязан к пользователю — иначе бот не знает, чьи данные
       показывать, и вежливо объясняет, как привязать;
     · тариф Pro и выше — ответы бота продаются, уведомления бесплатны;
     · роль руководителя — агент получает уведомления, но не спрашивает
       остатки чужих складов.

   Бот только читает. Телефон теряют и угоняют, а разговор с ботом не требует
   ни пароля, ни второго входа: пока бот рассказывает, потерянный телефон стоит
   утечки сводки; умей он подтверждать заказы — стоил бы поддельных отгрузок.
   ═══════════════════════════════════════════════════════════════════════════ */

export const telegramBot = new Hono();

/** Роли, которым бот отвечает на запросы. */
const CAN_ASK = new Set(["ceo", "operator", "supervisor"]);

/** Тарифы, на которых бот отвечает. */
const PLANS_WITH_BOT = new Set(["pro", "exclusive"]);

interface Linked {
  id: number;
  tenantId: number;
  name: string;
  role: string;
  lang: Lang | null;
  plan: string;
  brand: string;
}

const keyboard = (lang: Lang) => ({
  reply_markup: { keyboard: MENU[lang].map(row => row.map(text => ({ text }))), resize_keyboard: true },
});

const langButtons = {
  reply_markup: {
    inline_keyboard: [[
      { text: "Русский", callback_data: "lang:ru" },
      { text: "O'zbekcha", callback_data: "lang:uz" },
    ]],
  },
};

async function findByChat(chatId: string): Promise<Linked | null> {
  const [row] = await getDb()
    .select({
      id: users.id,
      tenantId: users.tenantId,
      name: users.name,
      role: users.role,
      lang: users.telegramLang,
      plan: tenants.plan,
      brand: tenants.name,
      status: users.status,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.telegramChatId, chatId))
    .limit(1);

  // Уволенный сотрудник — не «незнакомый чат», но и не собеседник: его
  // привязка остаётся в базе, а доступ к данным прекращается вместе с учёткой.
  if (!row || row.status !== "active") return null;
  return { ...row, lang: (row.lang as Lang | null) };
}

/**
 * Привязать чат к пользователю по подписанному токену.
 *
 * Один чат — один аккаунт. Если телефон уже привязан к другому человеку,
 * молча переписывать связь нельзя: так уведомления директора начали бы
 * приходить агенту, взявшему его телефон на минуту.
 */
async function link(chatId: string, token: string): Promise<string> {
  const parsed = readLinkToken(token);
  if (!parsed.ok) return parsed.reason === "expired" ? T.linkExpired.ru : T.linkInvalid.ru;

  const db = getDb();
  const [taken] = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.telegramChatId, chatId), ne(users.id, parsed.userId)))
    .limit(1);
  if (taken) return T.alreadyLinked.ru;

  await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, parsed.userId));
  return "";
}

/* ═══════════════════════════════════════════════════════════════════════════
   Группа сотрудников: связать и отвязать.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Подключиться к боту сотрудник может только сам, и это правильно: ссылка
   подписана его идентификатором, иначе пересланная ссылка стала бы способом
   читать чужие уведомления. Но чтобы события видела вся смена, каждого надо
   уговорить проделать это лично — у организации на двадцать человек так не
   выходит никогда.

   Директор делает одно действие: заводит чат, добавляет бота и вставляет туда
   код. Дальше рабочие события видят все, кто в чате.

   ── Чем доказывается право ──────────────────────────────────────────────────

   Кодом. Он подписан, живёт четверть часа и виден только директору в
   настройках. Проверять отправителя дополнительно нельзя: в группе команду
   может набрать любой, кому директор код передал, — а раз он его передал,
   значит доверил.

   Личность самого чата тоже проверяется: команда работает ТОЛЬКО в группе.
   В личной переписке связывать нечего — там уже есть личная привязка, и
   подмена одного другим сделала бы уведомления человека общими.
   ═══════════════════════════════════════════════════════════════════════════ */
async function linkGroup(
  chatId: string,
  chatType: string,
  chatTitle: string,
  token: string,
): Promise<string> {
  if (chatType !== "group" && chatType !== "supergroup") return T.groupOnlyInGroup.ru;

  const parsed = readGroupToken(token);
  if (!parsed.ok) return T.groupBadCode.ru;

  const db = getDb();
  const [existing] = await db.select({ id: telegramGroups.id, chatId: telegramGroups.chatId })
    .from(telegramGroups)
    .where(eq(telegramGroups.tenantId, parsed.tenantId))
    .limit(1);

  if (existing) {
    /*
      Одна группа на организацию: новая ЗАМЕНЯЕТ прежнюю, и об этом говорят
      прямо. Молча оставить обе значило бы разослать рабочие события в чат,
      про который все забыли.
    */
    await db.update(telegramGroups)
      .set({ chatId, title: chatTitle.slice(0, 200), linkedBy: parsed.userId })
      .where(eq(telegramGroups.id, existing.id));
    return existing.chatId === chatId ? T.groupLinked.ru : T.groupReplaced.ru;
  }

  await db.insert(telegramGroups).values({
    tenantId: parsed.tenantId,
    chatId,
    title: chatTitle.slice(0, 200),
    linkedBy: parsed.userId,
  });
  return T.groupLinked.ru;
}

/** Ответ на вопрос — уже после всех ворот. */
async function answer(user: Linked, lang: Lang, text: string): Promise<string> {
  switch (detectIntent(text)) {
    case "stock":   return answerStock(user.tenantId, lang);
    case "orders":  return answerOrders(user.tenantId, lang);
    case "summary": return answerSummary(user.tenantId, lang);
    case "top":     return answerTop(user.tenantId, lang);
    case "debts":   return answerDebts(user.tenantId, lang);
    case "staff":   return answerStaff(user.tenantId, lang);
    case "plans":   return answerPlans(user.tenantId, lang);
    case "help":    return `<b>${tgEscape(user.brand)}</b>\n\n${T.help[lang]}`;
    default:        return answerSearch(user.tenantId, lang, text);
  }
}

telegramBot.post("/api/webhooks/telegram", async (c) => {
  /*
    Секрет отдельный от токена бота.

    Раньше сравнивался сам TELEGRAM_BOT_TOKEN: он ездил бы в заголовке каждого
    входящего запроса, а токен — это право писать от имени бота кому угодно.
    Отдельная строка позволяет ещё и менять её, не перевыпуская бота.
  */
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!env.telegramWebhookSecret || !safeEqual(secret, env.telegramWebhookSecret)) {
    logger.warn("telegram webhook: secret mismatch");
    return c.json({ ok: false }, 401);
  }

  try {
    const update = await c.req.json() as {
      /* Тип и название чата нужны командам группы: связывать личную
         переписку нельзя, а название показывается директору. */
      message?: { text?: string; chat?: { id?: number | string; type?: string; title?: string } };
      callback_query?: { id: string; data?: string; message?: { chat?: { id?: number | string } } };
    };

    // ── Выбор языка кнопкой ────────────────────────────────────────────────
    const cb = update.callback_query;
    if (cb?.data?.startsWith("lang:")) {
      const chatId = String(cb.message?.chat?.id ?? "");
      const lang: Lang = cb.data.endsWith("uz") ? "uz" : "ru";
      if (chatId) {
        await getDb().update(users).set({ telegramLang: lang }).where(eq(users.telegramChatId, chatId));
        const user = await findByChat(chatId);
        await sendTelegram(chatId, `<b>${tgEscape(user?.brand ?? "Warehouse Pro")}</b>\n\n${T.help[lang]}`, keyboard(lang));
      }
      return c.json({ ok: true });
    }

    const message = update.message;
    const chatId = String(message?.chat?.id ?? "");
    /*
      Имя бота отрезается от команды.

      В группе клиент Telegram дописывает его сам: человек набирает «/link»,
      а приходит «/link@wpapp_bot». Без этой строки разбор кода давал
      «@wpapp_bot» вместо самого кода — то есть связать группу было НЕЛЬЗЯ,
      хотя в личной переписке та же команда работала.

      Режется один раз здесь, а не в каждом разборе: иначе следующая команда
      обязательно забудет это сделать.
    */
    const text = (message?.text ?? "").trim().replace(/^(\/[A-Za-z_]+)@[\w]+/, "$1");
    if (!chatId || !text) return c.json({ ok: true });

    /*
      Мера частоты до всякой работы с базой. Вебхук открыт всему интернету —
      секрет знает только Telegram, но за ним стоит кто угодно, кто напишет
      боту, и каждый ответ это несколько запросов к базе.
    */
    if (!(await checkRateLimit(`tg:${chatId}`, { windowMs: 60_000, limit: 20, namespace: "telegram-bot" }))) {
      return c.json({ ok: true });
    }

    /* ── Команды группового чата ────────────────────────────────────────────

       Стоят ДО поиска личной привязки: у группового чата её нет и быть не
       может, а без этой ветки бот ответил бы «свяжите Telegram в настройках»
       — то есть посоветовал бы группе сделать то, что делает человек.
    */
    const chatType = String(message?.chat?.type ?? "private");
    const chatTitle = String(message?.chat?.title ?? "");

    if (text.startsWith("/link")) {
      const code = text.slice("/link".length).trim().split(/\s+/)[0] ?? "";
      const reply = code
        ? await linkGroup(chatId, chatType, chatTitle, code)
        : T.groupNeedsCode.ru;
      await sendTelegram(chatId, reply);
      return c.json({ ok: true });
    }

    if (text.startsWith("/unlink")) {
      // Отвязать может любой участник чата: это не разглашение, а прекращение
      // рассылки в него. Спорить о правах здесь дороже, чем позволить.
      await getDb().delete(telegramGroups).where(eq(telegramGroups.chatId, chatId));
      await sendTelegram(chatId, T.groupUnlinked.ru);
      return c.json({ ok: true });
    }

    if (chatType === "group" || chatType === "supergroup") {
      /*
        Больше в группе бот не отвечает ничего.

        Ответы бота — это остатки, выручка и долги организации. В личной
        переписке их читает человек, чья роль это позволяет; в группе — все,
        кого туда добавили, включая тех, кому такие числа не показывают.
        Поэтому группа только ПОЛУЧАЕТ события, а спрашивать в ней нельзя.
      */
      return c.json({ ok: true });
    }

    // ── /start с токеном привязки ──────────────────────────────────────────
    if (text.startsWith("/start")) {
      const payload = text.slice("/start".length).trim();
      if (payload) {
        const error = await link(chatId, payload);
        if (error) { await sendTelegram(chatId, error); return c.json({ ok: true }); }
      }
    }

    const user = await findByChat(chatId);
    if (!user) {
      // Вежливо и без единого числа из системы: чат чужой, но человек может
      // быть своим — просто ещё не привязался.
      await sendTelegram(chatId, T.unknownChat.ru);
      return c.json({ ok: true });
    }

    // ── Язык: спрашиваем один раз ──────────────────────────────────────────
    if (!user.lang || detectIntent(text) === "lang") {
      await sendTelegram(chatId, T.chooseLang.ru, langButtons);
      return c.json({ ok: true });
    }
    const lang = user.lang;

    if (detectIntent(text) === "stop") {
      await getDb().update(users).set({ telegramChatId: null }).where(eq(users.id, user.id));
      await sendTelegram(chatId, T.stopped[lang]);
      return c.json({ ok: true });
    }

    // Привязка удалась — поздороваться и показать меню.
    if (text.startsWith("/start")) {
      await sendTelegram(chatId, `${T.linked[lang]}\n\n<b>${tgEscape(user.brand)}</b>\n\n${T.help[lang]}`, keyboard(lang));
      return c.json({ ok: true });
    }

    // ── Ворота ─────────────────────────────────────────────────────────────
    if (!PLANS_WITH_BOT.has(user.plan)) {
      await sendTelegram(chatId, T.planRequired[lang]);
      return c.json({ ok: true });
    }
    if (!CAN_ASK.has(user.role)) {
      await sendTelegram(chatId, T.notAllowed[lang]);
      return c.json({ ok: true });
    }

    await sendTelegram(chatId, await answer(user, lang, text), keyboard(lang));
    return c.json({ ok: true });
  } catch (err) {
    logger.error("telegram webhook failed", { error: err instanceof Error ? err.message : String(err) });
    /*
      Telegram всегда получает 200. На любой другой код он повторяет доставку,
      а через сутки безуспешных попыток отключает вебхук совсем — то есть одна
      наша ошибка выключила бы бота у всех.
    */
    return c.json({ ok: true });
  }
});

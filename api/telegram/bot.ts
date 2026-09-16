import { Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants, telegramGroups, users } from "@db/schema";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { safeEqual } from "../lib/safe-compare";
import { checkRateLimit } from "../lib/rate-limit";
import { sendTelegram, tgEscape, answerCallback } from "../lib/telegram";
import { readLinkToken, readGroupToken } from "./link-token";
import { T, MENUS, menuGroup, detectIntent, detectPeriod, type Lang, type Period, type Intent } from "./texts";
import {
  answerStock, answerOrders, answerPending, answerAgents, answerSummary, answerTop, answerDebts, answerDeliveries,
  answerCash, answerSearch, answerStaff, answerPlans, currencyOf, type Scope, type Reply,
} from "./answers";

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

/**
 * Тарифы, на которых бот отвечает. Пробный даёт все функции — решение
 * владельца от 09.09.2026: покупатель пришёл смотреть, и запирать от него бот
 * значит не показать то, что продаём.
 */
export const PLANS_WITH_BOT = new Set(["trial", "pro", "exclusive"]);

/**
 * Что можно спросить каждой группе ролей; остальное уходит в поиск или помощь.
 *
 * Было: агенту — отказ «запросы доступны руководителям». Агент — единственный,
 * у кого телефон в руке весь день, и ему бот был не нужен. Теперь он видит
 * СВОЁ: план, заказы, долги своих магазинов (scope в answers.ts), а числа
 * организации — сводку по всем, агентов, доставки — по-прежнему только офис.
 */
export const INTENTS_BY_GROUP: Record<ReturnType<typeof menuGroup>, ReadonlySet<Intent>> = {
  manage:  new Set<Intent>(["summary", "orders", "pending", "agents", "debts", "stock", "deliveries", "top", "plans", "staff", "search", "help", "lang", "stop"]),
  agent:   new Set<Intent>(["summary", "orders", "pending", "debts", "stock", "plans", "cash", "search", "help", "lang", "stop"]),
  courier: new Set<Intent>(["deliveries", "cash", "help", "lang", "stop"]),
};

interface Linked {
  id: number;
  tenantId: number;
  name: string;
  role: string;
  lang: Lang | null;
  plan: string;
  brand: string;
}

const keyboard = (role: string, lang: Lang) => ({
  reply_markup: { keyboard: MENUS[menuGroup(role)][lang].map(row => row.map(text => ({ text }))), resize_keyboard: true },
});

const helpFor = (user: Linked, lang: Lang): string => {
  const g = menuGroup(user.role);
  const body = g === "courier" ? T.helpCourier[lang] : g === "agent" ? T.helpAgent[lang] : T.helpManage[lang];
  return `<b>${tgEscape(user.brand)}</b> · ${tgEscape(user.name)}\n\n${body}`;
};

/** Кто спрашивает — и что ему видно. */
async function scopeFor(user: Linked, lang: Lang): Promise<Scope> {
  const g = menuGroup(user.role);
  return {
    tenantId: user.tenantId, lang, currency: await currencyOf(user.tenantId),
    agentId: g === "agent" ? user.id : undefined,
    courierId: g === "courier" ? user.id : undefined,
    agentName: user.name,
  };
}

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

/** Ответ на вопрос — уже после всех ворот. Роль решает, что за словом «заказы». */
async function answer(user: Linked, lang: Lang, text: string): Promise<Reply> {
  const allowed = INTENTS_BY_GROUP[menuGroup(user.role)];
  let intent = detectIntent(text);
  if (!allowed.has(intent)) intent = allowed.has("search") ? "search" : "help";
  const scope = await scopeFor(user, lang);
  switch (intent) {
    case "summary":    return answerSummary(scope, detectPeriod(text));
    case "orders":     return answerOrders(scope);
    case "pending":    return answerPending(scope);
    case "agents":     return answerAgents(scope);
    case "debts":      return answerDebts(scope);
    case "stock":      return answerStock(scope);
    case "deliveries": return answerDeliveries(scope);
    case "cash":       return answerCash(scope);
    case "top":        return answerTop(scope);
    case "plans":      return answerPlans(scope);
    case "staff":      return answerStaff(scope);
    case "help":       return { text: helpFor(user, lang) };
    default:           return answerSearch(scope, text);
  }
}

/** Нажатие кнопки под сообщением: срок сводки или «Ожидают». */
async function answerCallbackData(user: Linked, lang: Lang, data: string): Promise<Reply | null> {
  const scope = await scopeFor(user, lang);
  const m = /^sum:(today|yesterday|week|month)$/.exec(data);
  if (m) return answerSummary(scope, m[1] as Period);
  if (data === "pending") return answerPending(scope);
  return null;
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

    // ── Кнопки под сообщением: язык, срок сводки, «Ожидают» ──────────────
    const cb = update.callback_query;
    if (cb) {
      const chatId = String(cb.message?.chat?.id ?? "");
      const data = cb.data ?? "";
      // Погасить «часики» на кнопке сразу, ответ придёт отдельным сообщением.
      void answerCallback(cb.id);
      if (!chatId) return c.json({ ok: true });
      if (data.startsWith("lang:")) {
        const lang: Lang = data.endsWith("uz") ? "uz" : "ru";
        await getDb().update(users).set({ telegramLang: lang }).where(eq(users.telegramChatId, chatId));
        const user = await findByChat(chatId);
        if (user) await sendTelegram(chatId, helpFor(user, lang), keyboard(user.role, lang));
        return c.json({ ok: true });
      }
      const user = await findByChat(chatId);
      if (!user || !user.lang || !PLANS_WITH_BOT.has(user.plan)) return c.json({ ok: true });
      if (!(await checkRateLimit(`tg:${chatId}`, { windowMs: 60_000, limit: 20, namespace: "telegram-bot" }))) return c.json({ ok: true });
      const reply = await answerCallbackData(user, user.lang, data);
      if (reply) await sendTelegram(chatId, reply.text, reply.extra);
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

    /* ── Владелец платформы: выдать руководство организации ─────────────────
       Чат владельца задан переменной TELEGRAM_ADMIN_CHAT_ID; любой другой чат
       этой команды не видит — ни ответа, ни списка организаций. */
    if (text.startsWith("/manual")) {
      if (env.telegramAdminChatId && chatId === String(env.telegramAdminChatId)) {
        await sendTelegram(chatId, await manualCommand(text.slice("/manual".length).trim()));
      }
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
      // Чат чужой, но человек может быть своим — просто ещё не привязался.
      // Ни одного числа ИЗ СИСТЕМЫ: называется только его собственный номер
      // чата, который он и так только что нам прислал.
      await sendTelegram(chatId, T.unknownChat.ru.replace("{id}", chatId));
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

    // Привязка удалась — поздороваться и показать меню своей роли.
    if (text.startsWith("/start")) {
      await sendTelegram(chatId, `${T.linked[lang]}\n\n${helpFor(user, lang)}`, keyboard(user.role, lang));
      return c.json({ ok: true });
    }

    // ── Ворота ─────────────────────────────────────────────────────────────
    // Помощь показывается на любом тарифе: человек должен видеть, что бот умеет.
    if (!PLANS_WITH_BOT.has(user.plan) && detectIntent(text) !== "help") {
      await sendTelegram(chatId, T.planRequired[lang]);
      return c.json({ ok: true });
    }

    const reply = await answer(user, lang, text);
    await sendTelegram(chatId, reply.text, { ...keyboard(user.role, lang), ...(reply.extra ?? {}) });
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

/**
 * /manual — список организаций и у кого руководство есть;
 * /manual <slug|id> on|off — выдать или забрать. Журнал и сброс кэша — в
 * setManualAccessFor, той же двери, что у суперадмина.
 */
export async function manualCommand(args: string): Promise<string> {
  const { setManualAccessFor } = await import("../services/manual-access");
  const [who, what] = args.split(/\s+/).filter(Boolean);
  const db = getDb();
  if (!who) {
    const rows = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, manualEnabledAt: tenants.manualEnabledAt })
      .from(tenants).where(ne(tenants.slug, "system")).orderBy(tenants.name);
    const lines = rows.map(r => `${r.manualEnabledAt ? "✅" : "▫️"} <code>${tgEscape(r.slug)}</code> — ${tgEscape(r.name)}`);
    return `<b>Руководство по организациям</b>\n${lines.join("\n") || "организаций нет"}\n\nВыдать: <code>/manual slug on</code>, забрать: <code>/manual slug off</code>`;
  }
  if (what !== "on" && what !== "off") return "Формат: /manual &lt;slug или id&gt; on|off";
  const cond = /^\d+$/.test(who) ? eq(tenants.id, Number(who)) : eq(tenants.slug, who);
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(cond).limit(1);
  if (!t) return `Организации «${tgEscape(who)}» нет`;
  const r = await setManualAccessFor(t.id, what === "on", { id: undefined, name: "Владелец (Telegram)" });
  if (!r) return `Организации «${tgEscape(who)}» нет`;
  return what === "on"
    ? `✅ ${tgEscape(r.name)}: руководство выдано — у сотрудников появилась «Справка»`
    : `▫️ ${tgEscape(r.name)}: руководство отключено`;
}

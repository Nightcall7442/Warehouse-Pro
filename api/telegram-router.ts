import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, ne, sql, isNull } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery, managementQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, telegramRules, telegramGroups } from "@db/schema";
import { env } from "./lib/env";
import { onDay, onDate } from "./lib/date-range";
import type { Role } from "@contracts/types";
import { createLinkToken, createGroupToken } from "./telegram/link-token";
import { NotificationService } from "./services/NotificationService";

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

// ── tRPC router ──────────────────────────────────────────────────────────────
export const telegramRouter = createRouter({
  /**
   * Save own Telegram chat_id.
   * Agent opens @userinfobot in Telegram → gets their numeric ID → enters here.
   */
  saveChatId: authedQuery
    .input(z.object({ chatId: z.string().regex(/^\d+$/, "chat_id должен быть числом") }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(users)
        .set({ telegramChatId: input.chatId })
        .where(eq(users.id, ctx.user.id));

      // Test: send a welcome message
      const ok = await sendTelegram(
        input.chatId,
        `✅ <b>Warehouse Pro</b>\n\nВы успешно подключили Telegram уведомления!\n👤 ${tgEscape(ctx.user.name)}`,
      );

      return { success: true, testMessageSent: ok };
    }),

  /** Remove own chat_id (disable notifications) */
  removeChatId: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    await db.update(users)
      .set({ telegramChatId: null })
      .where(eq(users.id, ctx.user.id));
    return { success: true };
  }),

  /**
   * Правила уведомлений: кому что уходит.
   *
   * Отдаются УЖЕ СЛОЖЕННЫМИ — умолчания плюс изменения директора. Показывать
   * пустую таблицу и подписывать «ничего не настроено» нельзя: у организации,
   * которая ничего не трогала, уведомления работают, и экран обязан это
   * показывать, иначе директор выключит то, чего не включал.
   */
  rules: adminQuery.query(async ({ ctx }) => {
    const { DEFAULT_RULES, recipientRoles } = await import("./services/telegram-notify");
    const events = Object.keys(DEFAULT_RULES) as Array<keyof typeof DEFAULT_RULES>;
    const rows = await Promise.all(events.map(async event => ({
      event,
      roles: await recipientRoles(ctx.tenant.id, event),
      defaults: DEFAULT_RULES[event],
    })));
    return rows;
  }),

  setRule: adminQuery
    .input(z.object({
      event: z.enum(["order.created", "stock.low", "debt.overdue", "delivery.assigned"]),
      role:  z.enum(["ceo", "operator", "supervisor", "agent", "merchandiser", "courier"]),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      /*
        Запись всегда явная — и когда включают, и когда выключают. Удалять
        строку при совпадении с умолчанием заманчиво, но тогда смена умолчания
        в коде молча изменила бы поведение у тех, кто это уже решил сам.
      */
      await db.insert(telegramRules)
        .values({ tenantId: ctx.tenant.id, event: input.event, role: input.role, enabled: input.enabled })
        .onDuplicateKeyUpdate({ set: { enabled: input.enabled } });
      return { success: true };
    }),

  /** Get own chat_id status */
  myStatus: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [user] = await db.select({ chatId: users.telegramChatId })
      .from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return { connected: !!user?.chatId, chatId: user?.chatId ?? null };
  }),

  /* ═════════════════════════════════════════════════════════════════════════
     Кто из сотрудников подключил Telegram.

     ── Чего не хватало ──────────────────────────────────────────────────────

     Подключиться сотрудник может только САМ: ссылка подписана его
     идентификатором и живёт четверть часа. Это правильно — иначе директор
     привязал бы к своему телефону чужую учётную запись, а пересланная ссылка
     стала бы способом читать чужие уведомления.

     Но из этого следовало неудобное: директор, подключивший организацию, не
     мог узнать НИЧЕГО. Ни кто уже подключился, ни кому напомнить. Уведомления
     уходили половине людей, и почему именно этой половине — было не выяснить.

     Здесь список: имя, должность, подключён или нет. Ни одного chat_id: он
     нужен серверу, а человеку показывает лишь то, что и так видно в самом
     Telegram.
     ═════════════════════════════════════════════════════════════════════════ */
  teamStatus: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select({
      id: users.id,
      name: users.name,
      role: users.role,
      connected: sql<number>`CASE WHEN ${users.telegramChatId} IS NULL THEN 0 ELSE 1 END`,
    })
      .from(users)
      .where(and(
        eq(users.tenantId, ctx.tenant.id),
        eq(users.status, "active"),
      ))
      .orderBy(users.name);

    return rows.map(r => ({
      id: Number(r.id),
      name: r.name,
      role: r.role,
      connected: Number(r.connected) === 1,
    }));
  }),

  /**
   * Напомнить о подключении тем, кто ещё не подключился.
   *
   * Не рассылка «всем подряд»: получают её ровно те, у кого Telegram не
   * привязан. Подключившийся не должен получать напоминание сделать то, что
   * он уже сделал, — от таких сообщений люди перестают читать все остальные.
   *
   * Уведомление идёт внутрь приложения (и на телефон, если стоит мобильное):
   * в Telegram написать этим людям нельзя по определению — именно его у них и
   * нет.
   */
  remindToConnect: adminQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const pending = await db.select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.tenantId, ctx.tenant.id),
        eq(users.status, "active"),
        isNull(users.telegramChatId),
      ));

    for (const u of pending) {
      await NotificationService.create(db, {
        tenantId: ctx.tenant.id,
        userId: Number(u.id),
        type: "system",
        title: "Подключите Telegram",
        message: "Настройки → Telegram. Так вы будете получать заказы и задачи в телефон.",
        link: "/settings",
      });
    }

    return { sent: pending.length };
  }),

  /* ═════════════════════════════════════════════════════════════════════════
     Группа сотрудников: код для связывания и текущее состояние.

     Подключать людей по одному не нужно — достаточно одного чата: директор
     заводит группу, добавляет бота и вставляет туда код. Дальше рабочие
     события видят все, кто в чате, включая тех, кто ничего не настраивал.

     Код живёт четверть часа и подписан. Дольше — значит он успеет полежать в
     переписке, а он даёт право слить рабочие события организации в любой чат,
     куда его вставят.
     ═════════════════════════════════════════════════════════════════════════ */
  groupStatus: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [group] = await db.select({
      chatId: telegramGroups.chatId,
      title: telegramGroups.title,
      createdAt: telegramGroups.createdAt,
    })
      .from(telegramGroups)
      .where(eq(telegramGroups.tenantId, ctx.tenant.id))
      .limit(1);

    return {
      linked: !!group,
      title: group?.title ?? null,
      since: group?.createdAt ?? null,
      /* Сам идентификатор чата наружу не отдаём: серверу он нужен, человеку
         ничего не говорит, а в журнале браузера ему делать нечего. */
    };
  }),

  groupCode: adminQuery.query(async ({ ctx }) => {
    return {
      code: createGroupToken(ctx.tenant.id, ctx.user.id),
      /* Показываем срок словами: «код на 15 минут» человек понимает, а
         метку времени — нет. */
      minutes: 15,
    };
  }),

  unlinkGroup: adminQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    await db.delete(telegramGroups).where(eq(telegramGroups.tenantId, ctx.tenant.id));
    return { ok: true };
  }),

  /** Admin: test message to all agents in tenant */
  /* ═════════════════════════════════════════════════════════════════════════
     Проверка связи.

     ── Что было ─────────────────────────────────────────────────────────────

     Кнопка слала сообщение роли «агент» и всегда отвечала «Отправлено —
     проверьте телеграм». У организации, где к боту не подключён НИКТО, это
     означало: не ушло ничего, экран сказал «успешно», и человек шёл искать
     поломку в Telegram.

     Хуже: директор, который на кнопку и нажимает, сообщения не получал в
     принципе — он не агент. То есть проверка связи не проверяла связь того,
     кто её запустил.

     ── Как теперь ───────────────────────────────────────────────────────────

     Проверка идёт ТУДА, где её ждёт нажавший: себе и в общий чат, если он
     связан. И возвращает, что вышло на самом деле, — по каждому адресату
     отдельно. «Никуда не ушло» — это ответ, а не успех.
     ═════════════════════════════════════════════════════════════════════════ */
  testBroadcast: adminQuery
    .input(z.object({ message: z.string().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // Пишет человек руками, не разметкой: шальная скобка иначе съела бы всё
      // сообщение целиком.
      const text = tgEscape(input.message);

      const [me] = await db.select({ chatId: users.telegramChatId })
        .from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const [group] = await db.select({ chatId: telegramGroups.chatId })
        .from(telegramGroups).where(eq(telegramGroups.tenantId, ctx.tenant.id)).limit(1);

      const toSelf = me?.chatId ? await sendTelegram(me.chatId, text) : false;
      const toGroup = group?.chatId ? await sendTelegram(group.chatId, text) : false;

      return {
        toSelf,
        toGroup,
        selfLinked: !!me?.chatId,
        groupLinked: !!group?.chatId,
      };
    }),

  /* ═════════════════════════════════════════════════════════════════════════
     Директор подключает сотрудника сам — по его номеру в Telegram.

     ── Зачем ────────────────────────────────────────────────────────────────

     Личная ссылка требует, чтобы человек зашёл в приложение и нажал кнопку.
     Половина смены этого не сделает никогда: агент работает с телефона, в
     настройки веба не заходит, и «подключись» тонет среди прочего.

     Откуда директор берёт номер: сотрудник открывает бота и нажимает
     «Запустить», бот отвечает его номером (см. unknownChat в texts.ts), тот
     пересылает сообщение директору. Сам в списке участников группы номер не
     виден — Telegram его не показывает нигде.

     Этот путь заодно снимает вторую беду: нажатое «Запустить» и есть то
     единственное, чего Telegram требует, чтобы бот мог написать первым.

     ── Чего это НЕ делает, и об этом надо сказать ───────────────────────────

     Не заставляет бота написать первым. Telegram запрещает боту начинать
     разговор: пока человек не нажал «Запустить» в самом боте, доставка
     отклоняется. Поэтому здесь сразу после записи идёт ПРОБНАЯ отправка, и
     её исход возвращается как есть: «записали и дошло» или «записали, но
     человек ещё не запускал бота».

     Молчать об этом нельзя — иначе директор считает, что подключил человека,
     а тот не получает ничего и не знает, что должен что-то нажать.

     ── Один чат — один человек ──────────────────────────────────────────────

     Тот же запрет, что и при самостоятельной привязке: иначе уведомления
     директора начали бы приходить агенту, чей номер вписали дважды.
     ═════════════════════════════════════════════════════════════════════════ */
  setUserChatId: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      /* Пусто — отвязать. Номер пользователя в Telegram всегда положительный;
         отрицательные принадлежат группам, и человеку такой не подходит. */
      chatId: z.string().trim().regex(/^\d{5,20}$/, "Telegram ID — только цифры (это не номер телефона)").or(z.literal("")),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [target] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });

      if (!input.chatId) {
        await db.update(users).set({ telegramChatId: null }).where(eq(users.id, input.userId));
        return { linked: false, delivered: false, reason: "unlinked" as const };
      }

      const [taken] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.telegramChatId, input.chatId), ne(users.id, input.userId)))
        .limit(1);
      if (taken) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Этот Telegram уже привязан к другому сотруднику.",
        });
      }

      await db.update(users).set({ telegramChatId: input.chatId }).where(eq(users.id, input.userId));

      /*
        Пробная отправка сразу. Она и есть проверка номера: ошиблись цифрой —
        Telegram откажет, и директор узнает об этом здесь, а не через неделю
        по жалобе «мне ничего не приходит».
      */
      const delivered = await sendTelegram(
        input.chatId,
        `<b>Warehouse Pro</b>\nВаш Telegram подключён к учётной записи: ${tgEscape(target.name)}.\n\nСюда будут приходить рабочие уведомления.`,
      );

      return {
        linked: true,
        delivered,
        reason: delivered ? ("ok" as const) : ("not_started" as const),
      };
    }),

  /** One-tap Telegram connect via deep link */
  deepLink: authedQuery.query(async ({ ctx }) => {
    const botToken = env.telegramBotToken;
    if (!botToken) return { url: null, error: "Telegram bot not configured" };

    // Get bot username from token
    const botInfo = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
      .then(r => r.json() as Promise<{ result?: { username?: string } }>)
      .catch(() => null);

    const botUsername = botInfo?.result?.username;
    if (!botUsername) return { url: null, error: "Cannot fetch bot info" };

    /*
      В ссылке едет ПОДПИСЬ, а не номер пользователя.

      Раньше здесь стояло `?start=${ctx.user.id}` — в открытом виде и без
      подписи. Обработчика у ссылки не было вовсе, и потому дыра не выстрелила:
      подключи кто-нибудь вебхук как есть — и любой человек написал бы боту
      «/start 5», привязав свой телефон к пятому пользователю системы. Дальше
      он получал бы его уведомления, а на тарифе с ответами бота — остатки и
      выручку чужой организации.

      Подпись живёт четверть часа: этого хватает дойти от настроек до Telegram
      и мало, чтобы переслать ссылку кому-то ещё.
    */
    const url = `https://t.me/${botUsername}?start=${createLinkToken(ctx.user.id)}`;
    return { url, botUsername };
  }),

  /**
   * Дайджест за день: заказы, выручка, выполнение плана визитов, остатки.
   *
   * Раньше стоял на authedQuery — то есть на любом, кто вошёл. Из-за этого
   * курьер (роль courier не входит ни в fieldSalesQuery, ни в reportsQuery)
   * одним запросом с токеном мобильного приложения получал по своей
   * организации дневную выручку в сумах, число заказов и выполненных, процент
   * выполнения плана визитов и пять названий товаров с точными остатками на
   * складе. То же самое видел мерчандайзер и рядовой агент — люди, которые
   * ежедневно ходят по чужим торговым точкам и торгуются о цене.
   *
   * Это сводка для руководства и по составу, и по назначению, поэтому здесь
   * managementQuery (ceo/operator/supervisor) — тот же круг, что читает планы
   * и цифры команды. Полевым ролям отдельная урезанная версия здесь не
   * заводится: сегодня её никто не запрашивает, а пустая процедура «на всякий
   * случай» — ещё одна дверь, которую придётся сторожить.
   */
  dailyDigest: managementQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.tenant.id;
    const today = new Date().toISOString().split("T")[0];

    const { orders, warehouseStock, products, dailyPlans } = await import("@db/schema");
    const { eq, and, sql } = await import("drizzle-orm");

    const [todayStats, lowStock, planProgress] = await Promise.all([
      // Today's orders
      db.select({
        totalOrders: sql<number>`count(*)`,
        completedOrders: sql<number>`count(CASE WHEN ${orders.status} = 'delivered' THEN 1 END)`,
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      }).from(orders).where(and(
        eq(orders.tenantId, tenantId),
        onDay(orders.createdAt, today),
      )),

      // Low stock items
      db.select({
        productName: products.name,
        available: warehouseStock.available,
      }).from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.available} < ${products.reorderPoint}`))
        .limit(5),

      // Today's plan progress
      db.select({
        total: sql<number>`count(*)`,
        visited: sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
      }).from(dailyPlans).where(and(
        eq(dailyPlans.tenantId, tenantId),
        onDate(dailyPlans.planDate, today),
      )),
    ]);

    const stats = todayStats[0];
    const plan = planProgress[0];
    const planPct = plan && Number(plan.total) > 0 ? Math.round((Number(plan.visited) / Number(plan.total)) * 100) : 0;

    // Build digest message
    const lines = [
      `📊 <b>Дайджест за ${today}</b>`,
      ``,
      `🛒 Заказов: ${stats?.totalOrders ?? 0} (${stats?.completedOrders ?? 0} выполнено)`,
      `💰 Выручка: ${Number(stats?.totalRevenue ?? 0).toLocaleString("ru")} сум`,
      `📅 План: ${plan?.visited ?? 0}/${plan?.total ?? 0} (${planPct}%)`,
    ];

    if (lowStock.length > 0) {
      lines.push(``, `⚠️ Мало на складе:`);
      lowStock.forEach(s => {
        lines.push(`  • ${s.productName}: ${Number(s.available ?? 0).toFixed(1)} кг`);
      });
    }

    return {
      text: lines.join("\n"),
      stats: {
        totalOrders: Number(stats?.totalOrders ?? 0),
        completedOrders: Number(stats?.completedOrders ?? 0),
        totalRevenue: Number(stats?.totalRevenue ?? 0),
        planPct,
        lowStockCount: lowStock.length,
      },
    };
  }),
});

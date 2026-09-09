import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { supportMessages, supportThreads, tenants, users } from "@db/schema";
import { sseBus } from "../lib/sse";
import { logger } from "../lib/logger";
import { planHas, type PlanKey } from "../../contracts/constants";

/* ═══════════════════════════════════════════════════════════════════════════
   Чат поддержки — правила разговора.

   ── Зачем служба, а не код прямо в роутере ──────────────────────────────────

   У разговора две стороны, и обе ходят в одни и те же данные с разных сторон:
   пользователь читает свой тред, платформа — любой. Правила при этом общие:
   что считать непрочитанным, кому видно, кого пускать. Разложенные по двум
   ручкам, они разошлись бы — и разошлись бы молча, а цена расхождения здесь
   чужая переписка.

   ── Кого пускают ────────────────────────────────────────────────────────────

   Тариф Exclusive. «24/7 поддержка» стоит в его списке возможностей на экране
   оплаты, и до сих пор за этой строкой ничего не стояло.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько сообщений отдаётся за раз. */
export const PAGE_SIZE = 50;

/** Предел длины — тот же, что у столбца: обрезать чужую жалобу нельзя. */
export const MAX_BODY = 4000;

export class NotOnExclusiveError extends TRPCError {
  constructor() {
    super({
      code: "FORBIDDEN",
      message: "Чат поддержки входит в тариф Exclusive.",
    });
  }
}

/**
 * Тариф организации.
 *
 * Спрашивается у базы, а не берётся из сессии: тариф меняют суперадмин, Stripe
 * и крон, и сессия о смене не узнает до перевхода. Проверка прав по устаревшим
 * данным — это доступ, который забыли отобрать.
 */
export async function tenantPlan(tenantId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.plan ?? null;
}

export async function hasSupportChat(tenantId: number): Promise<boolean> {
  /*
    Сравнение с "exclusive" строкой стояло здесь, а на экране оплаты не стояло
    нигде: карточки тарифов сравнивались одними числами, и то единственное, чем
    Exclusive отличается по существу, при выборе было не видно. Теперь и доступ,
    и подпись на карточке читают одну запись.
  */
  const plan = await tenantPlan(tenantId);
  return Boolean(plan && planHas(plan as PlanKey, "supportChat"));
}

export async function requireSupportChat(tenantId: number): Promise<void> {
  if (!(await hasSupportChat(tenantId))) throw new NotOnExclusiveError();
}

export interface ChatMessage {
  id: number;
  fromPlatform: boolean;
  authorName: string | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * Сообщения одного разговора, от старых к новым.
 *
 * `before` — идентификатор самого старого показанного сообщения; так листается
 * история вверх. Смещением листать нельзя: пока человек читает, приходят новые
 * сообщения, и страница «ещё 50 назад» съезжает.
 */
export async function threadMessages(
  tenantId: number,
  userId: number,
  before?: number,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const author = users;
  const rows = await getDb()
    .select({
      id: supportMessages.id,
      fromPlatform: supportMessages.fromPlatform,
      authorName: author.name,
      body: supportMessages.body,
      createdAt: supportMessages.createdAt,
      readAt: supportMessages.readAt,
    })
    .from(supportMessages)
    .leftJoin(author, eq(author.id, supportMessages.authorId))
    .where(and(
      eq(supportMessages.tenantId, tenantId),
      eq(supportMessages.userId, userId),
      ...(before ? [lt(supportMessages.id, before)] : []),
    ))
    // Берём с конца — свежие, — и разворачиваем: на экране разговор читается
    // сверху вниз, а грузить надо последние.
    .orderBy(desc(supportMessages.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  return { messages: rows.slice(0, PAGE_SIZE).reverse(), hasMore };
}

/** Сколько сообщений одной стороны не прочитала другая. */
export async function unreadCount(tenantId: number, userId: number, fromPlatform: boolean): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(supportMessages)
    .where(and(
      eq(supportMessages.tenantId, tenantId),
      eq(supportMessages.userId, userId),
      eq(supportMessages.fromPlatform, fromPlatform),
      isNull(supportMessages.readAt),
    ));
  return Number(row?.count ?? 0);
}

/**
 * Отметить прочитанным то, что написала другая сторона.
 *
 * Своё же непрочитанное не трогается: отметка «прочитано» принадлежит
 * получателю, и если её ставить обеим сторонам сразу, счётчик у поддержки
 * обнулялся бы в тот момент, когда человек открыл свой экран.
 */
export async function markRead(tenantId: number, userId: number, sideRead: boolean): Promise<void> {
  await getDb()
    .update(supportMessages)
    .set({ readAt: new Date() })
    .where(and(
      eq(supportMessages.tenantId, tenantId),
      eq(supportMessages.userId, userId),
      eq(supportMessages.fromPlatform, sideRead),
      isNull(supportMessages.readAt),
    ));
}

export interface PostInput {
  tenantId: number;
  /** Чей разговор. */
  userId: number;
  /** Кто написал: пользователь или сотрудник платформы. */
  fromPlatform: boolean;
  /** Кто именно нажал «отправить». */
  authorId: number;
  body: string;
}

/**
 * Записать сообщение и разбудить того, кому оно адресовано.
 *
 * Ответ платформы уходит живым событием ровно тому пользователю, чей это
 * разговор. Сообщение пользователя события не порождает: поддержка сидит не в
 * этой организации, а рассылка устроена по организациям — её обращения видны в
 * своём списке, который обновляется сам.
 */
export async function postMessage(input: PostInput): Promise<{ id: number }> {
  const body = input.body.trim();
  if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "Сообщение пустое." });
  if (body.length > MAX_BODY) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Сообщение длиннее ${MAX_BODY} символов.` });
  }

  /*
    Разговор заводится ДО сообщения.

    Порядок важен: сначала окно, потом то, что в него попадает. Сделай мы
    наоборот — сообщение легло бы на миллисекунду раньше начала разговора и не
    попало бы в его окно времени, то есть при стирании осталось бы в базе
    навсегда. Здесь же это и отмена стирания: письмо в закрытый, но ещё не
    стёртый разговор открывает его заново.
  */
  await ensureOpenThread(input.tenantId, input.userId);

  const result = await getDb().insert(supportMessages).values({
    tenantId: input.tenantId,
    userId: input.userId,
    fromPlatform: input.fromPlatform,
    authorId: input.authorId,
    body,
  });
  const id = Number((result as unknown as { insertId?: number }).insertId ?? 0);

  /*
    Письмо от арендатора — в телеграм платформе.

    Иначе вопрос лежит в системе до тех пор, пока кто-нибудь не откроет
    суперадмина и не заметит его сам. Человек в это время ждёт: он написал в
    поддержку, а поддержка о нём не знает.

    Не ждём отправки и не роняем сообщение, если телеграм недоступен: письмо
    уже записано, и оно важнее уведомления о нём.
  */
  if (!input.fromPlatform) {
    void notifyPlatformAboutQuestion(input.tenantId, input.userId, body);
  }

  if (input.fromPlatform) {
    sseBus.emit({
      type: "support.message",
      tenantId: input.tenantId,
      userId: input.userId,
      data: { id, preview: body.slice(0, 120) },
    });
  }

  return { id };
}

/**
 * Как часто беспокоить платформу об одном и том же разговоре.
 *
 * Человек пишет вопрос в три-четыре сообщения подряд — мысль, уточнение, «а
 * ещё». Уведомлять о каждом значит превратить телеграм в ленту, которую
 * перестают читать. Пятнадцать минут: серия реплик даёт одно уведомление, а
 * вопрос, заданный через час, — новое.
 */
const NOTIFY_QUIET_MS = 15 * 60 * 1000;

/**
 * Сказать платформе, что арендатор написал.
 *
 * Ошибки глушатся намеренно: сообщение уже записано и человек его отправил.
 * Недоступный телеграм — повод для строки в журнале, а не для отказа в отправке
 * письма.
 */
async function notifyPlatformAboutQuestion(tenantId: number, userId: number, body: string): Promise<void> {
  try {
    const db = getDb();

    /*
      Было ли недавнее сообщение от этого же человека.

      Считаем ДО вставки текущего? Нет — оно уже вставлено, поэтому берём
      предпоследнее: смотрим второе с конца. Иначе своё же сообщение и было бы
      «недавним», и уведомление не ушло бы никогда.
    */
    const recent = await db.select({ createdAt: supportMessages.createdAt })
      .from(supportMessages)
      .where(and(
        eq(supportMessages.tenantId, tenantId),
        eq(supportMessages.userId, userId),
        eq(supportMessages.fromPlatform, false),
      ))
      .orderBy(desc(supportMessages.id))
      .limit(2);

    const previous = recent[1];
    if (previous && Date.now() - new Date(previous.createdAt).getTime() < NOTIFY_QUIET_MS) return;

    const [org] = await db.select({ name: tenants.name })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const [who] = await db.select({ name: users.name })
      .from(users).where(eq(users.id, userId)).limit(1);

    const { notifyAdmin, tgMessages } = await import("../telegram-router");
    await notifyAdmin(tgMessages.supportMessage(
      org?.name ?? `#${tenantId}`,
      who?.name ?? `#${userId}`,
      // Длинное письмо в уведомлении не нужно: оно зовёт открыть переписку, а
      // не заменяет её.
      body.length > 300 ? `${body.slice(0, 300)}…` : body,
    ));
  } catch (e) {
    logger.warn("не удалось уведомить платформу о вопросе в поддержку", {
      tenantId, userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Жизнь разговора: открыт → завершён → стёрт.

   ── Решение владельца ───────────────────────────────────────────────────────

   Переписка не лежит у нас вечно. Завершённый разговор через неделю стирается;
   от него остаётся строка без текстов — чей разговор, когда шёл, сколько было
   сообщений. Платформа не теряет счёт обращений, а содержание чужих жалоб у
   нас не хранится.

   ── Почему неделя, а не сразу ───────────────────────────────────────────────

   Ответ поддержки нужен человеку и назавтра: «как вы это чинили» перечитывают.
   Неделя же чинит и промах: закрыли по ошибке — достаточно написать снова,
   разговор откроется заново и стирание отменится само.

   ── Почему разговор закрывается сам ─────────────────────────────────────────

   Иначе брошенные висят вечно. Закрывать вручную каждый разговор, на который
   просто перестали отвечать, никто не вспомнит — и затея свелась бы к тому,
   что стираются только те переписки, о которых кто-то позаботился.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько живёт переписка после завершения разговора. */
export const RETENTION_DAYS = 7;

/** После скольких дней молчания разговор закрывается сам. */
export const SILENCE_DAYS = 14;

const DAY_MS = 86_400_000;

export type ClosedBy = "client" | "platform" | "silence";

export interface ThreadState {
  /** Пусто — разговор идёт. */
  closedAt: Date | null;
  closedBy: ClosedBy | null;
  /** Когда сотрутся тексты. Пусто, пока разговор не завершён. */
  purgeAt: Date | null;
}

/** Последний по времени разговор пары — тот, что показывается на экране. */
async function latestThread(tenantId: number, userId: number) {
  const [row] = await getDb()
    .select({
      id: supportThreads.id,
      openedAt: supportThreads.openedAt,
      closedAt: supportThreads.closedAt,
      closedBy: supportThreads.closedBy,
      purgedAt: supportThreads.purgedAt,
    })
    .from(supportThreads)
    .where(and(eq(supportThreads.tenantId, tenantId), eq(supportThreads.userId, userId)))
    .orderBy(desc(supportThreads.id))
    .limit(1);
  return row ?? null;
}

/**
 * Состояние разговора для экрана.
 *
 * Стёртый разговор состоянием не считается: для человека это не «завершённый
 * разговор без сообщений», а чистый лист — можно писать заново. Строка о нём
 * остаётся, но она для платформы, а не для него.
 */
export async function threadState(tenantId: number, userId: number): Promise<ThreadState> {
  const t = await latestThread(tenantId, userId);
  if (!t || t.purgedAt || !t.closedAt) return { closedAt: null, closedBy: null, purgeAt: null };
  return {
    closedAt: t.closedAt,
    closedBy: (t.closedBy as ClosedBy | null) ?? null,
    purgeAt: new Date(t.closedAt.getTime() + RETENTION_DAYS * DAY_MS),
  };
}

/**
 * Разговор, в который ляжет новое сообщение.
 *
 * Три случая: идёт — пишем в него; завершён, но ещё не стёрт — открываем
 * заново (это и есть отмена стирания); стёрт или не было вовсе — начинаем
 * новый.
 */
export async function ensureOpenThread(tenantId: number, userId: number): Promise<void> {
  const db = getDb();
  const t = await latestThread(tenantId, userId);

  if (t && !t.closedAt) return;

  if (t && !t.purgedAt) {
    await db
      .update(supportThreads)
      .set({ closedAt: null, closedBy: null })
      .where(eq(supportThreads.id, t.id));
    return;
  }

  await db.insert(supportThreads).values({ tenantId, userId });
}

/**
 * Завершить разговор.
 *
 * Закрываются ВСЕ открытые строки пары, а не одна. Две открытые могут
 * появиться, если человек отправил два сообщения одновременно и обе проверки
 * «есть ли открытый» прошли до первой вставки. Случай редкий, замок ради него
 * держать незачем — но оставь мы вторую строку открытой, разговор после
 * нажатия «завершить» так и остался бы незакрытым, и человек нажимал бы ещё
 * раз, не понимая, почему не работает.
 */
export async function closeThread(tenantId: number, userId: number, by: ClosedBy): Promise<void> {
  await getDb()
    .update(supportThreads)
    .set({ closedAt: new Date(), closedBy: by })
    .where(and(
      eq(supportThreads.tenantId, tenantId),
      eq(supportThreads.userId, userId),
      isNull(supportThreads.closedAt),
    ));
}

/**
 * Стереть сообщения по условию и записать, сколько их было.
 *
 * Одно место на оба пути — и на срок, и на «стереть сейчас». Удаление должно
 * быть написано ОДИН раз: два вызова delete по чуть разным условиям — это
 * способ однажды стереть не то, и заметить это будет уже не по чему.
 *
 * Считать надо ДО удаления: после него считать нечего, а число — единственное,
 * что остаётся от разговора.
 */
async function wipe(threadId: number, where: ReturnType<typeof and>, now: Date): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(supportMessages).where(where);
  const count = Number(row?.count ?? 0);

  await db.delete(supportMessages).where(where);
  await db.update(supportThreads).set({ purgedAt: now, messageCount: count }).where(eq(supportThreads.id, threadId));
  return count;
}

/**
 * Стереть переписку пары ПРЯМО СЕЙЧАС, не дожидаясь срока.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Обычный порядок — завершить разговор и подождать неделю. Но иногда стереть
 * надо немедленно: человек прислал в чат номер карты, паспорт или пароль.
 * Ждать неделю в таком случае значит хранить у себя то, чего хранить нельзя.
 *
 * ── Что именно стирается ────────────────────────────────────────────────────
 *
 * ВСЯ переписка пары, а не только текущий разговор: кнопка называется «стереть
 * переписку», и оставить после неё сообщения прошлых обращений значило бы
 * соврать нажавшему. Разговор при этом закрывается и помечается стёртым — след
 * (сколько было сообщений и когда) остаётся, как и при обычном сроке.
 */
export async function purgeThreadNow(tenantId: number, userId: number, now: Date = new Date()): Promise<{ messages: number }> {
  // Закрыть, если ещё идёт: у открытого разговора нет конца, и след о нём
  // получился бы незавершённым.
  await closeThread(tenantId, userId, "platform");

  const t = await latestThread(tenantId, userId);
  if (!t) return { messages: 0 };

  const messages = await wipe(t.id, and(
    eq(supportMessages.tenantId, tenantId),
    eq(supportMessages.userId, userId),
  ), now);

  return { messages };
}

/**
 * Стереть тексты завершённых разговоров, которым вышел срок.
 *
 * Сообщения разговора — это сообщения той же пары, попавшие в его окно времени.
 * Внешнего ключа между ними нет намеренно (см. db/schema.ts): новый разговор
 * начинается строго после закрытия предыдущего, и окно разделяет их однозначно.
 */
export async function purgeClosedThreads(now: Date = new Date()): Promise<{ threads: number; messages: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);

  const due = await db
    .select({
      id: supportThreads.id,
      tenantId: supportThreads.tenantId,
      userId: supportThreads.userId,
      openedAt: supportThreads.openedAt,
      closedAt: supportThreads.closedAt,
    })
    .from(supportThreads)
    .where(and(
      isNull(supportThreads.purgedAt),
      isNotNull(supportThreads.closedAt),
      lt(supportThreads.closedAt, cutoff),
    ))
    // Порция: разбирать накопившееся понемногу лучше, чем одним запросом на
    // всю таблицу, который держит блокировки дольше, чем идёт рабочий день.
    .limit(200);

  let messages = 0;
  for (const t of due) {
    messages += await wipe(t.id, and(
      eq(supportMessages.tenantId, t.tenantId),
      eq(supportMessages.userId, t.userId),
      gte(supportMessages.createdAt, t.openedAt),
      lte(supportMessages.createdAt, t.closedAt!),
    ), now);
  }

  return { threads: due.length, messages };
}

/** Закрыть разговоры, в которых давно молчат. */
export async function autoCloseSilent(now: Date = new Date()): Promise<{ closed: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - SILENCE_DAYS * DAY_MS);

  const open = await db
    .select({
      id: supportThreads.id,
      tenantId: supportThreads.tenantId,
      userId: supportThreads.userId,
      openedAt: supportThreads.openedAt,
    })
    .from(supportThreads)
    .where(isNull(supportThreads.closedAt))
    .limit(500);
  if (open.length === 0) return { closed: 0 };

  /*
    Когда в каждой паре писали в последний раз — одним запросом на все
    открытые разговоры. По запросу на разговор это был бы тот же ответ ценой
    сотни обращений к базе.
  */
  const lastRows = await db
    .select({
      tenantId: supportMessages.tenantId,
      userId: supportMessages.userId,
      last: sql<Date>`max(${supportMessages.createdAt})`,
    })
    .from(supportMessages)
    .where(inArray(supportMessages.tenantId, [...new Set(open.map(t => t.tenantId))]))
    .groupBy(supportMessages.tenantId, supportMessages.userId);

  const last = new Map(lastRows.map(r => [`${r.tenantId}:${r.userId}`, new Date(r.last)]));

  // Разговор без единого сообщения меряется по своему началу: иначе он
  // остался бы открытым навсегда именно потому, что в нём ничего нет.
  const stale = open.filter(t => (last.get(`${t.tenantId}:${t.userId}`) ?? t.openedAt) < cutoff);
  if (stale.length === 0) return { closed: 0 };

  await db
    .update(supportThreads)
    .set({ closedAt: now, closedBy: "silence" })
    .where(inArray(supportThreads.id, stale.map(t => t.id)));

  return { closed: stale.length };
}

export interface InboxThread {
  tenantId: number;
  tenantName: string;
  plan: string;
  userId: number;
  userName: string;
  userRole: string;
  lastMessage: string;
  lastAt: Date;
  lastFromPlatform: boolean;
  unread: number;
  /** Пусто — разговор идёт. */
  closedAt: Date | null;
  closedBy: ClosedBy | null;
}

/**
 * Список разговоров для поддержки.
 *
 * Сначала те, где ждут ответа, потом остальные по свежести. Сортировать только
 * по времени нельзя: молчащий разговор с непрочитанным вопросом уползал бы вниз
 * ровно потому, что на него не отвечают.
 */
export async function inbox(): Promise<InboxThread[]> {
  const db = getDb();
  const rows = await db
    .select({
      tenantId: supportMessages.tenantId,
      tenantName: tenants.name,
      plan: tenants.plan,
      userId: supportMessages.userId,
      userName: users.name,
      userRole: users.role,
      lastAt: sql<Date>`max(${supportMessages.createdAt})`,
      // Идентификатор последней реплики — из той же группировки. Тексты потом
      // берутся ровно по этим номерам.
      lastId: sql<number>`max(${supportMessages.id})`,
      unread: sql<number>`sum(case when ${supportMessages.fromPlatform} = 0 and ${supportMessages.readAt} is null then 1 else 0 end)`,
    })
    .from(supportMessages)
    .innerJoin(tenants, eq(tenants.id, supportMessages.tenantId))
    // Обзор платформы, организаций много: пользователь сверяется с
    // организацией САМОГО сообщения, а не с константой.
    .innerJoin(users, and(eq(users.id, supportMessages.userId), eq(users.tenantId, supportMessages.tenantId)))
    .groupBy(supportMessages.tenantId, supportMessages.userId, tenants.name, tenants.plan, users.name, users.role)
    .orderBy(desc(sql`max(${supportMessages.createdAt})`))
    .limit(200);

  /*
    Тексты последних реплик — вторым запросом, ровно по собранным номерам.

    Взять их подзапросом в самой группировке нельзя: MySQL отдал бы текст
    произвольной строки группы, а не последней, и в списке стояли бы обрывки
    не из того места разговора.
  */
  const previews = new Map<number, { body: string; fromPlatform: boolean }>();
  const lastIds = rows.map(r => Number(r.lastId)).filter(Boolean);
  if (lastIds.length) {
    const recent = await db
      .select({ id: supportMessages.id, body: supportMessages.body, fromPlatform: supportMessages.fromPlatform })
      .from(supportMessages)
      .where(inArray(supportMessages.id, lastIds));
    for (const m of recent) previews.set(m.id, { body: m.body, fromPlatform: m.fromPlatform });
  }

  /*
    Завершён ли разговор — третьим запросом на все пары сразу.

    Присоединить таблицу разговоров к самой группировке нельзя: у пары их
    несколько (человек обращался не раз), и строка в списке размножилась бы по
    числу прошлых обращений.
  */
  const closed = new Map<string, { closedAt: Date | null; closedBy: ClosedBy | null }>();
  if (rows.length) {
    const states = await db
      .select({
        tenantId: supportThreads.tenantId,
        userId: supportThreads.userId,
        closedAt: supportThreads.closedAt,
        closedBy: supportThreads.closedBy,
        id: supportThreads.id,
      })
      .from(supportThreads)
      .where(inArray(supportThreads.tenantId, [...new Set(rows.map(r => r.tenantId))]))
      .orderBy(supportThreads.id);
    // Порядок по возрастанию — последняя запись пары затирает предыдущие, то
    // есть в карте остаётся самый свежий разговор.
    for (const t of states) {
      closed.set(`${t.tenantId}:${t.userId}`, { closedAt: t.closedAt, closedBy: (t.closedBy as ClosedBy | null) ?? null });
    }
  }

  return rows.map(r => {
    const p = previews.get(Number(r.lastId));
    const state = closed.get(`${r.tenantId}:${r.userId}`);
    return {
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      plan: r.plan,
      userId: r.userId,
      userName: r.userName,
      userRole: r.userRole,
      lastMessage: p?.body ?? "",
      lastAt: r.lastAt,
      lastFromPlatform: p?.fromPlatform ?? false,
      unread: Number(r.unread ?? 0),
      closedAt: state?.closedAt ?? null,
      closedBy: state?.closedBy ?? null,
    };
  }).sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || +new Date(b.lastAt) - +new Date(a.lastAt));
}

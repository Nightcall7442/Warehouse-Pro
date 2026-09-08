import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { supportMessages, tenants, users } from "@db/schema";
import { sseBus } from "../lib/sse";

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
  return (await tenantPlan(tenantId)) === "exclusive";
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

  const result = await getDb().insert(supportMessages).values({
    tenantId: input.tenantId,
    userId: input.userId,
    fromPlatform: input.fromPlatform,
    authorId: input.authorId,
    body,
  });
  const id = Number((result as unknown as { insertId?: number }).insertId ?? 0);

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
    .innerJoin(users, eq(users.id, supportMessages.userId))
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

  return rows.map(r => {
    const p = previews.get(Number(r.lastId));
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
    };
  }).sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || +new Date(b.lastAt) - +new Date(a.lastAt));
}

import { and, eq, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { telegramOutbox, telegramRules, tenants, users } from "@db/schema";
import { sendTelegram } from "../telegram-router";
import { logger } from "../lib/logger";

/* ═══════════════════════════════════════════════════════════════════════════
   Кому уходят уведомления и когда.

   ── Что было ────────────────────────────────────────────────────────────────

   notifyUserById и notifyTenantRole не вызывались НИОТКУДА. Человек привязывал
   Telegram в настройках, видел «успешно подключено» — и не получал ни одного
   сообщения за всё время. Единственным, кто что-то получал, был владелец
   платформы: notifyAdmin звался из биллинга и мониторинга.

   ── Умолчания важнее таблицы ────────────────────────────────────────────────

   Правила в базе — это ПЕРЕОПРЕДЕЛЕНИЯ. Если считать источником только их, у
   новой организации не будет ни одной строки, и уведомления окажутся выключены
   там, где их никто не выключал. Именно так в этом проекте уже умирали
   возможности. Поэтому пусто значит «как задумано ниже», а строка появляется
   только когда директор что-то изменил.
   ═══════════════════════════════════════════════════════════════════════════ */

export type NotifyEvent = "order.created" | "stock.low" | "debt.overdue" | "delivery.assigned";
type Role = "ceo" | "operator" | "supervisor" | "agent" | "merchandiser" | "courier";

/**
 * Кому что уходит, если директор ничего не менял.
 *
 * Выбрано по тому, кто ДЕЙСТВУЕТ по этому событию, а не кому интересно:
 * лишний адресат превращает уведомления в шум, а шум выключают целиком.
 */
export const DEFAULT_RULES: Record<NotifyEvent, Role[]> = {
  "order.created":      ["ceo", "operator"],
  "stock.low":          ["ceo", "operator"],
  "debt.overdue":       ["ceo", "agent"],
  "delivery.assigned":  ["courier"],
};

/** Ночь по Ташкенту: в это время сообщения копятся, а не будят. */
export const QUIET_FROM = 22;
export const QUIET_TO = 8;
const TASHKENT_OFFSET_MS = 5 * 3600 * 1000;

/** Час по Ташкенту для момента времени. */
export function tashkentHour(at: Date): number {
  return new Date(at.getTime() + TASHKENT_OFFSET_MS).getUTCHours();
}

export function isQuiet(at: Date): boolean {
  const h = tashkentHour(at);
  return h >= QUIET_FROM || h < QUIET_TO;
}

/**
 * Когда можно отправить то, что пришло в тихий час.
 *
 * Ровно восемь утра по Ташкенту ближайшего дня. Не «через N часов»: иначе
 * сообщения, пришедшие в разное время ночи, растянулись бы очередью по утру.
 */
export function nextQuietEnd(at: Date): Date {
  const local = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const morning = new Date(Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), QUIET_TO, 0, 0, 0,
  ));
  // До восьми утра — сегодня; после двадцати двух — завтра.
  if (local.getUTCHours() >= QUIET_FROM) morning.setUTCDate(morning.getUTCDate() + 1);
  return new Date(morning.getTime() - TASHKENT_OFFSET_MS);
}

/** Роли, которым это событие уходит в этой организации. */
export async function recipientRoles(tenantId: number, event: NotifyEvent): Promise<Role[]> {
  const overrides = await getDb()
    .select({ role: telegramRules.role, enabled: telegramRules.enabled })
    .from(telegramRules)
    .where(and(eq(telegramRules.tenantId, tenantId), eq(telegramRules.event, event)));

  const decided = new Map(overrides.map(o => [o.role as Role, Boolean(o.enabled)]));
  const roles = new Set<Role>(DEFAULT_RULES[event]);
  for (const [role, enabled] of decided) {
    if (enabled) roles.add(role); else roles.delete(role);
  }
  return [...roles];
}

interface NotifyInput {
  tenantId: number;
  event: NotifyEvent;
  text: string;
  /** Кому именно, если событие адресное: назначенный курьер, агент магазина. */
  onlyUserId?: number;
  now?: Date;
}

/**
 * Разослать событие.
 *
 * Тихой ночью сообщение не теряется и не будит: оно ложится в очередь со
 * временем отправки. Копить в памяти нельзя — выкладка происходит каждый день,
 * и накопленное пропало бы молча.
 */
export async function notifyEvent(input: NotifyInput): Promise<{ sent: number; queued: number }> {
  const db = getDb();
  const now = input.now ?? new Date();

  const [tenant] = await db.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  // Приостановленная организация уведомлений не получает: доступ у неё отобран,
  // и напоминать о заказах некому.
  if (!tenant || tenant.status !== "active") return { sent: 0, queued: 0 };

  const roles = await recipientRoles(input.tenantId, input.event);
  if (roles.length === 0) return { sent: 0, queued: 0 };

  const targets = await db
    .select({ id: users.id, chatId: users.telegramChatId })
    .from(users)
    .where(and(
      eq(users.tenantId, input.tenantId),
      eq(users.status, "active"),
      inArray(users.role, roles),
      isNotNull(users.telegramChatId),
    ));

  const chats = targets
    .filter(u => !input.onlyUserId || u.id === input.onlyUserId)
    .map(u => u.chatId!)
    .filter(Boolean);
  if (chats.length === 0) return { sent: 0, queued: 0 };

  if (isQuiet(now)) {
    const sendAfter = nextQuietEnd(now);
    await db.insert(telegramOutbox).values(
      chats.map(chatId => ({ tenantId: input.tenantId, chatId, body: input.text.slice(0, 3000), sendAfter })),
    );
    return { sent: 0, queued: chats.length };
  }

  const results = await Promise.all(chats.map(chatId => sendTelegram(chatId, input.text)));
  return { sent: results.filter(Boolean).length, queued: 0 };
}

/** Сколько раз пробуем доставить отложенное, прежде чем сдаться. */
const MAX_ATTEMPTS = 3;

/**
 * Отправить то, чему настало время.
 *
 * Вызывается кроном. Неудача не теряется: счётчик попыток растёт, и после
 * третьей сообщение помечается отправленным — чат могли удалить, а вечно
 * повторять значит копить мусор и стучаться в Telegram без конца.
 */
export async function drainOutbox(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const due = await db
    .select({ id: telegramOutbox.id, chatId: telegramOutbox.chatId, body: telegramOutbox.body, attempts: telegramOutbox.attempts })
    .from(telegramOutbox)
    .where(and(isNull(telegramOutbox.sentAt), lte(telegramOutbox.sendAfter, now)))
    .limit(200);

  let sent = 0, failed = 0;
  for (const row of due) {
    const ok = await sendTelegram(row.chatId, row.body);
    if (ok) {
      await db.update(telegramOutbox).set({ sentAt: new Date() }).where(eq(telegramOutbox.id, row.id));
      sent++;
    } else {
      const attempts = Number(row.attempts) + 1;
      await db.update(telegramOutbox)
        .set(attempts >= MAX_ATTEMPTS ? { attempts, sentAt: new Date() } : { attempts })
        .where(eq(telegramOutbox.id, row.id));
      failed++;
      if (attempts >= MAX_ATTEMPTS) {
        logger.warn("telegram: сообщение брошено после трёх попыток", { outboxId: row.id });
      }
    }
  }
  return { sent, failed };
}

/** Сколько отложенного ждёт отправки — для страницы мониторинга. */
export async function outboxPending(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(telegramOutbox)
    .where(isNull(telegramOutbox.sentAt));
  return Number(row?.count ?? 0);
}

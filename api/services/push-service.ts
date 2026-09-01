// Warehouse Pro — Push notification service (Expo)
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import type { User } from "@db/schema";
import { eq, and } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  badge?: number;
}

/** One Expo receipt ticket — the service answers with one per message sent. */
interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
}

/** Expo mirrors the request: one ticket for one message, an array for a batch. */
interface ExpoPushResponse<T extends ExpoPushTicket | ExpoPushTicket[]> {
  data?: T;
}

/**
 * Чем закончилась отправка одного сообщения.
 *
 * Раньше здесь был boolean, и он смешивал два совершенно разных исхода:
 * «устройства больше нет» и «мы не дозвонились до Expo». Оба давали false, а
 * вызывающий на false стирал токен из базы — то есть обрыв связи или авария у
 * Expo насовсем отключали живого человека от уведомлений. Вернуть их он мог
 * только повторным входом в мобильном приложении, и никто ему об этом не
 * сообщал.
 *
 * Цена ошибки здесь несимметрична: оставить мёртвый токен — мелочь, Expo
 * отобьёт его при следующей попытке. Стереть живой — тихо выключить агента из
 * работы. Поэтому исходов три, а удаление привязано ровно к одному.
 */
type PushOutcome =
  /** Ушло. */
  | "delivered"
  /** Expo говорит, что приложения на этом устройстве больше нет. */
  | "gone"
  /** Не дошло, но про устройство это ничего не говорит. */
  | "failed";

async function sendExpoPush(token: string, message: PushMessage): Promise<PushOutcome> {
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: message.sound ?? "default",
        badge: message.badge,
        channelId: "default",
      }),
    });

    const result = await response.json() as ExpoPushResponse<ExpoPushTicket>;
    if (result.data?.status === "error") {
      console.warn("[Push] Expo push error:", result.data.message);
      return result.data.message?.includes("DeviceNotRegistered") ? "gone" : "failed";
    }
    return "delivered";
  } catch (e) {
    // Сюда попадают и обрыв сети, и страница-заглушка вместо JSON при аварии
    // на стороне Expo. Ни то, ни другое не про устройство.
    console.warn("[Push] Failed to send push:", e);
    return "failed";
  }
}

export async function sendPushToUser(userId: number, message: PushMessage): Promise<void> {
  const db = getDb();
  const [user] = await db.select({ pushToken: users.pushToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.pushToken) return;

  // Токен убирается ТОЛЬКО когда Expo прямо сказал, что устройства нет.
  // Пакетная отправка ниже устроена так же — там условие всегда было верным,
  // расходилась с ней только эта ветка.
  if (await sendExpoPush(user.pushToken, message) === "gone") {
    await db.update(users)
      .set({ pushToken: null })
      .where(eq(users.id, userId));
  }
}

export async function sendPushToRole(tenantId: number, role: User["role"], message: PushMessage): Promise<void> {
  const db = getDb();
  const usersList = await db.select({ id: users.id, pushToken: users.pushToken })
    .from(users)
    .where(and(
      eq(users.tenantId, tenantId),
      eq(users.role, role),
      eq(users.status, "active"),
    ));

  const tokens = usersList
    .filter(u => u.pushToken)
    .map(u => ({ id: u.id, token: u.pushToken! }));

  if (tokens.length === 0) return;

  // Use Expo batch API (up to 100 tickets at once)
  const BATCH_SIZE = 100;
  const tickets: Array<{ id: number; status: string; message?: string }> = [];

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          batch.map(t => ({
            to: t.token,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: message.sound ?? "default",
            badge: message.badge,
            channelId: "default",
          }))
        ),
      });
      const result = await response.json() as ExpoPushResponse<ExpoPushTicket[]>;
      if (result.data) {
        tickets.push(...result.data.map((r, idx) => ({
          id: batch[idx].id,
          status: r.status,
          message: r.message,
        })));
      }
    } catch (e) {
      console.warn("[Push] Batch send failed:", e);
    }
  }

  // Clean up invalid tokens
  for (const ticket of tickets) {
    if (ticket.status === "error" && ticket.message?.includes("DeviceNotRegistered")) {
      await db.update(users)
        .set({ pushToken: null })
        .where(eq(users.id, ticket.id));
    }
  }
}

export async function sendPushToTenant(tenantId: number, message: PushMessage): Promise<void> {
  const db = getDb();
  const usersList = await db.select({ id: users.id, pushToken: users.pushToken })
    .from(users)
    .where(and(
      eq(users.tenantId, tenantId),
      eq(users.status, "active"),
    ));

  const tokens = usersList
    .filter(u => u.pushToken)
    .map(u => ({ id: u.id, token: u.pushToken! }));

  if (tokens.length === 0) return;

  // Use Expo batch API (up to 100 tickets at once)
  const BATCH_SIZE = 100;
  const tickets: Array<{ id: number; status: string; message?: string }> = [];

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          batch.map(t => ({
            to: t.token,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: message.sound ?? "default",
            badge: message.badge,
            channelId: "default",
          }))
        ),
      });
      const result = await response.json() as ExpoPushResponse<ExpoPushTicket[]>;
      if (result.data) {
        tickets.push(...result.data.map((r, idx) => ({
          id: batch[idx].id,
          status: r.status,
          message: r.message,
        })));
      }
    } catch (e) {
      console.warn("[Push] Batch send failed:", e);
    }
  }

  // Clean up invalid tokens
  for (const ticket of tickets) {
    if (ticket.status === "error" && ticket.message?.includes("DeviceNotRegistered")) {
      await db.update(users)
        .set({ pushToken: null })
        .where(eq(users.id, ticket.id));
    }
  }
}

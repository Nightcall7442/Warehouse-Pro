// Warehouse Pro — Push notification service (Expo)
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { eq, and } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  badge?: number;
}

async function sendExpoPush(token: string, message: PushMessage): Promise<boolean> {
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

    const result = await response.json();
    if (result.data?.status === "error") {
      console.warn("[Push] Expo push error:", result.data.message);
      // If device not registered, remove the token
      if (result.data.message?.includes("DeviceNotRegistered")) {
        return false; // Signal to remove token
      }
    }
    return true;
  } catch (e) {
    console.warn("[Push] Failed to send push:", e);
    return false;
  }
}

export async function sendPushToUser(userId: number, message: PushMessage): Promise<void> {
  const db = getDb();
  const [user] = await db.select({ pushToken: users.pushToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.pushToken) return;

  const success = await sendExpoPush(user.pushToken, message);
  if (!success) {
    // Token invalid, remove it
    await db.update(users)
      .set({ pushToken: null })
      .where(eq(users.id, userId));
  }
}

export async function sendPushToRole(tenantId: number, role: string, message: PushMessage): Promise<void> {
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
      const result = await response.json();
      if (result.data) {
        tickets.push(...result.data.map((r: { status: string; message?: string }, idx: number) => ({
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
      const result = await response.json();
      if (result.data) {
        tickets.push(...result.data.map((r: { status: string; message?: string }, idx: number) => ({
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

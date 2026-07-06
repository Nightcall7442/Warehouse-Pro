import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { env } from "./lib/env";
import type { Role } from "@contracts/types";

// ── Core send function ───────────────────────────────────────────────────────
async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = env.telegramBotToken;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
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
export const tgMessages = {
  newOrder: (n: string, shop: string, total: string, cur: string) =>
    `🛒 <b>Новый заказ</b>\n📋 ${n}\n🏪 ${shop}\n💰 ${total} ${cur}`,

  lowStock: (name: string, qty: string) =>
    `⚠️ <b>Мало на складе</b>\n📦 ${name}\n📉 Остаток: ${qty} кг`,

  paymentReceived: (shop: string, amount: string, cur: string) =>
    `✅ <b>Оплата получена</b>\n🏪 ${shop}\n💵 ${amount} ${cur}`,

  newRegistration: (org: string, email: string) =>
    `🆕 <b>Новая регистрация</b>\n🏢 ${org}\n📧 ${email}`,

  upgradeRequest: (org: string, plan: string, price: string, contact: string) =>
    `💳 <b>Запрос на апгрейд</b>\n🏢 ${org}\n📈 Тариф: ${plan}\n💰 ${price} сум/мес\n📞 ${contact}`,

  agentPlan: (agent: string, count: number, date: string) =>
    `📅 <b>Ваш план на ${date}</b>\n👤 ${agent}\n🏪 ${count} визитов`,

  orderStatusChange: (n: string, shop: string, status: string) =>
    `📦 <b>Статус заказа изменён</b>\n📋 ${n}\n🏪 ${shop}\n➡️ ${status}`,
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
        `✅ <b>Warehouse Pro</b>\n\nВы успешно подключили Telegram уведомления!\n👤 ${ctx.user.name}`,
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

  /** Get own chat_id status */
  myStatus: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [user] = await db.select({ chatId: users.telegramChatId })
      .from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return { connected: !!user?.chatId, chatId: user?.chatId ?? null };
  }),

  /** Admin: test message to all agents in tenant */
  testBroadcast: adminQuery
    .input(z.object({ message: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await notifyTenantRole(ctx.tenant.id, "agent", input.message);
      return { success: true };
    }),
});

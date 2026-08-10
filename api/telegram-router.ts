import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { env } from "./lib/env";
import { onDay, onDate } from "./lib/date-range";
import type { Role } from "@contracts/types";

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
export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = env.telegramBotToken;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
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

/**
 * Send a file to Telegram chat (up to 50 MB).
 * Used for backup dumps — the admin gets the .sql.gz file directly in Telegram.
 */
export async function sendTelegramDocument(chatId: string, buffer: Buffer, filename: string, caption?: string): Promise<boolean> {
  const token = env.telegramBotToken;
  if (!token || !chatId) return false;
  try {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("document", new Blob([buffer], { type: "application/gzip" }), filename);
    if (caption) form.set("caption", caption);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[telegram] sendDocument ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("[telegram] sendDocument failed:", e instanceof Error ? e.message : String(e));
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

  paymentReceived: (shop: string, amount: string, cur: string) =>
    `✅ <b>Оплата получена</b>\n🏪 ${tgEscape(shop)}\n💵 ${tgEscape(amount)} ${tgEscape(cur)}`,

  newRegistration: (org: string, email: string) =>
    `🆕 <b>Новая регистрация</b>\n🏢 ${tgEscape(org)}\n📧 ${tgEscape(email)}`,

  upgradeRequest: (org: string, plan: string, price: string, contact: string) =>
    `💳 <b>Запрос на апгрейд</b>\n🏢 ${tgEscape(org)}\n📈 Тариф: ${tgEscape(plan)}\n💰 ${tgEscape(price)} сум/мес\n📞 ${tgEscape(contact)}`,

  // count is typed number, and is escaped anyway: "everything interpolated is
  // escaped" is a rule that survives a refactor, "everything except the numeric
  // ones" is a rule someone eventually gets wrong.
  agentPlan: (agent: string, count: number, date: string) =>
    `📅 <b>Ваш план на ${tgEscape(date)}</b>\n👤 ${tgEscape(agent)}\n🏪 ${tgEscape(count)} визитов`,

  orderStatusChange: (n: string, shop: string, status: string) =>
    `📦 <b>Статус заказа изменён</b>\n📋 ${tgEscape(n)}\n🏪 ${tgEscape(shop)}\n➡️ ${tgEscape(status)}`,
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
      // The director types this by hand, not as markup — send the text they
      // actually wrote rather than letting a stray < swallow the broadcast.
      await notifyTenantRole(ctx.tenant.id, "agent", tgEscape(input.message));
      return { success: true };
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

    // Create deep link with user ID as start parameter
    const url = `https://t.me/${botUsername}?start=${ctx.user.id}`;
    return { url, botUsername };
  }),

  /** Daily digest: orders summary, low stock, agent performance */
  dailyDigest: authedQuery.query(async ({ ctx }) => {
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
        .leftJoin(products, eq(warehouseStock.productId, products.id))
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

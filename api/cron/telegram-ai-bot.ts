/**
 * Telegram AI Bot — handles natural language queries about stock, orders, etc.
 *
 * This module processes incoming Telegram messages and responds with data
 * from the warehouse database. It uses simple keyword matching for now,
 * but can be extended with an LLM later.
 *
 * Endpoint: POST /api/webhooks/telegram
 */

import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { products, warehouseStock, orders, orderItems, users, shops } from "@db/schema";
import { eq, and, sql, desc, gte, lte, like } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendTelegram } from "../telegram-router";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();

// ── Keyword patterns for intent detection ──────────────────────────────────────
const INTENTS = {
  stock:     /остатк|склад|товар|наличие|сколько|stock|inventory/i,
  orders:    /заказ|order|выпис/i,
  top:       /топ|лучш|популярн|top|best/i,
  summary:   /сводк|отчёт|summary|report|итог/i,
  help:      /помощь|помог|help|команд|start/i,
};

// ── Intent handler ─────────────────────────────────────────────────────────────
async function handleIntent(
  text: string,
  tenantId: number,
): Promise<string> {
  const db = getDb();
  const lowerText = text.toLowerCase();

  // Help
  if (INTENTS.help.test(lowerText)) {
    return [
      "🤖 <b>Warehouse Pro Bot</b>",
      "",
      "Доступные команды:",
      "• <b>Остатки</b> — остатки товаров на складе",
      "• <b>Заказы</b> — последние заказы",
      "• <b>Топ</b> — топ товаров по продажам",
      "• <b>Сводка</b> — сводка за сегодня",
      "",
      "Или просто спросите на естественном языке:",
      "«сколько помидоров на складе»",
      "«заказы за сегодня»",
      "«что продавали больше всего»",
    ].join("\n");
  }

  // Stock query
  if (INTENTS.stock.test(lowerText)) {
    // Try to find specific product
    const productKeywords = lowerText
      .replace(/остатк|склад|товар|наличие|сколько|stock|inventory/gi, "")
      .trim();

    if (productKeywords.length > 2) {
      // Search for specific product
      const [product] = await db.select({
        name: products.name,
        available: warehouseStock.available,
        currentStock: warehouseStock.currentStock,
      })
        .from(products)
        .innerJoin(warehouseStock, and(
          eq(warehouseStock.productId, products.id),
          eq(warehouseStock.tenantId, tenantId),
        ))
        .where(and(
          eq(products.tenantId, tenantId),
          like(products.name, `%${productKeywords}%`),
        ))
        .limit(5);

      if (product) {
        return [
          `📦 <b>${product.name}</b>`,
          `• На складе: ${product.currentStock ?? 0}`,
          `• Доступно: ${product.available ?? 0}`,
        ].join("\n");
      }

      return `❌ Товар «${productKeywords}» не найден на складе.`;
    }

    // Show all stock summary
    const stock = await db.select({
      name: products.name,
      available: warehouseStock.available,
    })
      .from(products)
      .innerJoin(warehouseStock, and(
        eq(warehouseStock.productId, products.id),
        eq(warehouseStock.tenantId, tenantId),
      ))
      .where(eq(products.tenantId, tenantId))
      .orderBy(desc(warehouseStock.available))
      .limit(10);

    if (stock.length === 0) {
      return "📦 Склад пуст — товаров не найдено.";
    }

    const lines = stock.map((s) =>
      `• ${s.name}: ${s.available ?? 0}`
    );

    return [
      "📦 <b>Товары на складе:</b>",
      ...lines,
      stock.length === 10 ? "... и ещё больше" : "",
    ].filter(Boolean).join("\n");
  }

  // Orders query
  if (INTENTS.orders.test(lowerText)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentOrders = await db.select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      total: orders.total,
      createdAt: orders.createdAt,
      shopName: shops.name,
    })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(
        eq(orders.tenantId, tenantId),
        gte(orders.createdAt, today),
      ))
      .orderBy(desc(orders.createdAt))
      .limit(10);

    if (recentOrders.length === 0) {
      return "📋 Заказов за сегодня нет.";
    }

    const statusEmoji: Record<string, string> = {
      new: "🆕", processing: "⚙️", completed: "✅", cancelled: "❌",
    };

    const lines = recentOrders.map((o) =>
      `${statusEmoji[o.status] ?? "📋"} ${o.orderNumber} — ${o.shopName ?? "—"} — ${o.total} сум`
    );

    return [
      `📋 <b>Заказы за сегодня (${recentOrders.length}):</b>`,
      ...lines,
    ].join("\n");
  }

  // Top products
  if (INTENTS.top.test(lowerText)) {
    const topProducts = await db.select({
      name: products.name,
      totalSold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, "completed"),
      ))
      .groupBy(products.id)
      .orderBy(desc(sql<number>`coalesce(sum(${orderItems.quantity}), 0)`))
      .limit(5);

    if (topProducts.length === 0) {
      return "🏆 Нет данных о продажах.";
    }

    const lines = topProducts.map((p, i) =>
      `${i + 1}. ${p.name} — ${p.totalSold} шт.`
    );

    return [
      "🏆 <b>Топ товаров:</b>",
      ...lines,
    ].join("\n");
  }

  // Daily summary
  if (INTENTS.summary.test(lowerText)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [orderStats] = await db.select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${orders.total}), 0)`,
    })
      .from(orders)
      .where(and(
        eq(orders.tenantId, tenantId),
        gte(orders.createdAt, today),
        eq(orders.status, "completed"),
      ));

    const [productCount] = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(products)
      .where(eq(products.tenantId, tenantId));

    return [
      "📊 <b>Сводка за сегодня:</b>",
      `• Заказов: ${orderStats?.count ?? 0}`,
      `• Выручка: ${(orderStats?.total ?? 0).toLocaleString("ru")} сум`,
      `• Товаров в каталоге: ${productCount?.count ?? 0}`,
    ].join("\n");
  }

  // Default — unknown command
  return [
    "🤔 Не совсем понял вас.",
    "",
    "Попробуйте:",
    "• «остатки» — остатки товаров",
    "• «заказы» — последние заказы",
    "• «топ» — популярные товары",
    "• «сводка» — итоги за сегодня",
    "• «помощь» — список команд",
  ].join("\n");
}

// ── Find user by Telegram chat_id ──────────────────────────────────────────────
async function findUserByChatId(chatId: string): Promise<{ tenantId: number; name: string } | null> {
  const db = getDb();
  const [user] = await db.select({ tenantId: users.tenantId, name: users.name })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);
  return user ?? null;
}

// ── Webhook endpoint ───────────────────────────────────────────────────────────
app.post("/api/webhooks/telegram", async (c) => {
  try {
    const body = await c.req.json();

    // Telegram Bot API format
    const message = body.message;
    if (!message?.text || !message?.chat?.id) {
      return c.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();

    // Find user by chat_id
    const user = await findUserByChatId(chatId);
    if (!user) {
      await sendTelegram(chatId, "❌ Вы не зарегистрированы в Warehouse Pro.\nСвяжите Telegram в настройках приложения.");
      return c.json({ ok: true });
    }

    // Handle intent
    const response = await handleIntent(text, user.tenantId);
    await sendTelegram(chatId, response);

    return c.json({ ok: true });
  } catch (err) {
    logger.error("Telegram bot webhook error", { error: String(err) });
    return c.json({ ok: true }); // Always return 200 to Telegram
  }
});

export default app;
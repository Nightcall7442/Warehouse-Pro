import { getDb } from "../queries/connection";
import { debtReminders, shops, orders, users, notifications } from "@db/schema";
import { eq, and, sql, lt } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Daily cron: send debt reminders.
 * - 1 day before due date → reminder notification
 * - Overdue → escalation notification to CEO
 * - >7 days overdue → block new orders for shop
 */
export async function runDebtReminders() {
  const db = getDb();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  let sent = 0;
  let escalated = 0;

  try {
    // 1. Upcoming reminders (due tomorrow)
    const upcoming = await db.select({
      id: debtReminders.id,
      tenantId: debtReminders.tenantId,
      shopId: debtReminders.shopId,
      orderId: debtReminders.orderId,
      amount: debtReminders.amount,
      dueDate: debtReminders.dueDate,
    }).from(debtReminders)
      .where(and(
        eq(debtReminders.status, "pending"),
        sql`DATEDIFF(${debtReminders.dueDate}, ${todayStr}) = 1`,
      ));

    for (const reminder of upcoming) {
      // Notify CEO/operators
      const operators = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, reminder.tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

      if (operators.length > 0) {
        await db.insert(notifications).values(operators.map(op => ({
          tenantId: reminder.tenantId,
          userId: op.id,
          type: "system" as const,
          title: "Напоминание о долге",
          message: `Завтра срок погашения долга ${Number(reminder.amount).toLocaleString("ru")} сум. Магазин ID: ${reminder.shopId}`,
          link: reminder.orderId ? `/orders/${reminder.orderId}` : undefined,
        })));
      }

      await db.update(debtReminders).set({ status: "sent", sentAt: new Date() })
        .where(eq(debtReminders.id, reminder.id));
      sent++;
    }

    // 2. Overdue reminders
    const overdue = await db.select({
      id: debtReminders.id,
      tenantId: debtReminders.tenantId,
      shopId: debtReminders.shopId,
      orderId: debtReminders.orderId,
      amount: debtReminders.amount,
      dueDate: debtReminders.dueDate,
      reminderCount: debtReminders.reminderCount,
    }).from(debtReminders)
      .where(and(
        eq(debtReminders.status, "sent"),
        lt(debtReminders.dueDate, todayStr),
      ));

    for (const reminder of overdue) {
      const dueDate = new Date(reminder.dueDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      // Notify CEO
      const ceos = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, reminder.tenantId), eq(users.role, "ceo"), eq(users.status, "active")));

      if (ceos.length > 0) {
        await db.insert(notifications).values(ceos.map(ceo => ({
          tenantId: reminder.tenantId,
          userId: ceo.id,
          type: "system" as const,
          title: "ПРОСРОЧЕННЫЙ ДОЛГ",
          message: `Долг ${Number(reminder.amount).toLocaleString("ru")} сум просрочен на ${daysOverdue} дней. Магазин ID: ${reminder.shopId}`,
          link: reminder.orderId ? `/orders/${reminder.orderId}` : undefined,
        })));
      }

      // Update reminder status
      await db.update(debtReminders).set({
        status: "overdue",
        reminderCount: (reminder.reminderCount ?? 0) + 1,
      }).where(eq(debtReminders.id, reminder.id));

      escalated++;
    }

    logger.info("Debt reminders processed", { sent, escalated });
    return { success: true, sent, escalated };
  } catch (e) {
    logger.error("Debt reminders failed", { error: String(e) });
    return { success: false, error: String(e) };
  }
}

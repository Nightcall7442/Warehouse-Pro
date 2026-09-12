import { getDb } from "../queries/connection";
import { debtReminders, users, shops, orders, payments, returns, settings } from "@db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { NotificationService } from "../services/NotificationService";
import { orderStillOwes } from "../lib/order-status";

type Db = ReturnType<typeof getDb>;

interface Reminder {
  id: number; tenantId: number; shopId: number; orderId: number | null; amount: string;
}

/**
 * Имя магазина и валюта организации — вместо номера строки и слова «сум».
 *
 * В уведомление уходило «Магазин ID: 47»: номер, который нигде не написан и
 * ничего директору не говорит — чтобы понять, о ком речь, надо было лезть в
 * базу. Валюта была вписана словом, хотя организация может вести учёт в
 * любой: у не-узбекского арендатора сумма подписывалась чужими деньгами.
 */
async function namingFor(db: Db, reminders: Reminder[]) {
  const shopIds = [...new Set(reminders.map(r => r.shopId))];
  const tenantIds = [...new Set(reminders.map(r => r.tenantId))];

  const shopRows = shopIds.length === 0 ? [] : await db
    .select({ id: shops.id, name: shops.name })
    .from(shops).where(inArray(shops.id, shopIds));
  const shopName = new Map(shopRows.map(s => [Number(s.id), s.name]));

  const settingRows = tenantIds.length === 0 ? [] : await db
    .select({ tenantId: settings.tenantId, symbol: settings.currencySymbol, position: settings.symbolPosition })
    .from(settings).where(inArray(settings.tenantId, tenantIds));
  const currency = new Map(settingRows.map(s => [Number(s.tenantId), s]));

  return {
    shop: (id: number) => shopName.get(Number(id)) ?? `магазин №${id}`,
    money: (tenantId: number, amount: unknown) => {
      const c = currency.get(Number(tenantId));
      const symbol = c?.symbol ?? "сум";
      const value = Number(amount).toLocaleString("ru");
      return c?.position === "before" ? `${symbol} ${value}` : `${value} ${symbol}`;
    },
  };
}

/**
 * Напоминания, по которым долг уже погашен.
 *
 * Напоминание жило само по себе: строка создавалась при частичной оплате и
 * дальше рассылалась по сроку, что бы ни случилось с заказом. Магазин
 * рассчитался, заказ отменили, заказ удалили как ошибку ввода — «ПРОСРОЧЕННЫЙ
 * ДОЛГ» всё равно приходил директору каждый день.
 *
 * Условие «заказ ещё должен» здесь ровно то же, что в services/shop-debt.ts:
 * живой, не отменённый и не возвращённый, и при этом либо долговой, либо уже
 * доставленный. Похожее, но не совпадающее условие в этой системе уже
 * приводило к расхождениям в деньгах.
 */
async function settledReminderIds(db: Db, reminders: Reminder[]): Promise<Set<number>> {
  const settled = new Set<number>();
  const withOrder = reminders.filter(r => r.orderId != null);
  if (withOrder.length === 0) return settled;

  const orderIds = [...new Set(withOrder.map(r => Number(r.orderId)))];

  const orderRows = await db.select({
    id: orders.id, status: orders.status, total: orders.total,
    paymentMethod: orders.paymentMethod, deletedAt: orders.deletedAt,
  }).from(orders).where(inArray(orders.id, orderIds));
  const byId = new Map(orderRows.map(o => [Number(o.id), o]));

  // Оплаты — обычной выборкой со сложением в JS: строк единицы, зато запрос
  // остаётся в том куске построителя, который умеют служебные заглушки.
  const paymentRows = await db.select({ orderId: payments.orderId, amount: payments.amount })
    .from(payments)
    .where(and(inArray(payments.orderId, orderIds), eq(payments.type, "payment")));
  const paidByOrder = new Map<number, number>();
  for (const p of paymentRows) {
    const key = Number(p.orderId);
    paidByOrder.set(key, (paidByOrder.get(key) ?? 0) + (Number(p.amount) || 0));
  }

  /*
    Проведённые возвраты закрывают долг наравне с деньгами.

    Их здесь не было, и остаток считался как «сумма заказа минус оплаты». Тот,
    кто вместо доплаты ВЕРНУЛ товар, оставался должен навсегда: shops.debt у
    него падал до нуля (пересчёт долга возвраты знает), а напоминание жило
    своей арифметикой и каждый день слало директору «ПРОСРОЧЕННЫЙ ДОЛГ» — и в
    приложение, и в телеграм. Ровно тот случай, ради которого это условие и
    сверяли с services/shop-debt.ts: похожее, но не совпадающее правило.
  */
  const returnRows = await db.select({ orderId: returns.orderId, amount: returns.totalAmount })
    .from(returns)
    .where(and(inArray(returns.orderId, orderIds), eq(returns.status, "completed")));
  const returnedByOrder = new Map<number, number>();
  for (const r of returnRows) {
    const key = Number(r.orderId);
    returnedByOrder.set(key, (returnedByOrder.get(key) ?? 0) + (Number(r.amount) || 0));
  }

  for (const r of withOrder) {
    const key = Number(r.orderId);
    const o = byId.get(key);
    if (!o) { settled.add(r.id); continue; }

    if (reminderSettled(o, paidByOrder.get(key) ?? 0, returnedByOrder.get(key) ?? 0)) {
      settled.add(r.id);
    }
  }
  return settled;
}

/**
 * Закрыто ли напоминание по этому заказу.
 *
 * Вынесено отдельной функцией не ради красоты: решение отправить директору
 * «ПРОСРОЧЕННЫЙ ДОЛГ» — это деньги и репутация, а проверить его внутри крона с
 * поддельной базой почти нечем. Здесь его можно померить числами.
 *
 * Два условия, и оба обязательные:
 *
 *   • заказ ещё должен — то же правило, что в services/shop-debt.ts;
 *   • по нему что-то осталось — сумма минус деньги минус ВЕРНУВШИЙСЯ ТОВАР.
 *
 * Возврат в этой арифметике не участвовал вовсе, и тот, кто вместо доплаты
 * вернул товар, оставался должен навсегда: shops.debt у него падал до нуля, а
 * напоминание жило своей формулой и слало уведомление каждый день.
 */
export function reminderSettled(
  order: Parameters<typeof orderStillOwes>[0] & { total: unknown },
  paid: number,
  returned: number,
): boolean {
  if (!orderStillOwes(order)) return true;
  return Number(order.total) - paid - returned <= 0;
}

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

    /*
      Погашенные напоминания закрываются, а не рассылаются.

      Строка напоминания жила сама по себе: создавалась при частичной
      оплате и дальше рассылалась по сроку, что бы ни случилось с
      заказом. Магазин рассчитался, заказ отменили, заказ удалили как
      ошибку ввода — уведомление всё равно приходило.
    */
    const upcomingSettled = await settledReminderIds(db, upcoming);
    if (upcomingSettled.size > 0) {
      await db.update(debtReminders).set({ status: "paid" })
        .where(inArray(debtReminders.id, [...upcomingSettled]));
    }
    const upcomingLive = upcoming.filter(r => !upcomingSettled.has(r.id));
    const upcomingNames = await namingFor(db, upcomingLive);

    for (const reminder of upcomingLive) {
      // Notify CEO/operators
      const operators = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, reminder.tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

      if (operators.length > 0) {
        await NotificationService.createBulk(db, {
          tenantId: reminder.tenantId,
          userIds: operators.map(op => op.id),
          type: "system",
          title: "Напоминание о долге",
          message: `Завтра срок погашения долга ${upcomingNames.money(reminder.tenantId, reminder.amount)} — ${upcomingNames.shop(reminder.shopId)}`,
          link: reminder.orderId ? `/orders/${reminder.orderId}` : undefined,
        });
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
        sql`${debtReminders.dueDate} < ${todayStr}`,
      ));

    const overdueSettled = await settledReminderIds(db, overdue);
    if (overdueSettled.size > 0) {
      await db.update(debtReminders).set({ status: "paid" })
        .where(inArray(debtReminders.id, [...overdueSettled]));
    }
    const overdueLive = overdue.filter(r => !overdueSettled.has(r.id));
    const overdueNames = await namingFor(db, overdueLive);

    for (const reminder of overdueLive) {
      const dueDate = new Date(reminder.dueDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      // Notify CEO
      const ceos = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, reminder.tenantId), eq(users.role, "ceo"), eq(users.status, "active")));

      if (ceos.length > 0) {
        await NotificationService.createBulk(db, {
          tenantId: reminder.tenantId,
          userIds: ceos.map(ceo => ceo.id),
          type: "system",
          title: "ПРОСРОЧЕННЫЙ ДОЛГ",
          message: `Долг ${overdueNames.money(reminder.tenantId, reminder.amount)} просрочен на ${daysOverdue} дн. — ${overdueNames.shop(reminder.shopId)}`,
          link: reminder.orderId ? `/orders/${reminder.orderId}` : undefined,
        });
      }

      /*
        И в Telegram.

        Уведомление внутри приложения увидит тот, кто в него зайдёт.
        Просроченный долг — повод позвонить сегодня, а не когда-нибудь, и
        человек, который поедет к этому магазину, сидит в телефоне, а не в
        списке уведомлений.
      */
      const { notifyEvent } = await import("../services/telegram-notify");
      const { tgEscape: esc } = await import("../lib/telegram");
      await notifyEvent({
        tenantId: reminder.tenantId,
        event: "debt.overdue",
        text: [
          "<b>Просроченный долг</b>",
          esc(overdueNames.shop(reminder.shopId)),
          esc(overdueNames.money(reminder.tenantId, reminder.amount)),
          `просрочен на ${daysOverdue} дн.`,
        ].join("\n"),
      });

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

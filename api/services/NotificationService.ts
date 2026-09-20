import { notifications, warehouseStock, products, orders, dailyPlans, shops, stockBatches } from "@db/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { affectedRows } from "../lib/db-rows";
import { cache, withCache, CacheKeys, CacheTTL } from "../lib/cache";
import { sseBus } from "../lib/sse";
import { DEBT_NOTIFICATION_THRESHOLD } from "../lib/constants";
import { logger } from "../lib/logger";
import { onDate } from "../lib/date-range";
import { lowStockCondition, onDefaultWarehouse } from "./reorder";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

type NotificationType = "order" | "payment" | "stock" | "system";

/* ═══════════════════════════════════════════════════════════════════════════
   Срок хранения.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Таблица только росла. Ни одна запись никогда не удалялась: уведомление о
   заказе, прочитанное год назад, лежало ровно столько же, сколько сегодняшнее.
   Растёт при этом самая шумная таблица в базе — уведомление порождается на
   каждый заказ, каждый низкий остаток и каждое напоминание о долге, причём
   отдельной строкой КАЖДОМУ получателю.

   ── Почему два срока ────────────────────────────────────────────────────────

   Прочитанное своё дело сделало: его держим месяц — на случай «а что там было
   на той неделе». Непрочитанное — незакрытое дело, и стирать его через месяц
   значит решить за человека, что оно неважно; ему три месяца. Дольше не нужно:
   уведомление, не прочитанное за три месяца, не прочитают никогда, а висящий
   счётчик перестают замечать вовсе.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько живёт прочитанное уведомление. */
export const READ_RETENTION_DAYS = 30;

/** Сколько живёт непрочитанное. */
export const UNREAD_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

/*
  Текст уведомления — на обоих языках интерфейса.

  До 20.09.2026 сервер записывал одну русскую строку в момент события, и в
  узбекском интерфейсе «Магазин оплатил 850 000 сум» оставалось последней
  русской надписью. Теперь событие приходит парой { ru, uz }: русский — в
  title/message (их читает и мобилка, и старые записи), узбекский — рядом, и
  экран выбирает по языку. Одна строка без пары допустима только у служебного
  (мониторинг суперадмина остаётся русским по решению владельца).
*/
export type NotificationText = string | { ru: string; uz: string };
const textRu = (t: NotificationText | undefined) => (t == null ? null : typeof t === "string" ? t : t.ru);
const textUz = (t: NotificationText | undefined) => (t == null || typeof t === "string" ? null : t.uz);

export interface NotificationRow {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
  titleUz: string | null;
  messageUz: string | null;
  isRead: boolean;
  link: string | null;
  createdAt: Date;
}

export const NotificationService = {
  /**
   * Create a notification and emit SSE event for real-time push.
   * Fire-and-forget — errors don't block the caller.
   */
  async create(
    db: Db,
    opts: {
      tenantId: number;
      userId: number;
      type: NotificationType;
      title: NotificationText;
      message?: NotificationText;
      link?: string;
    },
  ): Promise<void> {
    try {
      const [result] = await db.insert(notifications).values({
        tenantId: opts.tenantId,
        userId: opts.userId,
        type: opts.type,
        title: textRu(opts.title)!,
        message: textRu(opts.message),
        titleUz: textUz(opts.title),
        messageUz: textUz(opts.message),
        link: opts.link ?? null,
      });

      // Emit SSE for real-time push
      sseBus.emit({
        type: "notification.new",
        tenantId: opts.tenantId,
        userId: opts.userId,
        data: {
          id: Number(result.insertId),
          type: opts.type,
          title: textRu(opts.title),
          message: textRu(opts.message) ?? undefined,
          titleUz: textUz(opts.title),
          messageUz: textUz(opts.message),
          link: opts.link,
        },
      });

      // Invalidate unread count cache
      cache.invalidatePrefix(`notif_unread:${opts.tenantId}:${opts.userId}`);
    } catch (err) {
      logger.error("Failed to create notification", { error: String(err), type: opts.type });
    }
  },

  /**
   * Notify multiple users in a tenant (e.g., all operators about a new order).
   * Uses a single batch insert instead of N sequential calls.
   */
  async createBulk(
    db: Db,
    opts: {
      tenantId: number;
      userIds: number[];
      type: NotificationType;
      title: NotificationText;
      message?: NotificationText;
      link?: string;
    },
  ): Promise<void> {
    if (opts.userIds.length === 0) return;

    try {
      const now = new Date();
      await db.insert(notifications).values(
        opts.userIds.map((userId) => ({
          tenantId: opts.tenantId,
          userId,
          type: opts.type,
          title: textRu(opts.title)!,
          message: textRu(opts.message),
          titleUz: textUz(opts.title),
          messageUz: textUz(opts.message),
          link: opts.link ?? null,
          createdAt: now,
        })),
      );

      // Emit SSE for each user (can't batch SSE)
      for (const userId of opts.userIds) {
        sseBus.emit({
          type: "notification.new",
          tenantId: opts.tenantId,
          userId,
          data: {
            type: opts.type,
            title: textRu(opts.title),
            message: textRu(opts.message) ?? undefined,
            titleUz: textUz(opts.title),
            messageUz: textUz(opts.message),
            link: opts.link,
          },
        });

        // Invalidate unread count cache per user
        cache.invalidatePrefix(`notif_unread:${opts.tenantId}:${userId}`);
      }
    } catch (err) {
      logger.error("Failed to create bulk notifications", { error: String(err), type: opts.type });
    }
  },

  /**
   * Лента уведомлений.
   *
   * ── Отбор считает база, а не экран ──────────────────────────────────────────
   *
   * Раньше страница брала первые пятьдесят записей и фильтровала их у себя. На
   * ленте, где заказов много, а платежей мало, это давало прямую ложь: вкладка
   * «Платежи» показывала «нет уведомлений в этой категории», хотя они были —
   * просто не попали в первые пятьдесят.
   *
   * ── Листание по ключу, а не по смещению ────────────────────────────────────
   *
   * `before` — идентификатор самой старой показанной записи. Смещением листать
   * нельзя: пока человек читает, приходят новые уведомления, всё съезжает на
   * позицию вниз, и «следующие пятьдесят» повторяют уже показанное.
   */
  async list(db: Db, tenantId: number, userId: number, opts?: {
    type?: NotificationType;
    unreadOnly?: boolean;
    before?: number;
    limit?: number;
  }): Promise<{ items: NotificationRow[]; hasMore: boolean }> {
    const limit = Math.min(opts?.limit ?? 30, 100);

    const rows = await db.select({
      id: notifications.id, type: notifications.type, title: notifications.title,
      message: notifications.message, titleUz: notifications.titleUz, messageUz: notifications.messageUz, isRead: notifications.isRead,
      link: notifications.link, createdAt: notifications.createdAt,
    }).from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        ...(opts?.type ? [eq(notifications.type, opts.type)] : []),
        ...(opts?.unreadOnly ? [eq(notifications.isRead, false)] : []),
        ...(opts?.before ? [lt(notifications.id, opts.before)] : []),
      ))
      // По идентификатору, а не по времени: две записи одной пачки (уведомление
      // всем операторам разом) имеют одинаковый createdAt, и порядок между ними
      // был бы произвольным — на границе страницы это теряет запись.
      .orderBy(desc(notifications.id))
      .limit(limit + 1);

    return { items: rows.slice(0, limit) as NotificationRow[], hasMore: rows.length > limit };
  },

  /**
   * Сколько непрочитанного и какого рода.
   *
   * Нужно вкладкам: пустая вкладка без числа не отличается от вкладки, где
   * ничего не ждёт, — а разница как раз в том, куда идти первым делом.
   */
  async counts(db: Db, tenantId: number, userId: number): Promise<{ unread: number; byType: Record<NotificationType, number> }> {
    const rows = await db.select({
      type: notifications.type,
      count: sql<number>`count(*)`,
    }).from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.isRead, false),
      ))
      .groupBy(notifications.type);

    const byType: Record<NotificationType, number> = { order: 0, payment: 0, stock: 0, system: 0 };
    let unread = 0;
    for (const r of rows) {
      const n = Number(r.count ?? 0);
      byType[r.type as NotificationType] = n;
      unread += n;
    }
    return { unread, byType };
  },

  /**
   * Стереть уведомления, которым вышел срок.
   *
   * Двумя запросами, а не одним с `OR`: у условий разные границы, и разбор с
   * `OR` по двум диапазонам одного столбца MySQL всё равно свёл бы к чтению
   * таблицы целиком. Каждый запрос по отдельности ложится на idx_notif_purge.
   */
  async purgeOld(db: Db, now: Date = new Date()): Promise<{ read: number; unread: number }> {
    const olderThan = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const read = await db.delete(notifications).where(and(
      eq(notifications.isRead, true),
      lt(notifications.createdAt, olderThan(READ_RETENTION_DAYS)),
    ));
    const unread = await db.delete(notifications).where(and(
      eq(notifications.isRead, false),
      lt(notifications.createdAt, olderThan(UNREAD_RETENTION_DAYS)),
    ));

    /*
      Счётчик непрочитанного кешируется на тридцать секунд у каждого человека
      отдельно. Кого именно задела уборка, мы не знаем — она идёт по всей
      таблице, — поэтому сбрасываем весь раздел разом. Иначе у тех, чьи старые
      непрочитанные стёрты, значок полминуты показывал бы их.
    */
    cache.invalidatePrefix("notif_unread:");

    return { read: affectedRows(read) ?? 0, unread: affectedRows(unread) ?? 0 };
  },

  async unreadCount(db: Db, tenantId: number, userId: number): Promise<number> {
    const cacheKey = `notif_unread:${tenantId}:${userId}`;
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.isRead, false),
      ));
    const count = Number(result?.count ?? 0);
    cache.set(cacheKey, count, 30_000); // 30s cache
    return count;
  },

  async markRead(db: Db, tenantId: number, notificationId: number, userId: number) {
    await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), eq(notifications.tenantId, tenantId)));

    cache.invalidatePrefix(`notif_unread:${tenantId}:${userId}`);

    sseBus.emit({
      type: "notification.new",
      tenantId,
      userId,
      data: { notificationId, action: "read" },
    });

    return { success: true };
  },

  async markAllRead(db: Db, tenantId: number, userId: number) {
    await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.tenantId, tenantId)));

    cache.invalidatePrefix(`notif_unread:${tenantId}:${userId}`);

    sseBus.emit({
      type: "notification.new",
      tenantId,
      userId,
      data: { action: "read_all" },
    });

    return { success: true };
  },

  async getSmartAlerts(db: Db, tenantId: number, userId: number, lang: "ru" | "uz" = "ru") {
    const cacheKey = CacheKeys.smartAlerts(tenantId, userId, lang);
    // Подсказки — экран, не бумага: строятся на языке интерфейса, который
    // прислал клиент. Кэш — по языку, иначе узбекский экран получал бы
    // русские подсказки из кэша русского.
    const T = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
    return withCache(cacheKey, CacheTTL.alerts, async () => {
    const today = new Date().toISOString().split("T")[0];
    const alerts: Array<{ type: string; title: string; message: string; severity: "info" | "warning" | "danger" }> = [];

    const [lowStock, pendingOrders, todayPlans, highDebt, expiring] = await Promise.all([
      db.select({
        productName: products.name,
        available: warehouseStock.available,
        reorderPoint: products.reorderPoint,
      })
        .from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, tenantId)))
        .where(and(eq(warehouseStock.tenantId, tenantId), onDefaultWarehouse(tenantId), lowStockCondition()))
        .limit(5),

      db.select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "new"))),

      db.select({
        total: sql<number>`count(*)`,
        visited: sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
      })
        .from(dailyPlans)
        .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today))),

      db.select({
        shopName: shops.name,
        debt: shops.debt,
      })
        .from(shops)
        .where(and(eq(shops.tenantId, tenantId), sql`${shops.debt} > ${DEBT_NOTIFICATION_THRESHOLD}`))
        .orderBy(desc(sql`CAST(${shops.debt} AS DECIMAL(15,2))`))
        .limit(3),

      /*
        Что сгорает. Сервер это уже считал (warehouseReports.expiringSummary),
        но директор узнавал о просрочке, только дойдя до двенадцатого пункта
        меню и прокрутив. Один из его пяти ежедневных вопросов — без ответа
        на первом экране. Стоимость — по цене партии; где её нет, считаем ноль
        и говорим только число.
      */
      db.select({
        expired: sql<number>`COUNT(CASE WHEN ${stockBatches.expiresAt} < ${today} THEN 1 END)`,
        expiredValue: sql<string>`COALESCE(SUM(CASE WHEN ${stockBatches.expiresAt} < ${today} THEN ${stockBatches.quantity} * COALESCE(${stockBatches.costPrice}, 0) ELSE 0 END), 0)`,
        urgent: sql<number>`COUNT(CASE WHEN ${stockBatches.expiresAt} >= ${today} AND DATEDIFF(${stockBatches.expiresAt}, ${today}) <= 7 THEN 1 END)`,
      })
        .from(stockBatches)
        .where(and(eq(stockBatches.tenantId, tenantId), sql`${stockBatches.quantity} > 0`, sql`${stockBatches.expiresAt} IS NOT NULL`)),
    ]);

    const exp = expiring[0];
    const expiredN = Number(exp?.expired ?? 0), urgentN = Number(exp?.urgent ?? 0), expiredValue = Number(exp?.expiredValue ?? 0);
    if (expiredN > 0) {
      alerts.push({
        type: "expired_stock",
        title: T(`Просрочено партий: ${expiredN}`, `Muddati o'tgan partiyalar: ${expiredN}`),
        message: expiredValue > 0
          ? T(`На ${expiredValue.toLocaleString("ru")} по себестоимости — списать`, `Tannarx bo'yicha ${expiredValue.toLocaleString("ru")} — hisobdan chiqarish`)
          : T("Списать, в отгрузку не уйдут", "Hisobdan chiqarish, jo'natishga chiqmaydi"),
        severity: "danger",
      });
    } else if (urgentN > 0) {
      alerts.push({
        type: "expiring_stock",
        title: T(`Сгорает за неделю: ${urgentN} парт.`, `Bir haftada tugaydi: ${urgentN} partiya`),
        message: T("Продать первыми — FEFO уже отдаёт их первыми", "Birinchi sotish — FEFO ularni birinchi beradi"),
        severity: "warning",
      });
    }

    lowStock.forEach(s => {
      alerts.push({
        type: "low_stock",
        title: T(`Низкий остаток: ${s.productName}`, `Kam qoldiq: ${s.productName}`),
        message: T(`Осталось ${Number(s.available ?? 0).toFixed(1)} (порог: ${Number(s.reorderPoint ?? 0).toFixed(0)})`, `Qoldi ${Number(s.available ?? 0).toFixed(1)} (chegara: ${Number(s.reorderPoint ?? 0).toFixed(0)})`),
        severity: "warning",
      });
    });

    const pendingCount = Number(pendingOrders[0]?.count ?? 0);
    if (pendingCount > 0) {
      alerts.push({
        type: "pending_orders",
        title: T(`${pendingCount} новых заказов`, `${pendingCount} ta yangi buyurtma`),
        message: T("Ожидают обработки", "Ishlov berishni kutmoqda"),
        severity: "info",
      });
    }

    const planData = todayPlans[0];
    if (planData && Number(planData.total) > 0) {
      const pct = Math.round((Number(planData.visited) / Number(planData.total)) * 100);
      alerts.push({
        type: "plan_summary",
        title: T(`План: ${planData.visited}/${planData.total} (${pct}%)`, `Reja: ${planData.visited}/${planData.total} (${pct}%)`),
        message: pct === 100
          ? T("Все визиты выполнены!", "Barcha tashriflar bajarildi!")
          : T(`${Number(planData.total) - Number(planData.visited)} визитов осталось`, `${Number(planData.total) - Number(planData.visited)} ta tashrif qoldi`),
        severity: pct === 100 ? "info" : pct >= 50 ? "warning" : "danger",
      });
    }

    highDebt.forEach(s => {
      alerts.push({
        type: "high_debt",
        title: T(`Долг: ${s.shopName}`, `Qarz: ${s.shopName}`),
        message: `${Number(s.debt ?? 0).toLocaleString("ru")} ${T("сум", "so'm")}`,
        severity: "danger",
      });
    });

    return alerts;
    });
  },
};

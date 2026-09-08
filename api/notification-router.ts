import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { NotificationService } from "./services/NotificationService";

/* ═══════════════════════════════════════════════════════════════════════════
   Уведомления.

   ── Отбор и листание — на сервере ───────────────────────────────────────────

   Ручка отдавала первые пятьдесят записей без разбора, а страница фильтровала
   их у себя. На ленте, где заказов много, а платежей мало, вкладка «Платежи»
   честно писала «нет уведомлений в этой категории» — при том что они были,
   просто не попали в первые пятьдесят. Отбор, который делает не тот, кто
   владеет данными, всегда врёт на границе страницы.
   ═══════════════════════════════════════════════════════════════════════════ */

const TYPES = ["order", "payment", "stock", "system"] as const;

export const notificationRouter = createRouter({
  list: authedQuery
    .input(z.object({
      type: z.enum(TYPES).optional(),
      unreadOnly: z.boolean().optional(),
      /*
        Идентификатор самой старой показанной записи — листание вглубь. Имя
        `cursor` не случайно: по нему useInfiniteQuery на клиенте сам
        подставляет продолжение, и своя механика листания не нужна.
      */
      cursor: z.number().int().positive().nullish(),
      limit: z.number().int().min(1).max(100).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return NotificationService.list(ctx.db, ctx.tenant.id, ctx.user.id, {
        type: input?.type,
        unreadOnly: input?.unreadOnly,
        before: input?.cursor ?? undefined,
        limit: input?.limit,
      });
    }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const count = await NotificationService.unreadCount(ctx.db, ctx.tenant.id, ctx.user.id);
    return { count };
  }),

  /** Непрочитанное по видам — для вкладок. */
  counts: authedQuery.query(async ({ ctx }) => {
    return NotificationService.counts(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  markRead: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return NotificationService.markRead(ctx.db, ctx.tenant.id, input.id, ctx.user.id);
    }),

  markAllRead: authedQuery.mutation(async ({ ctx }) => {
    return NotificationService.markAllRead(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  smartAlerts: authedQuery.query(async ({ ctx }) => {
    return NotificationService.getSmartAlerts(ctx.db, ctx.tenant.id, ctx.user.id);
  }),
});

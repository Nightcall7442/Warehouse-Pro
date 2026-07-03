import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { NotificationService } from "./services/NotificationService";

export const notificationRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return NotificationService.list(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const count = await NotificationService.unreadCount(ctx.db, ctx.tenant.id, ctx.user.id);
    return { count };
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

import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { NotificationService } from "./services/NotificationService";

export const notificationRouter = createRouter({
  list: authedQuery
    .input(z.object({ page: z.number().default(1), pageSize: z.number().default(50) }).optional())
    .query(async ({ input, ctx }) => {
      const page = input?.page ?? 1;
      const pageSize = Math.min(input?.pageSize ?? 50, 100);
      return NotificationService.list(ctx.db, ctx.tenant.id, ctx.user.id, { page, pageSize });
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

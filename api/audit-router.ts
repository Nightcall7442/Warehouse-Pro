import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { getAuditLog } from "./services/audit-log";

export const auditRouter = createRouter({
  list: adminQuery
    .input(z.object({
      action: z.string().optional(),
      limit:  z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      since:  z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return getAuditLog(ctx.db, ctx.tenant.id, {
        action: input?.action,
        limit: input?.limit,
        offset: input?.offset,
        since: input?.since ? new Date(input.since) : undefined,
      });
    }),
});

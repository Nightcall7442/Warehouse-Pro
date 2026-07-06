import { z } from "zod";
import { createRouter, adminQuery, superAdminQuery } from "./middleware";
import { getAuditLog, exportAuditCsv, purgeOldAuditLogs } from "./services/audit-log";

export const auditRouter = createRouter({
  /** List audit log entries with extended filters */
  list: adminQuery
    .input(z.object({
      action:   z.string().optional(),
      actorId:  z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
      limit:    z.number().int().min(1).max(500).default(100),
      offset:   z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      return getAuditLog(ctx.db, ctx.tenant.id, input);
    }),

  /** Export audit log as CSV */
  exportCsv: adminQuery
    .input(z.object({
      action:   z.string().optional(),
      actorId:  z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { data } = await getAuditLog(ctx.db, ctx.tenant.id, {
        ...input,
        limit: 10000,
        offset: 0,
      });
      return { csv: exportAuditCsv(data), rows: data.length };
    }),

  /** Purge audit logs older than retention days (superadmin only) */
  purge: superAdminQuery
    .input(z.object({
      tenantId:      z.number(),
      retentionDays: z.number().int().min(7).max(3650).default(90),
    }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await purgeOldAuditLogs(ctx.db, input.tenantId, input.retentionDays);
      return { deleted, retentionDays: input.retentionDays };
    }),
});

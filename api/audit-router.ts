import { z } from "zod";
import { createRouter, auditQuery, superAdminQuery } from "./middleware";
import { getAuditLog, exportAuditCsv, purgeOldAuditLogs } from "./services/audit-log";
import { checkTotpStepUp } from "./auth/step-up";
import { TRPCError } from "@trpc/server";
import { recordAudit, auditActor } from "./services/audit-log";

export const auditRouter = createRouter({
  /** List audit log entries with extended filters */
  list: auditQuery
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
  exportCsv: auditQuery
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
      totpCode:      z.string().min(1, "Введите код из приложения-аутентификатора"),
    }))
    .mutation(async ({ input, ctx }) => {
      /*
        Журнал и есть бумага, по которой разбирают спор; стереть его — то же
        необратимое действие, что выгрузить дамп или удалить организацию.
        Код второго фактора здесь и сейчас, украденной куки мало.
      */
      const step = await checkTotpStepUp(ctx.db, ctx.user.id, input.totpCode);
      if (!step.ok) throw new TRPCError({ code: step.code === "TOTP_NOT_ENROLLED" ? "FORBIDDEN" : "UNAUTHORIZED", message: step.message });
      const deleted = await purgeOldAuditLogs(ctx.db, input.tenantId, input.retentionDays);
      await recordAudit(ctx.db, { ...auditActor(ctx), action: "audit.purged", targetType: "tenant", targetId: input.tenantId, meta: { retentionDays: input.retentionDays, deleted } });
      return { deleted, retentionDays: input.retentionDays };
    }),
});

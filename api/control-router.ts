import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { ControlService, assertControl, planAllowsControl } from "./services/control";
import { badRequest } from "./lib/errors";

/*
  Контроль — рабочее место директора: индекс риска по сотрудникам и спорные
  доставки. Всё — директор. Слово магазина сюда не входит: оно даётся с
  публичной страницы чека без сессии (boot.ts: /r/:token/word).
*/
const period = z.object({ from: z.string().datetime(), to: z.string().datetime() });

export const controlRouter = createRouter({
  status: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select({ on: settings.controlEnabled }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    return { enabled: Boolean(row?.on), planAllows: planAllowsControl(ctx.tenant.plan) };
  }),

  setEnabled: adminQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.enabled && !planAllowsControl(ctx.tenant.plan)) throw badRequest("Контроль доступен на тарифах Pro и Exclusive");
      await getDb().update(settings).set({ controlEnabled: input.enabled }).where(eq(settings.tenantId, ctx.tenant.id));
      const { recordAudit } = await import("./services/audit-log");
      await recordAudit(getDb(), { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: input.enabled ? "control.enabled" : "control.disabled", targetType: "settings", targetId: ctx.tenant.id, meta: {} });
      return { ok: true };
    }),

  overview: adminQuery
    .input(period)
    .query(async ({ input, ctx }) => {
      await assertControl(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return ControlService.overview(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to) });
    }),

  disputes: adminQuery
    .input(period)
    .query(async ({ input, ctx }) => {
      await assertControl(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return ControlService.disputes(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to) });
    }),
});

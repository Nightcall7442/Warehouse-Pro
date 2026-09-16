import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { VanService, assertVanSelling, planAllowsVan } from "./services/van";
import { badRequest } from "./lib/errors";

/*
  Ван-селлинг.

  Машины заводит директор. Грузит и разгружает кладовщик — оператор с правом
  «warehouse.adjust», тем же, что даёт перемещения. Пересчёт — он же.
  Продаёт с машины её водитель (курьер или агент) или кассир за него.
  Всё под тумблером в настройках и тарифом Pro/Exclusive.
*/
const qty = z.number().positive().max(1e6);
const items = z.array(z.object({ productId: z.number().int().positive(), quantity: qty })).min(1).max(300);
const actorOf = (ctx: { user: { id: number; name: string; role: string } }) => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.user.role });
const stockQuery = operatorQuery.use(can("warehouse.adjust"));

export const vanRouter = createRouter({
  /** Тумблер и тариф — для настроек и для меню: что показывать. */
  status: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select({ on: settings.vanSellingEnabled }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    return { enabled: Boolean(row?.on), planAllows: planAllowsVan(ctx.tenant.plan) };
  }),

  setEnabled: adminQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.enabled && !planAllowsVan(ctx.tenant.plan)) throw badRequest("Ван-селлинг доступен на тарифах Pro и Exclusive");
      await getDb().update(settings).set({ vanSellingEnabled: input.enabled }).where(eq(settings.tenantId, ctx.tenant.id));
      const { recordAudit } = await import("./services/audit-log");
      await recordAudit(getDb(), { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: input.enabled ? "van.enabled" : "van.disabled", targetType: "settings", targetId: ctx.tenant.id, meta: {} });
      return { ok: true };
    }),

  /** Машины: директору и кассиру — все, водителю — свои. */
  list: authedQuery.query(({ ctx }) => {
    const mine = ctx.user.role === "courier" || ctx.user.role === "agent" || ctx.user.role === "supervisor";
    return VanService.list(getDb(), ctx.tenant.id, mine ? ctx.user.id : undefined);
  }),

  save: adminQuery
    .input(z.object({ id: z.number().int().positive().optional(), name: z.string().min(1).max(255), plate: z.string().max(20).optional().nullable(), driverId: z.number().int().positive().optional().nullable(), status: z.enum(["active", "inactive"]).optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!planAllowsVan(ctx.tenant.plan)) throw badRequest("Ван-селлинг доступен на тарифах Pro и Exclusive");
      return VanService.save(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  stock: authedQuery
    .input(z.object({ vanId: z.number().int().positive() }))
    .query(({ input, ctx }) => VanService.stock(getDb(), ctx.tenant.id, input.vanId)),

  load: stockQuery
    .input(z.object({ vanId: z.number().int().positive(), items, pin: z.string().regex(/^\d{4,6}$/).optional(), paperSigned: z.boolean().optional(), note: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertVanSelling(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return VanService.load(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  unload: stockQuery
    .input(z.object({ vanId: z.number().int().positive(), items, note: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertVanSelling(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return VanService.unload(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  count: stockQuery
    .input(z.object({ vanId: z.number().int().positive(), counted: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().min(0).max(1e6) })).min(1).max(300), note: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertVanSelling(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return VanService.count(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  /** Продажа с колёс: водитель — сам, кассир — за него. */
  sale: authedQuery
    .input(z.object({
      vanId: z.number().int().positive(), shopId: z.number().int().positive(),
      items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.string().regex(/^\d+(\.\d{1,2})?$/) })).min(1).max(100),
      paymentMethod: z.enum(["cash", "card", "transfer", "debt"]), paidAmount: z.number().min(0).max(1e12).optional(),
      discount: z.number().min(0).max(100).optional(), notes: z.string().max(500).optional(), idempotencyKey: z.string().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertVanSelling(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return VanService.sale(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  /** Справочник магазинов для продажи с машины — тому, у кого есть машина. */
  shops: authedQuery
    .input(z.object({ search: z.string().max(100).optional() }).optional())
    .query(({ input, ctx }) => VanService.shops(getDb(), ctx.tenant.id, actorOf(ctx), input?.search ?? null)),

  sales: authedQuery
    .input(z.object({ vanId: z.number().int().positive().optional(), from: z.string(), to: z.string() }))
    .query(({ input, ctx }) => VanService.sales(getDb(), ctx.tenant.id, { vanId: input.vanId, from: new Date(input.from), to: new Date(input.to) })),
});

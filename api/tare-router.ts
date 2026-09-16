import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { TareService, assertTare, planAllowsTare } from "./services/tare";
import { badRequest } from "./lib/errors";

/*
  Возвратная тара.

  Виды тары и залог, тара у товара, тумблер — директор. Приём пустой тары
  от магазина — кладовщик (право warehouse.adjust) и водитель со своей
  машины (сервис проверяет). Списание невозвращённой в долг — директор:
  это деньги магазина. Обзор и тара магазина — любой вошедший: агент видит
  долг своего магазина тарой.
*/
const actorOf = (ctx: { user: { id: number; name: string; role: string } }) => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.user.role });
const stockQuery = operatorQuery.use(can("warehouse.adjust"));

export const tareRouter = createRouter({
  status: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select({ on: settings.tareEnabled }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    return { enabled: Boolean(row?.on), planAllows: planAllowsTare(ctx.tenant.plan) };
  }),

  setEnabled: adminQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.enabled && !planAllowsTare(ctx.tenant.plan)) throw badRequest("Учёт тары доступен на тарифах Pro и Exclusive");
      await getDb().update(settings).set({ tareEnabled: input.enabled }).where(eq(settings.tenantId, ctx.tenant.id));
      const { recordAudit } = await import("./services/audit-log");
      await recordAudit(getDb(), { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: input.enabled ? "tare.enabled" : "tare.disabled", targetType: "settings", targetId: ctx.tenant.id, meta: {} });
      return { ok: true };
    }),

  types: authedQuery.query(({ ctx }) => TareService.types(getDb(), ctx.tenant.id)),

  saveType: adminQuery
    .input(z.object({ id: z.number().int().positive().optional(), name: z.string().min(1).max(100), depositPrice: z.number().min(0).max(1e9), isActive: z.boolean().optional() }))
    .mutation(({ input, ctx }) => TareService.saveType(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  setProductTare: operatorQuery.use(can("products.manage"))
    .input(z.object({ productId: z.number().int().positive(), tareTypeId: z.number().int().positive().nullable(), perUnit: z.number().positive().max(1e6).default(1) }))
    .mutation(({ input, ctx }) => TareService.setProductTare(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  overview: authedQuery.query(({ ctx }) => TareService.overview(getDb(), ctx.tenant.id)),

  shop: authedQuery
    .input(z.object({ shopId: z.number().int().positive() }))
    .query(({ input, ctx }) => TareService.shop(getDb(), ctx.tenant.id, input.shopId)),

  /** Пустая тара от магазина — на склад (кладовщик) или на машину (её водитель). */
  returnFromShop: authedQuery
    .input(z.object({ shopId: z.number().int().positive(), warehouseId: z.number().int().positive(), items: z.array(z.object({ tareTypeId: z.number().int().positive(), quantity: z.number().min(0).max(1e6) })).min(1).max(50), note: z.string().max(200).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertTare(getDb(), ctx.tenant.id, ctx.tenant.plan);
      const { warehouses } = await import("@db/schema");
      const { and } = await import("drizzle-orm");
      const [wh] = await getDb().select({ kind: warehouses.kind, driverId: warehouses.driverId }).from(warehouses).where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.tenantId, ctx.tenant.id))).limit(1);
      if (!wh) throw badRequest("Склад не найден");
      const isBoss = ctx.user.role === "ceo" || ctx.user.role === "operator";
      if (!isBoss && !(wh.kind === "van" && wh.driverId === ctx.user.id)) throw badRequest("Принять тару можно на свою машину; на склад — кладовщик");
      return TareService.returnFromShop(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  charge: adminQuery
    .input(z.object({ shopId: z.number().int().positive(), tareTypeId: z.number().int().positive(), quantity: z.number().positive().max(1e6), reason: z.string().min(3).max(300) }))
    .mutation(async ({ input, ctx }) => {
      await assertTare(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return TareService.charge(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  count: stockQuery
    .input(z.object({ warehouseId: z.number().int().positive(), counted: z.array(z.object({ tareTypeId: z.number().int().positive(), quantity: z.number().min(0).max(1e6) })).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      await assertTare(getDb(), ctx.tenant.id, ctx.tenant.plan);
      return TareService.count(getDb(), ctx.tenant.id, actorOf(ctx), input);
    }),

  movements: authedQuery
    .input(z.object({ from: z.string(), to: z.string(), holderKind: z.enum(["warehouse", "shop"]).optional(), holderId: z.number().int().positive().optional() }))
    .query(({ input, ctx }) => TareService.movements(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to), holder: input.holderKind && input.holderId ? { kind: input.holderKind, id: input.holderId } : undefined })),
});

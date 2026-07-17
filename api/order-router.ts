import { z } from "zod";
import { createRouter, operatorQuery, agentQuery } from "./middleware";
import { OrderService } from "./services/order";

export const orderRouter = createRouter({
  list: agentQuery
    .input(z.object({
      page:        z.number().int().min(1).default(1),
      pageSize:    z.number().int().min(1).max(1000).default(25),
      search:      z.string().max(200).optional(),
      status:      z.enum(["new", "processing", "completed", "cancelled"]).optional(),
      agentId:     z.number().int().positive().optional(),
      dateFrom:    z.string().optional(),
      dateTo:      z.string().optional(),
      showDeleted: z.boolean().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return OrderService.list(ctx.db, ctx.tenant.id, input ?? {}, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  getById: agentQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getById(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  myOrders: agentQuery.query(async ({ ctx }) => {
    return OrderService.myOrders(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  create: agentQuery
    .input(z.object({
      shopId:         z.number().int().positive(),
      agentId:        z.number().int().positive().optional(),
      idempotencyKey: z.string().uuid().optional(),
      items:          z.array(z.object({
        productId: z.number().int().positive(),
        quantity:  z.union([z.number(), z.string()]).transform(String),
      })).min(1).max(100),
      notes:          z.string().max(500).optional(),
      discount:       z.union([z.number(), z.string()]).transform(String).default("0.00"),
      paymentMethod:  z.enum(["cash", "card", "transfer", "debt"]).default("cash"),
    }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.create(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  cancel: agentQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.cancel(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  updateStatus: operatorQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "processing", "completed", "cancelled"]) }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.updateStatus(ctx.db, ctx.tenant.id, input.id, input.status);
    }),

  update: operatorQuery
    .input(z.object({
      id: z.number().int().positive(),
      notes: z.string().max(500).optional(),
      discount: z.union([z.number(), z.string()]).transform(String).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      return OrderService.update(ctx.db, ctx.tenant.id, id, data);
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.delete(ctx.db, ctx.tenant.id, input.id);
    }),

  restore: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return OrderService.restore(ctx.db, ctx.tenant.id, input.id);
    }),
});

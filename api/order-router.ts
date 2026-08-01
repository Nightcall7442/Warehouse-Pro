import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery } from "./middleware";
import { isoDaySchema } from "./lib/date-range";
import { decimalString, requiredDecimalString } from "./lib/zod-decimal";
import { extractDbError, stripBoundParams } from "./lib/db-error";
import { OrderService } from "./services/order";

/** Clients send order numbers as either a number or a string; both land on a DECIMAL column. */
const numericInput = z.union([z.number(), z.string()]).transform(String);

export const orderRouter = createRouter({
  list: fieldSalesQuery
    .input(z.object({
      page:        z.number().int().min(1).default(1),
      pageSize:    z.number().int().min(1).max(1000).default(25),
      search:      z.string().max(200).optional(),
      status:      z.enum(["new", "processing", "completed", "cancelled"]).optional(),
      agentId:     z.number().int().positive().optional(),
      dateFrom:    isoDaySchema.optional(),
      dateTo:      isoDaySchema.optional(),
      showDeleted: z.boolean().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return OrderService.list(ctx.db, ctx.tenant.id, input ?? {}, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  getById: fieldSalesQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return OrderService.getById(ctx.db, ctx.tenant.id, input.id, {
        userId:   ctx.user.id,
        userRole: ctx.user.role as string,
      });
    }),

  myOrders: fieldSalesQuery.query(async ({ ctx }) => {
    return OrderService.myOrders(ctx.db, ctx.tenant.id, ctx.user.id);
  }),

  create: fieldSalesQuery
    .input(z.object({
      shopId:         z.number().int().positive(),
      agentId:        z.number().int().positive().optional(),
      warehouseId:    z.number().int().positive().optional(),
      idempotencyKey: z.string().uuid().optional(),
      items:          z.array(z.object({
        productId: z.number().int().positive(),
        quantity:  numericInput.pipe(requiredDecimalString({ message: "Количество обязательно" })),
      })).min(1).max(100),
      notes:          z.string().max(500).optional(),
      discount:       numericInput.optional().pipe(decimalString({ default: "0.00" })),
      paymentMethod:  z.enum(["cash", "card", "transfer", "debt"]).default("cash"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await OrderService.create(ctx.db, ctx.tenant.id, ctx.user.id, input);
      } catch (err) {
        // The driver detail this used to dig out by hand now comes from
        // extractDbError, which walks the whole cause chain and drops the bound
        // parameters. The rethrow reaches the tRPC onError handler, which records
        // the same detail in the error feed.
        console.error("[order.create FAILED]", {
          message: stripBoundParams(err instanceof Error ? err.message : String(err)),
          db: extractDbError(err),
          input: { shopId: input.shopId, itemCount: input.items.length, paymentMethod: input.paymentMethod },
        });
        throw err;
      }
    }),

  cancel: fieldSalesQuery
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
      discount: numericInput.optional().pipe(decimalString()),
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

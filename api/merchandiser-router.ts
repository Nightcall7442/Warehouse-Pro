import { z } from "zod";
import { createRouter, merchQuery, reportsQuery } from "./middleware";
import { MerchandiserService } from "./services/merchandiser";

export const merchandiserRouter = createRouter({
  submitReport: merchQuery
    .input(z.object({
      planId: z.number().int().positive(),
      shopId: z.number().int().positive(),
      photos: z.array(z.string()).default([]),
      checklist: z.array(z.object({
        productId: z.number(),
        productName: z.string(),
        present: z.boolean(),
        price: z.string().optional(),
        promoNote: z.string().optional(),
      })).default([]),
      competitorNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return MerchandiserService.submitReport(ctx.db, ctx.tenant.id, ctx.user.id, input);
    }),

  getReportsByShop: merchQuery
    .input(z.object({
      shopId: z.number().int().positive(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(1000).default(25),
    }))
    .query(async ({ input, ctx }) => {
      return MerchandiserService.getReportsByShop(ctx.db, ctx.tenant.id, input.shopId, {
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  getReportsByDateRange: reportsQuery
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(1000).default(25),
    }))
    .query(async ({ input, ctx }) => {
      return MerchandiserService.getReportsByDateRange(ctx.db, ctx.tenant.id, input.dateFrom, input.dateTo, {
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  getReportById: merchQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return MerchandiserService.getReportById(ctx.db, ctx.tenant.id, input.id);
    }),
});

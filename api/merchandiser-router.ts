import { z } from "zod";
import { isSafePhotoValue, PHOTO_VALUE_ERROR } from "./lib/photo-value";
import { createRouter, merchQuery, reportsQuery } from "./middleware";
import { MerchandiserService } from "./services/merchandiser";

// Снимок отчёта — та же проверка, что у фото визита и магазина: картинка или
// ссылка по https, а не имя файла и не svg (бизнес-аудит 19.11.2026).
const reportPhoto = z.string()
  .refine(v => v.length <= 2_800_000, "Файл слишком большой (макс. 2 МБ)")
  .refine(isSafePhotoValue, PHOTO_VALUE_ERROR);

export const merchandiserRouter = createRouter({
  submitReport: merchQuery
    .input(z.object({
      planId: z.number().int().positive(),
      shopId: z.number().int().positive(),
      photos: z.array(reportPhoto).max(20).default([]),
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

  // Отчёты о визитах по магазину — читают все, кому открыты отчёты
  // (руководитель, оператор, супервайзер, мерчендайзер): блок стоит на
  // карточке магазина, а у оператора приходил отказом (прогон 20.09.2026).
  getReportsByShop: reportsQuery
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

  getReportById: reportsQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return MerchandiserService.getReportById(ctx.db, ctx.tenant.id, input.id);
    }),
});

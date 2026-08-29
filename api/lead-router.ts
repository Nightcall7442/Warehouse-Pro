import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, isNull } from "drizzle-orm";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";
import { sendTelegram } from "./telegram-router";
import { env } from "./lib/env";
import { leads } from "@db/schema";
import { logger } from "./lib/logger";

/**
 * Заявки с лендинга.
 *
 * ── Почему заявка сначала пишется в базу ────────────────────────────────────
 *
 * Форма, которая только отправляет сообщение в телеграм, теряет обращения
 * молча: бот отключили, токен просрочили, чат переименовали — человек видит
 * «спасибо», а к вам ничего не приходит, и узнать об этом неоткуда. Здесь
 * порядок обратный: сначала запись, потом уведомление. Не ушло уведомление —
 * заявка всё равно лежит, и у неё стоит notified = false, по которому её
 * можно найти.
 *
 * ── Почему поля именно такие ────────────────────────────────────────────────
 *
 * Обязательны имя и телефон — всё, что нужно, чтобы перезвонить. Каждое
 * лишнее обязательное поле отсекает часть тех, кто уже был готов оставить
 * контакт. Компания и комментарий необязательны: кто хочет — напишет.
 */

/** Телефон Узбекистана и соседей: цифры, плюс, скобки, дефисы, пробелы. */
const PHONE = /^[+()\d][\d\s()+-]{6,24}$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const leadRouter = createRouter({
  /** Оставить заявку с лендинга. Доступно без входа. */
  create: publicQuery
    .input(z.object({
      name:    z.string().trim().min(2, "Укажите имя").max(120),
      company: z.string().trim().max(200).optional(),
      phone:   z.string().trim().regex(PHONE, "Проверьте номер телефона"),
      comment: z.string().trim().max(2000).optional(),
      source:  z.string().trim().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // По номеру телефона: он единственное, что сервер тут может опознать,
      // и именно его защищают от заваливания одинаковыми заявками.
      const subject = rateLimitSubject(ctx.req, `phone:${input.phone.replace(/\D/g, "")}`);
      if (!(await checkRateLimit(subject, { windowMs: 600_000, limit: 3, namespace: "lead" }))) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Заявка уже отправлена. Мы свяжемся с вами в ближайшее время.",
        });
      }

      const [inserted] = await ctx.db.insert(leads).values({
        name:    input.name,
        company: input.company || null,
        phone:   input.phone,
        comment: input.comment || null,
        source:  input.source || null,
      });
      const id = Number(inserted.insertId);

      // Уведомление — попытка, а не условие успеха. Заявка уже сохранена.
      let notified = false;
      if (env.telegramAdminChatId) {
        const lines = [
          "<b>Новая заявка с сайта</b>",
          `Имя: ${escapeHtml(input.name)}`,
          input.company ? `Компания: ${escapeHtml(input.company)}` : null,
          `Телефон: ${escapeHtml(input.phone)}`,
          input.comment ? `Комментарий: ${escapeHtml(input.comment)}` : null,
          input.source ? `Откуда: ${escapeHtml(input.source)}` : null,
        ].filter(Boolean);
        notified = await sendTelegram(env.telegramAdminChatId, lines.join("\n"));
      }

      if (notified) {
        await ctx.db.update(leads).set({ notified: true }).where(eq(leads.id, id));
      } else {
        // Громко в журнал: заявка есть, но её никто не увидел.
        logger.warn("заявка сохранена, уведомление не ушло", {
          leadId: id,
          telegramConfigured: !!env.telegramAdminChatId,
        });
      }

      return { ok: true };
    }),

  /** Список заявок — для владельца организации. */
  list: adminQuery
    .input(z.object({ onlyNew: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db.select()
        .from(leads)
        .where(input?.onlyNew ? isNull(leads.handledAt) : undefined)
        .orderBy(desc(leads.createdAt))
        .limit(200);
      return rows;
    }),

  /** Отметить заявку разобранной. */
  markHandled: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.update(leads).set({ handledAt: new Date() }).where(eq(leads.id, input.id));
      return { ok: true };
    }),
});

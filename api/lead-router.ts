import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, isNull } from "drizzle-orm";
import { createRouter, publicQuery, superAdminQuery } from "./middleware";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";
import { leads } from "@db/schema";
import { recordLead } from "./services/leads";

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
export const PHONE = /^[+()\d][\d\s()+-]{6,24}$/;

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

      // Порядок «запись → уведомление → отметка» живёт в services/leads.ts:
      // заявка из подписки принимается тем же путём, и второй копии быть не
      // должно — она разошлась бы с этой.
      await recordLead(ctx.db, input);
      return { ok: true };
    }),

  /*
    Разбор заявок — ТОЛЬКО суперадмину.

    Стояло adminQuery, то есть «директор арендатора, суперадмин исключён». Две
    беды разом:

      • у таблицы leads нет организации — это заявки с САЙТА, общие для всей
        платформы. Любой директор любого арендатора мог прочитать двести
        последних: имена, компании, телефоны и комментарии чужих людей,
        оставивших заявку на лендинге;

      • а суперадмин, чей экран и показывает этот разбор (LeadInbox стоит на
        странице Super Admin), получал отказ. То есть заявки копились, и не
        видел их никто.

    Экран был написан, ручка была написана, и ровно между ними лежала эта
    строка.
  */
  list: superAdminQuery
    .input(z.object({ onlyNew: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db.select()
        .from(leads)
        .where(input?.onlyNew ? isNull(leads.handledAt) : undefined)
        .orderBy(desc(leads.createdAt))
        .limit(200);
      return rows;
    }),

  /** Отметить заявку разобранной. Тоже суперадмину — см. разбор выше. */
  markHandled: superAdminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.update(leads).set({ handledAt: new Date() }).where(eq(leads.id, input.id));
      return { ok: true };
    }),
});

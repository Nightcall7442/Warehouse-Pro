import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, isNull } from "drizzle-orm";
import { createRouter, publicQuery, superAdminQuery } from "./middleware";
import { ipOf, recordPlatformAudit } from "./services/platform-audit";
import { checkRateLimit, rateLimitSubject, getClientIp } from "./lib/rate-limit";
import { leads } from "@db/schema";
import { recordLead } from "./services/leads";
import { composeSignupSource } from "@contracts/signup";

/**
 * Метки рекламной ссылки, с которой человек пришёл на сайт (lib/attribution
 * на экране). Всё необязательно, и длинная метка отбрасывается (`catch`), а
 * не отказывает заявке: её человек не видел и исправить не может.
 */
const leadAttribution = z.object({
  utmSource:   z.string().max(200).optional().catch(undefined),
  utmMedium:   z.string().max(200).optional().catch(undefined),
  utmCampaign: z.string().max(200).optional().catch(undefined),
  ref:         z.string().max(200).optional().catch(undefined),
}).optional().catch(undefined);

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
      attribution: leadAttribution,
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
      // И по адресу: меняя цифру номера, аноним писал заявки без счёта и
      // слал по сообщению в Telegram на каждую (аудит 20.09.2026). Адрес
      // известен только за доверенным прокси (TRUSTED_PROXY_COUNT).
      const ip = getClientIp(ctx.req);
      if (ip && !(await checkRateLimit(`ip:${ip}`, { windowMs: 3_600_000, limit: 10, namespace: "lead-ip" }))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Слишком много заявок. Попробуйте позже." });
      }

      // Порядок «запись → уведомление → отметка» живёт в services/leads.ts:
      // заявка из подписки принимается тем же путём, и второй копии быть не
      // должно — она разошлась бы с этой.
      // Метки чистятся и складываются тем же правилом, что у регистрации
      // (contracts/signup): одна строка того же вида в leads.utm и в
      // tenants.signup_source — по ним видно, какая реклама приводит людей.
      const { attribution, ...lead } = input;
      await recordLead(ctx.db, { ...lead, utm: composeSignupSource(attribution) });
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
      await ctx.db.transaction(async (tx) => {
        const [lead] = await tx.select({ name: leads.name, company: leads.company, phone: leads.phone, handledAt: leads.handledAt })
          .from(leads).where(eq(leads.id, input.id)).limit(1);
        await tx.update(leads).set({ handledAt: new Date() }).where(eq(leads.id, input.id));
        if (lead && !lead.handledAt) {
          await recordPlatformAudit(tx, {
            actor: ctx.user, action: "lead.handled", targetType: "lead", targetId: input.id,
            targetLabel: [lead.name, lead.company, lead.phone].filter(Boolean).join(" · "), ip: ipOf(ctx),
          }, { strict: true });
        }
      });
      return { ok: true };
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, superAdminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { PAYMENT_METHODS, PAID_PLANS } from "@contracts/subscription-payment";
import { actionLabel, describePlatformEntry } from "@contracts/platform-journal";
import { ipOf, listPlatformAudit } from "./services/platform-audit";
import { listPayments, paymentsSummary, PaymentPlanClosed, PaymentTenantMissing, recordSubscriptionPayment } from "./services/subscription-payments";
import { activeFor, createAnnouncement, dismiss, endAnnouncement, listAnnouncements } from "./services/announcements";

/* ═══════════════════════════════════════════════════════════════════════════
   Консоль платформы, этап 2: журнал владельца, оплаты подписок, объявления.

   Всё управление — только суперадмину (superAdminQuery). Организациям —
   две ручки объявлений (announcement.active / dismiss): своя организация и
   свой человек берутся из сессии, номер организации с клиента не принимается.
   ═══════════════════════════════════════════════════════════════════════════ */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в виде ГГГГ-ММ-ДД");

export const platformRouter = createRouter({
  /** Журнал действий владельца платформы — вся платформа или одна организация. */
  journal: superAdminQuery
    .input(z.object({
      type:     z.string().max(64).optional(),
      tenantId: z.number().int().positive().optional(),
      days:     z.number().int().min(1).max(3650).optional(),
      q:        z.string().max(100).optional(),
      before:   z.number().int().positive().optional(),
      limit:    z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const page = await listPlatformAudit(getDb(), input ?? {});
      return {
        nextBefore: page.nextBefore,
        rows: page.rows.map(r => ({
          id: r.id, createdAt: r.createdAt, actorName: r.actorName, action: r.action, label: actionLabel(r.action),
          tenantId: r.tenantId, tenantName: r.tenantName, targetLabel: r.targetLabel, ip: r.ip,
          summary: describePlatformEntry(r),
        })),
      };
    }),

  /** Оплаты одной организации (и удалённой — по номеру). */
  payments: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(({ input }) => listPayments(getDb(), input.tenantId)),

  /** «Поступило за месяц» и «MRR по оплатам» для обзора. */
  paymentsSummary: superAdminQuery.query(() => paymentsSummary(getDb())),

  /**
   * Записать оплату и продлить подписку на её период — одним действием.
   *
   * Потолок суммы — от промаха на клавиатуре (лишний ноль), а не от тарифа:
   * за год Эксклюзива со всеми местами выходит несколько десятков миллионов.
   */
  recordPayment: superAdminQuery
    .input(z.object({
      tenantId: z.number().int().positive(),
      amount:   z.number().int("Сумма — целыми сумами").min(1, "Сумма больше нуля").max(1_000_000_000),
      paidAt:   isoDay,
      method:   z.enum(PAYMENT_METHODS),
      plan:     z.enum(PAID_PLANS),
      months:   z.number().int().min(1).max(36),
      note:     z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Оплата «завтрашним числом» — почти всегда опечатка в дате.
      const tomorrow = new Date(Date.now() + 5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
      if (input.paidAt > tomorrow) throw new TRPCError({ code: "BAD_REQUEST", message: "Дата оплаты в будущем" });
      try {
        return await recordSubscriptionPayment(getDb(), input, { id: ctx.user.id, name: ctx.user.name }, ipOf(ctx));
      } catch (e) {
        if (e instanceof PaymentTenantMissing) throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        if (e instanceof PaymentPlanClosed) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
    }),

  /** Объявления — все, с числом закрывших. */
  announcements: superAdminQuery.query(() => listAnnouncements(getDb())),

  createAnnouncement: superAdminQuery
    .input(z.object({
      title:     z.string().trim().min(3, "Заголовок — хотя бы три буквы").max(160),
      body:      z.string().trim().min(1, "Напишите текст").max(2000),
      titleUz:   z.string().trim().max(160).optional(),
      bodyUz:    z.string().trim().max(2000).optional(),
      level:     z.enum(["info", "warning"]),
      audience:  z.enum(["all", "plans", "tenants"]),
      plans:     z.array(z.enum(["trial", "standard", "basic", "pro", "exclusive"])).max(5).optional(),
      tenantIds: z.array(z.number().int().positive()).max(500).optional(),
      startsAt:  z.coerce.date().optional(),
      endsAt:    z.coerce.date().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.audience === "plans" && !input.plans?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Выберите хотя бы один тариф" });
      if (input.audience === "tenants" && !input.tenantIds?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Выберите хотя бы одну организацию" });
      // Узбекский — парой: заголовок без текста показал бы полосу с пустым телом.
      if (Boolean(input.titleUz?.trim()) !== Boolean(input.bodyUz?.trim())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "По-узбекски нужны и заголовок, и текст — или ни того, ни другого" });
      }
      const startsAt = input.startsAt ?? new Date();
      if (input.endsAt && input.endsAt <= startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Конец показа раньше начала" });
      return createAnnouncement(getDb(), { ...input, startsAt }, { id: ctx.user.id, name: ctx.user.name }, ipOf(ctx));
    }),

  endAnnouncement: superAdminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const ok = await endAnnouncement(getDb(), input.id, { id: ctx.user.id, name: ctx.user.name }, ipOf(ctx));
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Объявление не найдено" });
      return { ok };
    }),
});

/** Объявления глазами организации: свои активные и «закрыл». */
export const announcementRouter = createRouter({
  active: authedQuery.query(({ ctx }) =>
    activeFor(getDb(), { userId: ctx.user.id, role: ctx.user.role, tenant: { id: ctx.tenant.id, plan: ctx.tenant.plan } })),

  dismiss: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const ok = await dismiss(getDb(), { userId: ctx.user.id, tenantId: ctx.tenant.id }, input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Объявление не найдено" });
      return { ok };
    }),
});

import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { cashCategories, cashDays, cashDocuments, settings } from "@db/schema";
import { CashService, ensureCategories, DEFAULT_CATEGORIES } from "./services/cash";
import { NonCashService } from "./services/noncash";
import { badRequest } from "./lib/errors";
import { sanitizeString } from "./lib/sanitize";

/*
  Касса.

  Кассир — директор или оператор с правом «Принимать оплату»: он и так
  закрывает заказы деньгами. Списать долг сотрудника, открыть закрытый день,
  выемка и внесение — только директор. Сотрудник (курьер, агент) видит только
  свой кошелёк и заводит себе PIN.
*/
const cashierQuery = operatorQuery.use(can("payments.accept"));
const money = z.number().positive().max(1e12);
const actorOf = (ctx: { user: { id: number; name: string; role: string } }) => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.user.role });

export const cashRouter = createRouter({
  overview: cashierQuery.query(async ({ ctx }) => {
    await ensureCategories(getDb(), ctx.tenant.id);
    return CashService.overview(getDb(), ctx.tenant.id);
  }),

  journal: cashierQuery
    .input(z.object({ from: z.string(), to: z.string(), userId: z.number().int().positive().optional() }))
    .query(({ input, ctx }) => CashService.journal(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to), userId: input.userId })),

  cashBook: cashierQuery
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(({ input, ctx }) => CashService.cashBook(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to) })),

  handover: cashierQuery
    .input(z.object({
      fromUserId: z.number().int().positive(),
      amount: z.number().min(0).max(1e12),
      pin: z.string().regex(/^\d{4,6}$/).optional(),
      paperSigned: z.boolean().optional(),
      denominations: z.record(z.string(), z.number().int().min(0)).optional(),
      note: z.string().max(500).optional(),
    }))
    .mutation(({ input, ctx }) => CashService.handover(getDb(), ctx.tenant.id, actorOf(ctx), {
      ...input, note: input.note ? sanitizeString(input.note) : null, denominations: input.denominations ?? null,
    })),

  expense: cashierQuery
    .input(z.object({ category: z.string().min(1).max(64), amount: money, note: z.string().max(500).optional(), photoUrl: z.string().max(2000).optional() }))
    .mutation(({ input, ctx }) => CashService.expense(getDb(), ctx.tenant.id, actorOf(ctx), { ...input, note: input.note ? sanitizeString(input.note) : null })),

  ownerMove: adminQuery
    .input(z.object({ direction: z.enum(["deposit", "withdrawal"]), amount: money, note: z.string().max(500).optional() }))
    .mutation(({ input, ctx }) => CashService.ownerMove(getDb(), ctx.tenant.id, actorOf(ctx), { ...input, note: input.note ? sanitizeString(input.note) : null })),

  writeOff: adminQuery
    .input(z.object({ userId: z.number().int().positive(), amount: money, reason: z.string().min(3).max(500) }))
    .mutation(({ input, ctx }) => CashService.writeOff(getDb(), ctx.tenant.id, actorOf(ctx), { ...input, reason: sanitizeString(input.reason) })),

  storno: cashierQuery
    .input(z.object({ docId: z.number().int().positive(), reason: z.string().min(3).max(500) }))
    .mutation(({ input, ctx }) => CashService.storno(getDb(), ctx.tenant.id, actorOf(ctx), { ...input, reason: sanitizeString(input.reason) })),

  closeDay: cashierQuery
    .input(z.object({ countedBalance: z.number().min(0).max(1e12) }))
    .mutation(({ input, ctx }) => CashService.closeDay(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  reopenDay: adminQuery
    .input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(({ input, ctx }) => CashService.reopenDay(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  days: cashierQuery
    .input(z.object({ limit: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input, ctx }) => {
      const rows = await getDb().select().from(cashDays).where(eq(cashDays.tenantId, ctx.tenant.id)).limit(input.limit);
      return rows.map(r => ({ ...r, systemBalance: Number(r.systemBalance), countedBalance: Number(r.countedBalance), discrepancy: Number(r.discrepancy) }))
        .sort((a, b) => String(b.day).localeCompare(String(a.day)));
    }),

  categories: cashierQuery.query(async ({ ctx }) => {
    await ensureCategories(getDb(), ctx.tenant.id);
    const rows = await getDb().select().from(cashCategories).where(eq(cashCategories.tenantId, ctx.tenant.id));
    return rows.map(r => ({ ...r, monthlyLimit: r.monthlyLimit != null ? Number(r.monthlyLimit) : null }));
  }),

  saveCategory: adminQuery
    .input(z.object({ code: z.string().regex(/^[a-z0-9_]{2,64}$/), name: z.string().min(1).max(100), monthlyLimit: z.number().min(0).max(1e12).nullable(), isActive: z.boolean().default(true) }))
    .mutation(async ({ input, ctx }) => {
      if (DEFAULT_CATEGORIES.some(c => c.code === input.code) && !input.isActive && input.code === "shortage") throw badRequest("Статья «Списание недостачи» нужна кассе — её нельзя выключить");
      await getDb().insert(cashCategories)
        .values({ tenantId: ctx.tenant.id, code: input.code, name: sanitizeString(input.name), monthlyLimit: input.monthlyLimit != null ? input.monthlyLimit.toFixed(2) : null, isActive: input.isActive })
        .onDuplicateKeyUpdate({ set: { name: sanitizeString(input.name), monthlyLimit: input.monthlyLimit != null ? input.monthlyLimit.toFixed(2) : null, isActive: input.isActive } });
      return { ok: true };
    }),

  settings: cashierQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select({ limit: settings.cashLimit, deadline: settings.cashDeadline, bankDays: settings.bankConfirmDays, startDay: settings.cashStartDay }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    return { limit: Number(row?.limit ?? 5_000_000), deadline: row?.deadline ?? "19:00", bankConfirmDays: Number(row?.bankDays ?? 3), startDay: row?.startDay ?? "2026-09-16" };
  }),

  saveSettings: adminQuery
    .input(z.object({ limit: z.number().min(0).max(1e12), deadline: z.string().regex(/^\d{2}:\d{2}$/), bankConfirmDays: z.number().int().min(1).max(60), startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input, ctx }) => {
      // Сдвигать начало кассы после первого документа нельзя: проводки и закрытые дни перестали бы сходиться.
      const [doc] = await getDb().select({ id: cashDocuments.id }).from(cashDocuments).where(eq(cashDocuments.tenantId, ctx.tenant.id)).limit(1);
      const [cur] = await getDb().select({ startDay: settings.cashStartDay }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
      if (doc && cur && cur.startDay !== input.startDay) throw badRequest("Касса уже ведётся — день начала менять нельзя. Стартовый остаток правится «Внесением» или «Выемкой».");
      await getDb().update(settings).set({ cashLimit: input.limit.toFixed(2), cashDeadline: input.deadline, bankConfirmDays: input.bankConfirmDays, cashStartDay: input.startDay }).where(eq(settings.tenantId, ctx.tenant.id));
      return { ok: true };
    }),

  /* ── Безнал: карта и перевод под выпиской ─────────────────────────────── */
  nonCash: cashierQuery
    .input(z.object({
      from: z.string(), to: z.string(),
      method: z.enum(["card", "transfer"]).optional(),
      status: z.enum(["transit", "overdue", "confirmed", "reversed"]).optional(),
    }))
    .query(({ input, ctx }) => NonCashService.list(getDb(), ctx.tenant.id, { from: new Date(input.from), to: new Date(input.to), method: input.method, status: input.status })),

  nonCashSummary: cashierQuery.query(({ ctx }) => NonCashService.summary(getDb(), ctx.tenant.id)),

  bankConfirm: cashierQuery
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), bankRef: z.string().max(64).optional() }))
    .mutation(({ input, ctx }) => NonCashService.confirm(getDb(), ctx.tenant.id, actorOf(ctx), { ids: input.ids, bankRef: input.bankRef ? sanitizeString(input.bankRef) : null })),

  /** Проверка цепочки документов — кнопка «Проверить целостность» у директора. */
  verify: adminQuery.query(({ ctx }) => CashService.verify(getDb(), ctx.tenant.id)),

  /* ── Свой кошелёк: курьер, агент ─────────────────────────────────────── */
  mine: authedQuery.query(({ ctx }) => CashService.mine(getDb(), ctx.tenant.id, ctx.user.id)),

  setPin: authedQuery
    .input(z.object({ pin: z.string().regex(/^\d{4,6}$/) }))
    .mutation(({ input, ctx }) => CashService.setPin(getDb(), ctx.tenant.id, ctx.user.id, input.pin)),
});

import { and, eq, gte, lt, isNull, inArray, sql, desc, ne } from "drizzle-orm";
import { payments, shops, orders, users, settings } from "@db/schema";
import { badRequest } from "../lib/errors";

/*
  Безнал: карта и перевод под контролем выписки.

  ── Зачем ──────────────────────────────────────────────────────────────────

  Наличные с этой недели проходят через сдачу в кассу: система знает, сколько
  ждать, и недостача становится долгом. У безнала такой двери не было:
  сотрудник отмечал «перевод», долг магазина закрывался, а пришли ли деньги
  на счёт — не видел никто. Отметить чужой долг «переводом» и забрать
  наличные — самая простая кража в полевых продажах.

  ── Как устроено ───────────────────────────────────────────────────────────

  Платёж картой или переводом рождается «в пути». Кассир (тот же, кто
  принимает наличные) сверяет его с выпиской банка и ставит «пришло» — с
  датой, собой и, если есть, номером операции. Дольше settings.bankConfirmDays
  без подтверждения — «просрочен», висит на том, кто записал, и вечером
  уходит директору. Не пришло — сторно, как у любого платежа: долг магазина
  возвращается, а пара строк остаётся в журнале.

  Подтверждать свой же платёж нельзя (кроме директора — деньги его): тот,
  кто записал перевод, не должен быть тем, кто говорит «пришёл». Долг
  магазина от подтверждения не зависит: магазин показал чек — магазин
  заплатил; спор — между фирмой и её сотрудником, а не с магазином.

  Ничего не удаляется и не правится: подтверждение — три поля в строке
  платежа, отмена — сторно. Ledger кассы этого не трогает: там наличные.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Actor = { id: number; name?: string; role: string };

export const NON_CASH = ["card", "transfer"] as const;
export type NonCashMethod = (typeof NON_CASH)[number];
export type NonCashStatus = "transit" | "overdue" | "confirmed" | "reversed";

const round2 = (n: number) => Math.round(n * 100) / 100 + 0;
const DAY_MS = 86_400_000;
const TASHKENT_MS = 5 * 3600 * 1000;
const tashkentDayStart = (now: Date) => new Date(Math.floor((now.getTime() + TASHKENT_MS) / DAY_MS) * DAY_MS - TASHKENT_MS);

/** Состояние платежа. Чистая функция: её и стережёт тест. */
export function nonCashStatus(p: { status: string | null; bankConfirmedAt: Date | null; createdAt: Date }, now: Date, days: number): NonCashStatus {
  if (p.status === "reversed") return "reversed";
  if (p.bankConfirmedAt) return "confirmed";
  return now.getTime() - p.createdAt.getTime() > days * DAY_MS ? "overdue" : "transit";
}

/** Кто вправе поставить «пришло» на этот платёж. Директор может и свой; остальные — только чужой. */
export function canConfirm(actor: Actor, createdBy: number | null): boolean {
  return actor.role === "ceo" || createdBy == null || createdBy !== actor.id;
}

/**
 * Чистый подбор: поступление на счёт ↔ платёж. Тот же контрагент, та же
 * сумма до тийина, поступление не раньше чем за сутки до записи платежа.
 * Одно поступление закрывает один платёж, старшие первыми — два одинаковых
 * перевода от одного магазина разберутся по порядку, а не оба на первый.
 *
 * ponytail: точное совпадение суммы; один перевод за несколько накладных
 * (сумма нескольких платежей) остаётся кассиру вручную.
 */
export function matchReceipts(
  receipts: Array<{ key: string; number: string; date: Date; counterparty: string; sum: number }>,
  pending: Array<{ id: number; counterparty: string; amount: number; createdAt: Date }>,
): Array<{ paymentId: number; key: string; number: string; date: Date }> {
  const free = [...pending].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out: Array<{ paymentId: number; key: string; number: string; date: Date }> = [];
  for (const r of [...receipts].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const i = free.findIndex(p => p.counterparty === r.counterparty && Math.abs(p.amount - r.sum) < 0.005 && r.date.getTime() >= p.createdAt.getTime() - DAY_MS);
    if (i < 0) continue;
    out.push({ paymentId: free[i].id, key: r.key, number: r.number, date: r.date });
    free.splice(i, 1);
  }
  return out;
}

async function confirmDays(db: Db, tenantId: number): Promise<number> {
  const [row] = await db.select({ d: settings.bankConfirmDays }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return Number(row?.d ?? 3);
}

const nonCashWhere = (tenantId: number) => and(
  eq(payments.tenantId, tenantId), eq(payments.type, "payment"),
  inArray(payments.paymentMethod, [...NON_CASH]), isNull(payments.reversalOf),
);

export const NonCashService = {
  /** Список за срок; состояние считается на «сейчас», фильтр по нему — после. */
  async list(db: Db, tenantId: number, input: { from: Date; to: Date; method?: NonCashMethod; status?: NonCashStatus }, now = new Date()) {
    const days = await confirmDays(db, tenantId);
    const rows = await db.select({
      id: payments.id, createdAt: payments.createdAt, method: payments.paymentMethod, amount: payments.amount,
      status: payments.status, notes: payments.notes, createdBy: payments.createdBy,
      bankConfirmedAt: payments.bankConfirmedAt, bankConfirmedBy: payments.bankConfirmedBy, bankRef: payments.bankRef,
      shopId: payments.shopId, shopName: shops.name, orderId: payments.orderId, orderNumber: orders.orderNumber,
    }).from(payments)
      .innerJoin(shops, eq(shops.id, payments.shopId))
      .leftJoin(orders, eq(orders.id, payments.orderId))
      .where(and(nonCashWhere(tenantId), gte(payments.createdAt, input.from), lt(payments.createdAt, input.to),
        ...(input.method ? [eq(payments.paymentMethod, input.method)] : [])))
      .orderBy(desc(payments.id)).limit(1000);
    const ids = [...new Set(rows.flatMap(r => [r.createdBy, r.bankConfirmedBy]).filter((x): x is number => x != null))];
    const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    const nameOf = new Map(names.map(n => [Number(n.id), n.name]));
    const out = rows.map(r => ({
      id: r.id, createdAt: r.createdAt, method: r.method as NonCashMethod, amount: Number(r.amount), notes: r.notes,
      shopId: r.shopId, shopName: r.shopName, orderId: r.orderId, orderNumber: r.orderNumber,
      createdBy: r.createdBy, createdByName: r.createdBy != null ? nameOf.get(Number(r.createdBy)) ?? null : (r.notes?.startsWith("1C:") ? "1С" : null),
      bankConfirmedAt: r.bankConfirmedAt, bankConfirmedByName: r.bankConfirmedBy != null ? nameOf.get(Number(r.bankConfirmedBy)) ?? null : null,
      bankRef: r.bankRef, state: nonCashStatus(r, now, days),
    }));
    const kept = input.status ? out.filter(r => r.state === input.status) : out;
    const sum = (f: (r: typeof out[number]) => boolean) => round2(out.filter(f).reduce((s, r) => s + r.amount, 0));
    return {
      days, rows: kept,
      totals: {
        card: sum(r => r.method === "card" && r.state !== "reversed"),
        transfer: sum(r => r.method === "transfer" && r.state !== "reversed"),
        confirmed: sum(r => r.state === "confirmed"),
        transit: sum(r => r.state === "transit"),
        overdue: sum(r => r.state === "overdue"),
      },
    };
  },

  /** Что висит в пути прямо сейчас — плитки, вечерний крон, по людям. */
  async summary(db: Db, tenantId: number, now = new Date()) {
    const days = await confirmDays(db, tenantId);
    const [pending, [today]] = await Promise.all([
      db.select({ id: payments.id, amount: payments.amount, createdAt: payments.createdAt, createdBy: payments.createdBy, name: users.name })
        .from(payments).leftJoin(users, eq(users.id, payments.createdBy))
        .where(and(nonCashWhere(tenantId), isNull(payments.bankConfirmedAt), ne(payments.status, "reversed"))),
      db.select({ n: sql<number>`count(*)`, s: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments)
        .where(and(nonCashWhere(tenantId), gte(payments.bankConfirmedAt, tashkentDayStart(now)))),
    ]);
    const byEmployee = new Map<number, { id: number; name: string; count: number; total: number; overdueCount: number; overdueTotal: number }>();
    const transit = { count: 0, total: 0 }, overdue = { count: 0, total: 0 };
    for (const p of pending) {
      const amount = Number(p.amount);
      const late = now.getTime() - p.createdAt.getTime() > days * DAY_MS;
      const bucket = late ? overdue : transit;
      bucket.count++; bucket.total = round2(bucket.total + amount);
      const key = Number(p.createdBy ?? 0);
      const e = byEmployee.get(key) ?? { id: key, name: p.name ?? "—", count: 0, total: 0, overdueCount: 0, overdueTotal: 0 };
      e.count++; e.total = round2(e.total + amount);
      if (late) { e.overdueCount++; e.overdueTotal = round2(e.overdueTotal + amount); }
      byEmployee.set(key, e);
    }
    return {
      days, transit, overdue,
      confirmedToday: { count: Number(today?.n ?? 0), total: round2(Number(today?.s ?? 0)) },
      byEmployee: [...byEmployee.values()].sort((a, b) => b.overdueTotal - a.overdueTotal || b.total - a.total),
    };
  },

  /** «Пришло»: сверено с выпиской. Свой платёж — только директор; сторно и повтор — отказ. */
  async confirm(db: Db, tenantId: number, actor: Actor, input: { ids: number[]; bankRef?: string | null }, now = new Date()) {
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) throw badRequest("Не выбрано ни одного платежа");
    const bankRef = input.bankRef?.trim() ? input.bankRef.trim().slice(0, 64) : null;
    let total = 0;
    const done: Array<{ id: number; amount: string; method: string | null; shopId: number; orderId: number | null; createdBy: number | null }> = [];
    await db.transaction(async (tx) => {
      const rows = await tx.select({
        id: payments.id, amount: payments.amount, method: payments.paymentMethod, status: payments.status, type: payments.type,
        reversalOf: payments.reversalOf, bankConfirmedAt: payments.bankConfirmedAt, createdBy: payments.createdBy,
        shopId: payments.shopId, orderId: payments.orderId, shopName: shops.name,
      }).from(payments).innerJoin(shops, eq(shops.id, payments.shopId))
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, ids))).for("update");
      const byId = new Map(rows.map(r => [Number(r.id), r]));
      for (const id of ids) {
        const p = byId.get(id);
        if (!p) throw badRequest("Платёж не найден — список устарел, обновите страницу");
        // Отказ называет платёж как в списке — суммой и магазином, а не номером строки.
        const label = `${Number(p.amount).toLocaleString("ru-RU")} · ${p.shopName}`;
        if (p.type !== "payment" || p.reversalOf != null || !NON_CASH.includes(p.method as NonCashMethod)) throw badRequest(`Платёж ${label} — не карта и не перевод`);
        if (p.status === "reversed") throw badRequest(`Платёж ${label} сторнирован — подтверждать нечего`);
        if (p.bankConfirmedAt) throw badRequest(`Платёж ${label} уже подтверждён`);
        if (!canConfirm(actor, p.createdBy)) throw badRequest("Подтвердить свой же платёж нельзя — сверку с выпиской делает другой человек");
        total = round2(total + Number(p.amount));
        done.push({ id, amount: p.amount, method: p.method, shopId: p.shopId, orderId: p.orderId, createdBy: p.createdBy });
      }
      await tx.update(payments).set({ bankConfirmedAt: now, bankConfirmedBy: actor.id, bankRef })
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, ids), isNull(payments.bankConfirmedAt)));
    });
    const { recordAudit } = await import("./audit-log");
    const authorIds = [...new Set(done.map(p => p.createdBy).filter((x): x is number => x != null))];
    const authors = authorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)) : [];
    const authorOf = new Map(authors.map(a => [Number(a.id), a.name]));
    for (const p of done) {
      await recordAudit(db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "payment.bank_confirm", targetType: "payment", targetId: p.id,
        meta: { amount: p.amount, method: p.method, shopId: p.shopId, orderId: p.orderId, bankRef, recordedBy: p.createdBy != null ? authorOf.get(p.createdBy) ?? null : null },
      });
    }
    return { confirmed: done.length, total };
  },

  /**
   * «Пришло» от 1С: выписка уже в учёте, человека за подтверждением нет —
   * в журнале действий стоит «1С». Уже подтверждённое и сторно пропускаются.
   */
  async confirmFromBank(db: Db, tenantId: number, hits: Array<{ paymentId: number; bankRef: string; receiptDate?: Date }>, now = new Date()): Promise<number> {
    if (!hits.length) return 0;
    const rows = await db.select({
      id: payments.id, amount: payments.amount, method: payments.paymentMethod, status: payments.status, bankConfirmedAt: payments.bankConfirmedAt,
      shopId: payments.shopId, orderId: payments.orderId, createdBy: payments.createdBy, author: users.name,
    }).from(payments).leftJoin(users, eq(users.id, payments.createdBy))
      .where(and(nonCashWhere(tenantId), inArray(payments.id, hits.map(h => h.paymentId))));
    const byId = new Map(rows.map(r => [Number(r.id), r]));
    const { recordAudit } = await import("./audit-log");
    let n = 0;
    for (const h of hits) {
      const p = byId.get(h.paymentId);
      if (!p || p.bankConfirmedAt || p.status === "reversed") continue;
      const bankRef = h.bankRef.slice(0, 64);
      await db.update(payments).set({ bankConfirmedAt: now, bankConfirmedBy: null, bankRef })
        .where(and(eq(payments.id, p.id), isNull(payments.bankConfirmedAt)));
      await recordAudit(db, {
        tenantId, actorName: "1С", action: "payment.bank_confirm", targetType: "payment", targetId: p.id,
        meta: { amount: p.amount, method: p.method, shopId: p.shopId, orderId: p.orderId, bankRef, recordedBy: p.author ?? null, receiptDate: h.receiptDate ?? null },
      });
      n++;
    }
    return n;
  },
};

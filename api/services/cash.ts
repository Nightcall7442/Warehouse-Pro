import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { cashCategories, cashDays, cashDocuments, payments, settings, users } from "@db/schema";
import { badRequest } from "../lib/errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { notifyTenantRole, tgEscape, fmtMoney } from "../lib/telegram";

/** Директору — то, что нельзя пропустить; после ответа, не на пути кассира. */
function tellCeo(tenantId: number, text: string): void {
  void notifyTenantRole(tenantId, "ceo", text).catch(() => { /* уведомление — не проводка */ });
}

/* ═══════════════════════════════════════════════════════════════════════════
   КАССА — двойная запись поверх платежей.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Деньги «появлялись» в момент платежа и сразу считались выручкой. Курьер
   собрал 6 300 000 — сдал ли он их, сколько, когда, а разница? Директор
   видел выручку и долги, но не наличные на руках. Именно здесь дистрибьютор
   теряет деньги, и именно здесь воруют: «отметил в долг, а наличные взял»,
   «сдам завтра» неделями, «кассир округлил».

   ── Устройство ─────────────────────────────────────────────────────────────

   Счета (строки, не таблица):
     cash.employee.<id>     наличные на руках у сотрудника
     cash.office            сейф
     receivable.shop.<id>   долг магазина (уже есть как shops.debt)
     receivable.employee.<id>  долг сотрудника: недостача при сдаче
     expense.<статья>       расход по статье
     owner                  внесение / выемка директора
     income.unexplained     сдал больше, чем ожидалось, — до выяснения

   Проводки — двух видов. Наличный платёж (payments, method = cash) сам по
   себе проводка «Дт на руки записавшему / Кт долг магазина»: он не
   копируется. Всё остальное — документ cash_documents с дебетом и кредитом.
   Сумма всех счетов всегда ноль — это держит тест: деньги только переезжают.

   Ожидание считает система, человек вводит факт. Расхождение при сдаче —
   отдельный документ «долг сотрудника», и он не исчезает: списать его может
   только директор, отдельным документом, и это событие.

   Документы не правятся и не удаляются (тест ловит update/delete по этим
   таблицам). Ошибка — сторно с причиной, оба видны. Цепочка hash → prev_hash
   делает подмену строки в базе заметной: verifyChain находит место разрыва.
   ═══════════════════════════════════════════════════════════════════════════ */

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Роли, у которых наличные — это сейф, а не «на руках». */
export const CASHIER_ROLES = new Set(["ceo", "operator"]);

export const ACCOUNT = {
  office: "cash.office",
  owner: "owner",
  unexplained: "income.unexplained",
  employee: (id: number) => `cash.employee.${id}`,
  employeeDebt: (id: number) => `receivable.employee.${id}`,
  shop: (id: number) => `receivable.shop.${id}`,
  expense: (category: string) => `expense.${category}`,
} as const;

/** Куда падают наличные, которые записал этот человек. */
export function holderAccount(userId: number, role: string): string {
  return CASHIER_ROLES.has(role) ? ACCOUNT.office : ACCOUNT.employee(userId);
}

export interface Posting { debit: string; credit: string; amount: number }

/* ── Чистая часть: проводки, балансы, цепочка ──────────────────────────── */

/** Остатки по счетам из списка проводок. Дебет прибавляет, кредит вычитает. */
export function balancesOf(postings: Iterable<Posting>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of postings) {
    out.set(p.debit, round2((out.get(p.debit) ?? 0) + p.amount));
    out.set(p.credit, round2((out.get(p.credit) ?? 0) - p.amount));
  }
  return out;
}

/** Сумма всех счетов — обязана быть нулём после любого документа. */
export function ledgerSum(balances: Map<string, number>): number {
  let s = 0;
  for (const v of balances.values()) s += v;
  return round2(s) || 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100 + 0; // «+0» гасит отрицательный ноль

/**
 * Сдача в кассу: что проводится, когда сотрудник принёс `actual`, а система
 * ждала `expected`. Недостача остаётся долгом сотрудника; излишек — «до
 * выяснения», а не в сейф молча: лишние деньги тоже вопрос.
 */
export function handoverPostings(userId: number, expected: number, actual: number): { main: Posting; extra: Posting | null; discrepancy: number } {
  if (actual < 0) throw badRequest("Сумма сдачи не может быть отрицательной");
  const discrepancy = round2(actual - expected);
  const main: Posting = { debit: ACCOUNT.office, credit: ACCOUNT.employee(userId), amount: round2(Math.min(actual, expected)) };
  let extra: Posting | null = null;
  if (discrepancy < 0) extra = { debit: ACCOUNT.employeeDebt(userId), credit: ACCOUNT.employee(userId), amount: -discrepancy };
  if (discrepancy > 0) extra = { debit: ACCOUNT.office, credit: ACCOUNT.unexplained, amount: discrepancy };
  return { main, extra, discrepancy };
}

/**
 * Колонка created_at — TIMESTAMP без долей секунды, и MySQL округляет доли
 * ВВЕРХ. Хэш от времени с миллисекундами не сойдётся с тем, что прочитано из
 * базы: документ считался бы подменённым сразу после записи. Поэтому и хэш,
 * и запись берут время, срезанное до целой секунды.
 */
export const wholeSecond = (d: Date): Date => new Date(Math.floor(d.getTime() / 1000) * 1000);

/** Хэш документа — от предыдущего и от всего, что в нём считается. */
export function documentHash(prevHash: string | null, d: {
  tenantId: number; kind: string; year: number; number: number; debit: string; credit: string;
  amount: string; fromUserId: number | null; toUserId: number | null; createdBy: number; createdAt: Date;
}): string {
  const payload = [prevHash ?? "", d.tenantId, d.kind, d.year, d.number, d.debit, d.credit, d.amount,
    d.fromUserId ?? "", d.toUserId ?? "", d.createdBy, wholeSecond(d.createdAt).toISOString()].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/** Проверка цепочки: первый документ, чей хэш не сходится, — место подмены. */
export function verifyChain(rows: Array<{
  id: number; tenantId: number; kind: string; year: number; number: number; debit: string; credit: string;
  amount: string; fromUserId: number | null; toUserId: number | null; createdBy: number; createdAt: Date;
  prevHash: string | null; hash: string;
}>): { ok: true } | { ok: false; brokenAt: number } {
  let prev: string | null = null;
  for (const r of rows) {
    if (r.prevHash !== prev || documentHash(prev, r) !== r.hash) return { ok: false, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true };
}

const TASHKENT_MS = 5 * 3600 * 1000;
export function tashkentDay(at: Date): string {
  return new Date(at.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}
const yearOf = (at: Date) => new Date(at.getTime() + TASHKENT_MS).getUTCFullYear();

/* ── База: проводки из платежей и документов ───────────────────────────── */

async function paymentPostings(db: Db | Tx, tenantId: number, until?: Date): Promise<Posting[]> {
  const rows = await db.select({
    amount: payments.amount, shopId: payments.shopId, createdBy: payments.createdBy, role: users.role,
  }).from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(and(
      eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"),
      ...(until ? [lt(payments.createdAt, until)] : []),
    ));
  return rows.map(r => ({
    debit: holderAccount(Number(r.createdBy ?? 0), r.role ?? "operator"),
    credit: ACCOUNT.shop(Number(r.shopId)),
    amount: Number(r.amount),
  }));
}

async function documentPostings(db: Db | Tx, tenantId: number, until?: Date): Promise<Posting[]> {
  const rows = await db.select({ debit: cashDocuments.debit, credit: cashDocuments.credit, amount: cashDocuments.amount })
    .from(cashDocuments)
    .where(and(eq(cashDocuments.tenantId, tenantId), ...(until ? [lt(cashDocuments.createdAt, until)] : [])));
  return rows.map(r => ({ debit: r.debit, credit: r.credit, amount: Number(r.amount) }));
}

/** Все остатки организации на момент. */
export async function ledgerBalances(db: Db | Tx, tenantId: number, until?: Date): Promise<Map<string, number>> {
  const [p, d] = await Promise.all([paymentPostings(db, tenantId, until), documentPostings(db, tenantId, until)]);
  return balancesOf([...p, ...d]);
}

export const balanceOf = (b: Map<string, number>, account: string) => b.get(account) ?? 0;

/* ── Документы ───────────────────────────────────────────────────────────── */

interface NewDoc {
  kind: "pko" | "rko";
  posting: Posting;
  fromUserId?: number | null;
  toUserId?: number | null;
  expectedAmount?: number | null;
  discrepancy?: number | null;
  category?: string | null;
  note?: string | null;
  denominations?: Record<string, number> | null;
  photoUrl?: string | null;
  pinConfirmedAt?: Date | null;
  paperSigned?: boolean;
  stornoOfId?: number | null;
}

/**
 * Провести документ: номер в году, хэш от предыдущего, запись. Внутри
 * транзакции, последний документ организации берётся под замок — два
 * кассира не получат один номер и не порвут цепочку.
 */
async function postDocument(tx: Tx, tenantId: number, createdBy: number, d: NewDoc, at: Date): Promise<number> {
  if (!(d.posting.amount > 0)) throw badRequest("Сумма документа должна быть больше нуля");
  const now = wholeSecond(at);
  await assertDayOpen(tx, tenantId, now);

  const [last] = await tx.select({ hash: cashDocuments.hash })
    .from(cashDocuments).where(eq(cashDocuments.tenantId, tenantId))
    .orderBy(desc(cashDocuments.id)).limit(1).for("update");
  const year = yearOf(now);
  const [num] = await tx.select({ n: sql<number>`coalesce(max(${cashDocuments.number}), 0)` })
    .from(cashDocuments)
    .where(and(eq(cashDocuments.tenantId, tenantId), eq(cashDocuments.year, year), eq(cashDocuments.kind, d.kind)));
  const number = Number(num?.n ?? 0) + 1;
  const amount = d.posting.amount.toFixed(2);
  const hash = documentHash(last?.hash ?? null, {
    tenantId, kind: d.kind, year, number, debit: d.posting.debit, credit: d.posting.credit, amount,
    fromUserId: d.fromUserId ?? null, toUserId: d.toUserId ?? null, createdBy, createdAt: now,
  });
  const [row] = await tx.insert(cashDocuments).values({
    tenantId, kind: d.kind, year, number, debit: d.posting.debit, credit: d.posting.credit, amount,
    expectedAmount: d.expectedAmount != null ? d.expectedAmount.toFixed(2) : null,
    discrepancy: d.discrepancy != null ? d.discrepancy.toFixed(2) : null,
    fromUserId: d.fromUserId ?? null, toUserId: d.toUserId ?? null,
    category: d.category ?? null, note: d.note ?? null,
    denominations: d.denominations ?? null, photoUrl: d.photoUrl ?? null,
    pinConfirmedAt: d.pinConfirmedAt ?? null, paperSigned: d.paperSigned ?? false,
    stornoOfId: d.stornoOfId ?? null, prevHash: last?.hash ?? null, hash,
    createdBy, createdAt: now,
  });
  return Number(row.insertId);
}

/** Закрытый день проводок не принимает — до «открыть снова» директором. */
async function assertDayOpen(db: Db | Tx, tenantId: number, now: Date): Promise<void> {
  const [d] = await db.select({ id: cashDays.id, reopenedAt: cashDays.reopenedAt })
    .from(cashDays).where(and(eq(cashDays.tenantId, tenantId), eq(cashDays.day, tashkentDay(now)))).limit(1);
  if (d && !d.reopenedAt) throw badRequest("День уже закрыт — новые документы не проводятся. Директор может открыть день снова.");
}

export interface Actor { id: number; name: string; role: string }

async function audit(db: Db, tenantId: number, actor: Actor, action: string, docId: number, meta: Record<string, unknown>) {
  const { recordAudit } = await import("./audit-log");
  await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action, targetType: "cash_document", targetId: docId, meta });
}

export const CashService = {
  /* ── Сдача в кассу (ПКО) ──────────────────────────────────────────────── */
  async handover(db: Db, tenantId: number, cashier: Actor, input: {
    fromUserId: number; amount: number; pin?: string; paperSigned?: boolean;
    denominations?: Record<string, number> | null; note?: string | null; now?: Date;
  }): Promise<{ docId: number; number: string; expected: number; discrepancy: number; debtDocId: number | null }> {
    const now = input.now ?? new Date();
    if (input.fromUserId === cashier.id) throw badRequest("Принять сдачу у самого себя нельзя");
    const [from] = await db.select({ id: users.id, role: users.role, pinHash: users.cashPinHash, status: users.status })
      .from(users).where(and(eq(users.id, input.fromUserId), eq(users.tenantId, tenantId))).limit(1);
    if (!from || from.status !== "active") throw badRequest("Сотрудник не найден");
    if (CASHIER_ROLES.has(from.role)) throw badRequest("У кассира наличные уже в сейфе — сдавать нечего");

    // Подтверждение: PIN сотрудника, если он его завёл; иначе — подпись на бумажном ПКО.
    let pinConfirmedAt: Date | null = null;
    if (from.pinHash) {
      if (!input.pin) throw badRequest("Нужен PIN сотрудника: он вводит его в своём телефоне");
      if (!(await verifyPassword(input.pin, from.pinHash))) throw badRequest("PIN не подошёл");
      pinConfirmedAt = now;
    } else if (!input.paperSigned) {
      throw badRequest("У сотрудника нет PIN: отметьте «подписал ПКО на бумаге»");
    }

    let result: { docId: number; number: string; expected: number; discrepancy: number; debtDocId: number | null } | null = null;
    await db.transaction(async (tx) => {
      const balances = await ledgerBalances(tx, tenantId);
      const expected = round2(balanceOf(balances, ACCOUNT.employee(input.fromUserId)));
      const plan = handoverPostings(input.fromUserId, expected, round2(input.amount));
      const docId = await postDocument(tx, tenantId, cashier.id, {
        kind: "pko", posting: plan.main, fromUserId: input.fromUserId, toUserId: cashier.id,
        expectedAmount: expected, discrepancy: plan.discrepancy, denominations: input.denominations ?? null,
        note: input.note ?? null, pinConfirmedAt, paperSigned: !pinConfirmedAt,
      }, now);
      let debtDocId: number | null = null;
      if (plan.extra) {
        debtDocId = await postDocument(tx, tenantId, cashier.id, {
          kind: plan.discrepancy < 0 ? "rko" : "pko", posting: plan.extra, fromUserId: input.fromUserId, toUserId: cashier.id,
          note: plan.discrepancy < 0 ? `Недостача при сдаче по ПКО #${docId}` : `Излишек при сдаче по ПКО #${docId} — до выяснения`,
        }, new Date(now.getTime() + 1));
      }
      const [doc] = await tx.select({ number: cashDocuments.number }).from(cashDocuments).where(eq(cashDocuments.id, docId)).limit(1);
      result = { docId, number: `ПКО-${String(doc?.number ?? 0).padStart(4, "0")}`, expected, discrepancy: plan.discrepancy, debtDocId };
    });
    const r = result!;
    await audit(db, tenantId, cashier, "cash.handover", r.docId, {
      fromUserId: input.fromUserId, amount: input.amount, expected: r.expected, discrepancy: r.discrepancy, number: r.number,
    });
    if (r.discrepancy !== 0) {
      const [who] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.fromUserId)).limit(1);
      tellCeo(tenantId, r.discrepancy < 0
        ? `🛑 <b>Недостача при сдаче: ${tgEscape(fmtMoney(-r.discrepancy))}</b>\n👤 ${tgEscape(who?.name ?? "")} · ожидалось ${tgEscape(fmtMoney(r.expected))}, сдал ${tgEscape(fmtMoney(input.amount))}\n🧾 ${tgEscape(r.number)} · принял ${tgEscape(cashier.name)}\nЗаписано долгом сотрудника — уйдёт в удержание из зарплаты, пока вы не спишете.`
        : `⚠️ <b>Излишек при сдаче: ${tgEscape(fmtMoney(r.discrepancy))}</b>\n👤 ${tgEscape(who?.name ?? "")} · ожидалось ${tgEscape(fmtMoney(r.expected))}, сдал ${tgEscape(fmtMoney(input.amount))}\n🧾 ${tgEscape(r.number)} · принял ${tgEscape(cashier.name)}\nЛишние деньги — тоже вопрос: откуда?`);
    }
    return r;
  },

  /* ── Расход (РКО) ─────────────────────────────────────────────────────── */
  async expense(db: Db, tenantId: number, actor: Actor, input: {
    category: string; amount: number; note?: string | null; photoUrl?: string | null; now?: Date;
  }): Promise<{ docId: number; number: string }> {
    const now = input.now ?? new Date();
    const amount = round2(input.amount);
    const [cat] = await db.select({ code: cashCategories.code, limit: cashCategories.monthlyLimit, isActive: cashCategories.isActive })
      .from(cashCategories).where(and(eq(cashCategories.tenantId, tenantId), eq(cashCategories.code, input.category))).limit(1);
    if (!cat || !cat.isActive) throw badRequest("Статьи расхода нет — заведите её в настройках кассы");

    let docId = 0;
    await db.transaction(async (tx) => {
      const balances = await ledgerBalances(tx, tenantId);
      const office = balanceOf(balances, ACCOUNT.office);
      if (amount > office + 0.005) throw badRequest(`В сейфе ${office.toLocaleString("ru-RU")} — расход больше остатка не проводится`);
      // Лимит статьи на месяц: сверх — только директор.
      if (cat.limit != null && actor.role !== "ceo") {
        const monthStart = new Date(Date.UTC(yearOf(now), new Date(now.getTime() + TASHKENT_MS).getUTCMonth(), 1) - TASHKENT_MS);
        const [spent] = await tx.select({ s: sql<number>`coalesce(sum(${cashDocuments.amount}), 0)` }).from(cashDocuments)
          .where(and(eq(cashDocuments.tenantId, tenantId), eq(cashDocuments.debit, ACCOUNT.expense(cat.code)), gte(cashDocuments.createdAt, monthStart)));
        if (Number(spent?.s ?? 0) + amount > Number(cat.limit)) throw badRequest("Лимит статьи на месяц исчерпан — сверх лимита проводит директор");
      }
      docId = await postDocument(tx, tenantId, actor.id, {
        kind: "rko", posting: { debit: ACCOUNT.expense(cat.code), credit: ACCOUNT.office, amount },
        toUserId: null, category: cat.code, note: input.note ?? null, photoUrl: input.photoUrl ?? null,
      }, now);
    });
    const number = await numberOf(db, docId);
    await audit(db, tenantId, actor, "cash.expense", docId, { category: cat.code, amount, number });
    return { docId, number };
  },

  /* ── Внесение и выемка (директор) ─────────────────────────────────────── */
  async ownerMove(db: Db, tenantId: number, actor: Actor, input: { direction: "deposit" | "withdrawal"; amount: number; note?: string | null; now?: Date }) {
    const now = input.now ?? new Date();
    const amount = round2(input.amount);
    let docId = 0;
    await db.transaction(async (tx) => {
      if (input.direction === "withdrawal") {
        const office = balanceOf(await ledgerBalances(tx, tenantId), ACCOUNT.office);
        if (amount > office + 0.005) throw badRequest("Выемка больше остатка сейфа");
      }
      docId = await postDocument(tx, tenantId, actor.id, input.direction === "deposit"
        ? { kind: "pko", posting: { debit: ACCOUNT.office, credit: ACCOUNT.owner, amount }, fromUserId: actor.id, note: input.note ?? null }
        : { kind: "rko", posting: { debit: ACCOUNT.owner, credit: ACCOUNT.office, amount }, toUserId: actor.id, note: input.note ?? null },
      now);
    });
    const number = await numberOf(db, docId);
    await audit(db, tenantId, actor, input.direction === "deposit" ? "cash.deposit" : "cash.withdrawal", docId, { amount, number });
    return { docId, number };
  },

  /* ── Списание долга сотрудника (только директор) ──────────────────────── */
  async writeOff(db: Db, tenantId: number, actor: Actor, input: { userId: number; amount: number; reason: string; now?: Date }) {
    const now = input.now ?? new Date();
    const amount = round2(input.amount);
    if (!input.reason.trim()) throw badRequest("Списание без причины не проводится");
    let docId = 0;
    await db.transaction(async (tx) => {
      const debt = balanceOf(await ledgerBalances(tx, tenantId), ACCOUNT.employeeDebt(input.userId));
      if (amount > debt + 0.005) throw badRequest(`Долг сотрудника ${debt.toLocaleString("ru-RU")} — списать больше нельзя`);
      docId = await postDocument(tx, tenantId, actor.id, {
        kind: "rko", posting: { debit: ACCOUNT.expense("shortage"), credit: ACCOUNT.employeeDebt(input.userId), amount },
        fromUserId: input.userId, category: "shortage", note: input.reason,
      }, now);
    });
    const number = await numberOf(db, docId);
    await audit(db, tenantId, actor, "cash.write_off", docId, { userId: input.userId, amount, reason: input.reason, number });
    tellCeo(tenantId, `🧾 <b>Списан долг сотрудника: ${tgEscape(fmtMoney(amount))}</b>\n${tgEscape(number)} · ${tgEscape(actor.name)}\n${tgEscape(input.reason)}`);
    return { docId, number };
  },

  /* ── Сторно ───────────────────────────────────────────────────────────── */
  async storno(db: Db, tenantId: number, actor: Actor, input: { docId: number; reason: string; now?: Date }) {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) throw badRequest("Сторно без причины не проводится");
    let docId = 0;
    await db.transaction(async (tx) => {
      const [orig] = await tx.select().from(cashDocuments)
        .where(and(eq(cashDocuments.id, input.docId), eq(cashDocuments.tenantId, tenantId))).limit(1).for("update");
      if (!orig) throw badRequest("Документ не найден");
      if (orig.stornoOfId) throw badRequest("Это уже сторно — сторнировать его нельзя");
      const [done] = await tx.select({ id: cashDocuments.id }).from(cashDocuments).where(eq(cashDocuments.stornoOfId, orig.id)).limit(1);
      if (done) throw badRequest("Документ уже сторнирован");
      // Кассир сторнирует только свои документы; директор — любые.
      if (actor.role !== "ceo" && Number(orig.createdBy) !== actor.id) throw badRequest("Чужой документ сторнирует директор");
      docId = await postDocument(tx, tenantId, actor.id, {
        kind: orig.kind === "pko" ? "rko" : "pko",
        posting: { debit: orig.credit, credit: orig.debit, amount: Number(orig.amount) },
        fromUserId: orig.toUserId, toUserId: orig.fromUserId, category: orig.category,
        note: `Сторно ${orig.kind === "pko" ? "ПКО" : "РКО"}-${String(orig.number).padStart(4, "0")}: ${input.reason}`,
        stornoOfId: orig.id,
      }, now);
    });
    const number = await numberOf(db, docId);
    await audit(db, tenantId, actor, "cash.storno", docId, { stornoOf: input.docId, reason: input.reason, number });
    return { docId, number };
  },

  /* ── Закрытие дня ─────────────────────────────────────────────────────── */
  async closeDay(db: Db, tenantId: number, actor: Actor, input: { countedBalance: number; now?: Date }) {
    const now = input.now ?? new Date();
    const day = tashkentDay(now);
    const [exists] = await db.select({ id: cashDays.id, reopenedAt: cashDays.reopenedAt }).from(cashDays)
      .where(and(eq(cashDays.tenantId, tenantId), eq(cashDays.day, day))).limit(1);
    if (exists && !exists.reopenedAt) throw badRequest("День уже закрыт");

    const system = round2(balanceOf(await ledgerBalances(db, tenantId), ACCOUNT.office));
    const counted = round2(input.countedBalance);
    const discrepancy = round2(counted - system);
    // Расхождение сейфа — документ на кассира: недостача его долг, излишек — до выяснения.
    let docId: number | null = null;
    if (discrepancy !== 0) {
      await db.transaction(async (tx) => {
        docId = await postDocument(tx, tenantId, actor.id, discrepancy < 0
          ? { kind: "rko", posting: { debit: ACCOUNT.employeeDebt(actor.id), credit: ACCOUNT.office, amount: -discrepancy }, fromUserId: actor.id, note: `Недостача сейфа при закрытии ${day}` }
          : { kind: "pko", posting: { debit: ACCOUNT.office, credit: ACCOUNT.unexplained, amount: discrepancy }, toUserId: actor.id, note: `Излишек сейфа при закрытии ${day} — до выяснения` },
        now);
      });
    }
    if (exists) {
      await db.update(cashDays).set({ systemBalance: system.toFixed(2), countedBalance: counted.toFixed(2), discrepancy: discrepancy.toFixed(2), closedBy: actor.id, closedAt: now, reopenedBy: null, reopenedAt: null })
        .where(eq(cashDays.id, exists.id));
    } else {
      await db.insert(cashDays).values({ tenantId, day, systemBalance: system.toFixed(2), countedBalance: counted.toFixed(2), discrepancy: discrepancy.toFixed(2), closedBy: actor.id, closedAt: now });
    }
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "cash.day_closed", targetType: "cash_day", targetId: 0, targetLabel: day, meta: { system, counted, discrepancy } });
    if (discrepancy !== 0) {
      tellCeo(tenantId, `${discrepancy < 0 ? "🛑" : "⚠️"} <b>Сейф при закрытии ${tgEscape(day)}: ${discrepancy < 0 ? "недостача" : "излишек"} ${tgEscape(fmtMoney(Math.abs(discrepancy)))}</b>\nПо системе ${tgEscape(fmtMoney(system))}, пересчёт ${tgEscape(fmtMoney(counted))} · закрыл ${tgEscape(actor.name)}`);
    }
    return { day, system, counted, discrepancy, docId };
  },

  async reopenDay(db: Db, tenantId: number, actor: Actor, input: { day: string }) {
    if (actor.role !== "ceo") throw badRequest("Открыть закрытый день может только директор");
    const [exists] = await db.select({ id: cashDays.id }).from(cashDays)
      .where(and(eq(cashDays.tenantId, tenantId), eq(cashDays.day, input.day))).limit(1);
    if (!exists) throw badRequest("Этот день не закрывали");
    await db.update(cashDays).set({ reopenedBy: actor.id, reopenedAt: new Date() }).where(eq(cashDays.id, exists.id));
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "cash.day_reopened", targetType: "cash_day", targetId: 0, targetLabel: input.day, meta: {} });
    return { ok: true };
  },

  /* ── PIN сотрудника ───────────────────────────────────────────────────── */
  async setPin(db: Db, tenantId: number, userId: number, pin: string) {
    if (!/^\d{4,6}$/.test(pin)) throw badRequest("PIN — 4–6 цифр");
    await db.update(users).set({ cashPinHash: await hashPassword(pin) }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    return { ok: true };
  },

  /* ── Обзор ────────────────────────────────────────────────────────────── */
  async overview(db: Db, tenantId: number, now = new Date()) {
    const dayStart = new Date(Date.parse(`${tashkentDay(now)}T00:00:00Z`) - TASHKENT_MS);
    const [balances, people, [cfg], todayIn, todayOut, lastHandovers, [closed]] = await Promise.all([
      ledgerBalances(db, tenantId),
      db.select({ id: users.id, name: users.name, role: users.role, hasPin: sql<number>`case when ${users.cashPinHash} is null then 0 else 1 end` })
        .from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.role, ["agent", "courier", "merchandiser", "supervisor"]))),
      db.select({ limit: settings.cashLimit, deadline: settings.cashDeadline }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1),
      db.select({ createdBy: payments.createdBy, s: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), gte(payments.createdAt, dayStart)))
        .groupBy(payments.createdBy),
      db.select({ fromUserId: cashDocuments.fromUserId, s: sql<number>`coalesce(sum(${cashDocuments.amount}), 0)` }).from(cashDocuments)
        .where(and(eq(cashDocuments.tenantId, tenantId), eq(cashDocuments.debit, ACCOUNT.office), gte(cashDocuments.createdAt, dayStart), isNull(cashDocuments.stornoOfId)))
        .groupBy(cashDocuments.fromUserId),
      db.select({ fromUserId: cashDocuments.fromUserId, at: sql<Date>`max(${cashDocuments.createdAt})` }).from(cashDocuments)
        .where(and(eq(cashDocuments.tenantId, tenantId), eq(cashDocuments.debit, ACCOUNT.office), eq(cashDocuments.kind, "pko")))
        .groupBy(cashDocuments.fromUserId),
      db.select({ id: cashDays.id, reopenedAt: cashDays.reopenedAt, discrepancy: cashDays.discrepancy }).from(cashDays)
        .where(and(eq(cashDays.tenantId, tenantId), eq(cashDays.day, tashkentDay(now)))).limit(1),
    ]);
    const inBy = new Map(todayIn.map(r => [Number(r.createdBy), Number(r.s)]));
    const outBy = new Map(todayOut.map(r => [Number(r.fromUserId), Number(r.s)]));
    const lastBy = new Map(lastHandovers.map(r => [Number(r.fromUserId), r.at]));
    const limit = Number(cfg?.limit ?? 5_000_000);

    const holders = people.map(u => {
      const onHand = round2(balanceOf(balances, ACCOUNT.employee(u.id)));
      const debt = round2(balanceOf(balances, ACCOUNT.employeeDebt(u.id)));
      return {
        id: u.id, name: u.name, role: u.role, hasPin: Number(u.hasPin) === 1,
        onHand, debt, todayIn: inBy.get(u.id) ?? 0, todayOut: outBy.get(u.id) ?? 0,
        lastHandoverAt: lastBy.get(u.id) ?? null, overLimit: onHand > limit,
      };
    }).filter(h => h.onHand !== 0 || h.debt !== 0 || h.todayIn > 0 || h.todayOut > 0 || h.role === "courier" || h.role === "agent")
      .sort((a, b) => b.onHand - a.onHand);

    return {
      office: round2(balanceOf(balances, ACCOUNT.office)),
      onHandTotal: round2(holders.reduce((s, h) => s + h.onHand, 0)),
      employeeDebtTotal: round2(holders.reduce((s, h) => s + h.debt, 0)),
      unexplained: round2(-balanceOf(balances, ACCOUNT.unexplained)),
      todayIn: round2([...inBy.values()].reduce((s, v) => s + v, 0)),
      todayOut: round2([...outBy.values()].reduce((s, v) => s + v, 0)),
      limit, deadline: cfg?.deadline ?? "19:00",
      dayClosed: Boolean(closed && !closed.reopenedAt),
      ledgerSum: ledgerSum(balances),
      holders,
    };
  },

  /** Свой кошелёк: курьеру и агенту — на руках, принято сегодня, долг, лимит, последние сдачи. */
  async mine(db: Db, tenantId: number, userId: number, now = new Date()) {
    const dayStart = new Date(Date.parse(`${tashkentDay(now)}T00:00:00Z`) - TASHKENT_MS);
    const [balances, [cfg], [today], docs] = await Promise.all([
      ledgerBalances(db, tenantId),
      db.select({ limit: settings.cashLimit, deadline: settings.cashDeadline }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1),
      db.select({ s: sql<number>`coalesce(sum(${payments.amount}), 0)`, n: sql<number>`count(*)` }).from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), eq(payments.createdBy, userId), gte(payments.createdAt, dayStart))),
      db.select({ id: cashDocuments.id, kind: cashDocuments.kind, number: cashDocuments.number, amount: cashDocuments.amount, expectedAmount: cashDocuments.expectedAmount, discrepancy: cashDocuments.discrepancy, note: cashDocuments.note, createdAt: cashDocuments.createdAt })
        .from(cashDocuments).where(and(eq(cashDocuments.tenantId, tenantId), eq(cashDocuments.fromUserId, userId)))
        .orderBy(desc(cashDocuments.id)).limit(20),
    ]);
    return {
      onHand: round2(balanceOf(balances, ACCOUNT.employee(userId))),
      debt: round2(balanceOf(balances, ACCOUNT.employeeDebt(userId))),
      todayIn: Number(today?.s ?? 0), todayCount: Number(today?.n ?? 0),
      limit: Number(cfg?.limit ?? 5_000_000), deadline: cfg?.deadline ?? "19:00",
      documents: docs,
    };
  },

  /** Журнал документов за срок. */
  async journal(db: Db, tenantId: number, input: { from: Date; to: Date; userId?: number }) {
    const fromU = users;
    const rows = await db.select().from(cashDocuments)
      .where(and(
        eq(cashDocuments.tenantId, tenantId), gte(cashDocuments.createdAt, input.from), lt(cashDocuments.createdAt, input.to),
        ...(input.userId ? [sql`(${cashDocuments.fromUserId} = ${input.userId} OR ${cashDocuments.toUserId} = ${input.userId})`] : []),
      )).orderBy(desc(cashDocuments.id)).limit(500);
    const ids = [...new Set(rows.flatMap(r => [r.fromUserId, r.toUserId, r.createdBy]).filter((x): x is number => x != null))];
    const names = ids.length ? await db.select({ id: fromU.id, name: fromU.name }).from(fromU).where(inArray(fromU.id, ids)) : [];
    const nameOf = new Map(names.map(n => [Number(n.id), n.name]));
    return rows.map(r => ({
      ...r, amount: Number(r.amount), expectedAmount: r.expectedAmount != null ? Number(r.expectedAmount) : null,
      discrepancy: r.discrepancy != null ? Number(r.discrepancy) : null,
      fromName: r.fromUserId ? nameOf.get(Number(r.fromUserId)) ?? null : null,
      toName: r.toUserId ? nameOf.get(Number(r.toUserId)) ?? null : null,
      createdByName: nameOf.get(Number(r.createdBy)) ?? null,
      number: `${r.kind === "pko" ? "ПКО" : "РКО"}-${String(r.number).padStart(4, "0")}`,
    }));
  },

  /** Кассовая книга: по дням — остаток на начало, приход, расход, остаток на конец. */
  async cashBook(db: Db, tenantId: number, input: { from: Date; to: Date }) {
    const opening = balanceOf(await ledgerBalances(db, tenantId, input.from), ACCOUNT.office);
    const docs = await db.select({ debit: cashDocuments.debit, credit: cashDocuments.credit, amount: cashDocuments.amount, createdAt: cashDocuments.createdAt })
      .from(cashDocuments).where(and(eq(cashDocuments.tenantId, tenantId), gte(cashDocuments.createdAt, input.from), lt(cashDocuments.createdAt, input.to)));
    const pays = await db.select({ amount: payments.amount, createdAt: payments.createdAt, role: users.role })
      .from(payments).leftJoin(users, eq(users.id, payments.createdBy))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), gte(payments.createdAt, input.from), lt(payments.createdAt, input.to)));
    const days = new Map<string, { inflow: number; outflow: number }>();
    const bump = (at: Date, inflow: number, outflow: number) => {
      const k = tashkentDay(at); const d = days.get(k) ?? { inflow: 0, outflow: 0 };
      d.inflow = round2(d.inflow + inflow); d.outflow = round2(d.outflow + outflow); days.set(k, d);
    };
    for (const d of docs) {
      if (d.debit === ACCOUNT.office) bump(d.createdAt, Number(d.amount), 0);
      else if (d.credit === ACCOUNT.office) bump(d.createdAt, 0, Number(d.amount));
    }
    // Наличные, записанные кассиром, идут в сейф напрямую.
    for (const p of pays) if (CASHIER_ROLES.has(p.role ?? "")) bump(p.createdAt, Number(p.amount), 0);
    let running = round2(opening);
    const rowsOut = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => {
      const start = running; running = round2(running + v.inflow - v.outflow);
      return { day, opening: start, inflow: v.inflow, outflow: v.outflow, closing: running };
    });
    return { opening: round2(opening), closing: running, days: rowsOut };
  },

  /** Цепочка документов организации цела? Крон зовёт ежедневно. */
  async verify(db: Db, tenantId: number) {
    const rows = await db.select({
      id: cashDocuments.id, tenantId: cashDocuments.tenantId, kind: cashDocuments.kind, year: cashDocuments.year, number: cashDocuments.number,
      debit: cashDocuments.debit, credit: cashDocuments.credit, amount: cashDocuments.amount, fromUserId: cashDocuments.fromUserId,
      toUserId: cashDocuments.toUserId, createdBy: cashDocuments.createdBy, createdAt: cashDocuments.createdAt,
      prevHash: cashDocuments.prevHash, hash: cashDocuments.hash,
    }).from(cashDocuments).where(eq(cashDocuments.tenantId, tenantId)).orderBy(cashDocuments.id);
    return verifyChain(rows.map(r => ({ ...r, tenantId: Number(r.tenantId), fromUserId: r.fromUserId != null ? Number(r.fromUserId) : null, toUserId: r.toUserId != null ? Number(r.toUserId) : null, createdBy: Number(r.createdBy) })));
  },

  /** Долг сотрудника, возникший в периоде, — для удержания из зарплаты. */
  async employeeDebtIn(db: Db, tenantId: number, userId: number, from: Date, to: Date): Promise<number> {
    const rows = await db.select({ debit: cashDocuments.debit, credit: cashDocuments.credit, amount: cashDocuments.amount })
      .from(cashDocuments).where(and(eq(cashDocuments.tenantId, tenantId), gte(cashDocuments.createdAt, from), lt(cashDocuments.createdAt, to),
        sql`(${cashDocuments.debit} = ${ACCOUNT.employeeDebt(userId)} OR ${cashDocuments.credit} = ${ACCOUNT.employeeDebt(userId)})`));
    return round2(balanceOf(balancesOf(rows.map(r => ({ debit: r.debit, credit: r.credit, amount: Number(r.amount) }))), ACCOUNT.employeeDebt(userId)));
  },
};

async function numberOf(db: Db, docId: number): Promise<string> {
  const [d] = await db.select({ kind: cashDocuments.kind, number: cashDocuments.number }).from(cashDocuments).where(eq(cashDocuments.id, docId)).limit(1);
  return `${d?.kind === "pko" ? "ПКО" : "РКО"}-${String(d?.number ?? 0).padStart(4, "0")}`;
}

/** Стартовые статьи расхода — заводятся один раз при первом открытии кассы. */
export const DEFAULT_CATEGORIES = [
  { code: "fuel", name: "Бензин и транспорт" },
  { code: "advance", name: "Аванс сотруднику" },
  { code: "household", name: "Хозяйственные расходы" },
  { code: "salary", name: "Выдача зарплаты" },
  { code: "shortage", name: "Списание недостачи" },
  { code: "other", name: "Прочее" },
] as const;

export async function ensureCategories(db: Db, tenantId: number): Promise<void> {
  const [any] = await db.select({ id: cashCategories.id }).from(cashCategories).where(eq(cashCategories.tenantId, tenantId)).limit(1);
  if (any) return;
  await db.insert(cashCategories).values(DEFAULT_CATEGORIES.map(c => ({ tenantId, code: c.code, name: c.name })));
}

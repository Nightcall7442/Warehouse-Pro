import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Касса на настоящей базе: платёж курьера → сдача с недостачей → расход →
 * сторно → закрытие дня → закрытый день не принимает → директор открыл →
 * списал долг. На каждом шаге сумма счетов — ноль, цепочка цела.
 *
 * Стенд с подделкой базы здесь не годится: замки for update, нумерация в
 * году и хэш от предыдущего документа живут только в транзакции.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("касса: сдача, расход, закрытие дня", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [ceo] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест" }).catch(() => {});
    // Курьер записал наличный платёж от магазина: 600 000 «на руках».
    await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, amount: "600000.00", type: "payment", paymentMethod: "cash", createdBy: s.courierId });
    // История до кассы: наличные, принятые директором в январе, в сейф не входят.
    await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, amount: "8000000.00", type: "payment", paymentMethod: "cash", createdBy: ceoId, createdAt: new Date("2026-01-15T08:00:00Z") });
  });

  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });

  it("деньги только переезжают между счетами; недостача — долг; день закрывается и держит", async () => {
    const { CashService, ensureCategories, ledgerBalances, ledgerSum, ACCOUNT, balanceOf } = await import("../../services/cash");
    await ensureCategories(db as any, s.tenantId);

    let o = await CashService.overview(db as any, s.tenantId);
    expect(o.holders.find(h => h.id === s.courierId)?.onHand).toBe(600_000);
    expect(o.office).toBe(0);
    expect(o.ledgerSum).toBe(0);

    // Сдал 580 000 из 600 000, подписал на бумаге (PIN не заведён).
    const h = await CashService.handover(db as any, s.tenantId, ceo(), { fromUserId: s.courierId, amount: 580_000, paperSigned: true });
    expect(h.expected).toBe(600_000);
    expect(h.discrepancy).toBe(-20_000);
    expect(h.number).toBe("ПКО-0001");
    expect(h.debtDocId).not.toBeNull();

    let b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.office)).toBe(580_000);
    expect(balanceOf(b, ACCOUNT.employee(s.courierId))).toBe(0);
    expect(balanceOf(b, ACCOUNT.employeeDebt(s.courierId))).toBe(20_000);
    expect(ledgerSum(b)).toBe(0);

    // Без PIN и без галочки — отказ; сам себе — отказ.
    await expect(CashService.handover(db as any, s.tenantId, ceo(), { fromUserId: s.courierId, amount: 1 })).rejects.toThrow(/подписал ПКО/);
    await expect(CashService.handover(db as any, s.tenantId, ceo(), { fromUserId: ceoId, amount: 1, paperSigned: true })).rejects.toThrow(/самого себя/);

    // Расход: бензин 100 000; больше сейфа — отказ.
    const e = await CashService.expense(db as any, s.tenantId, ceo(), { category: "fuel", amount: 100_000, note: "бензин" });
    expect(e.number).toBe("РКО-0002"); // РКО-0001 — недостача при сдаче
    await expect(CashService.expense(db as any, s.tenantId, ceo(), { category: "fuel", amount: 10_000_000 })).rejects.toThrow(/больше остатка/);
    b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.office)).toBe(480_000);

    // Сторно расхода возвращает деньги в сейф; повторное сторно — отказ.
    const st = await CashService.storno(db as any, s.tenantId, ceo(), { docId: e.docId, reason: "ошибка ввода" });
    expect(st.number).toBe("ПКО-0002");
    await expect(CashService.storno(db as any, s.tenantId, ceo(), { docId: e.docId, reason: "ещё раз" })).rejects.toThrow(/уже сторнирован/);
    b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.office)).toBe(580_000);
    expect(ledgerSum(b)).toBe(0);

    // Закрытие дня: пересчитали 570 000 → недостача сейфа 10 000 на кассира.
    const c = await CashService.closeDay(db as any, s.tenantId, ceo(), { countedBalance: 570_000 });
    expect(c).toMatchObject({ system: 580_000, counted: 570_000, discrepancy: -10_000 });
    b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.office)).toBe(570_000);
    expect(balanceOf(b, ACCOUNT.employeeDebt(ceoId))).toBe(10_000);

    // Закрытый день документов не принимает; директор открыл — принимает.
    await expect(CashService.expense(db as any, s.tenantId, ceo(), { category: "fuel", amount: 1000 })).rejects.toThrow(/День уже закрыт/);
    await CashService.reopenDay(db as any, s.tenantId, ceo(), { day: c.day });
    await CashService.expense(db as any, s.tenantId, ceo(), { category: "fuel", amount: 1000 });

    // Списание долга курьера — только директор, не больше долга.
    await expect(CashService.writeOff(db as any, s.tenantId, ceo(), { userId: s.courierId, amount: 50_000, reason: "нет" })).rejects.toThrow(/списать больше нельзя/);
    await CashService.writeOff(db as any, s.tenantId, ceo(), { userId: s.courierId, amount: 20_000, reason: "договорились" });
    b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.employeeDebt(s.courierId))).toBe(0);
    expect(ledgerSum(b)).toBe(0);

    // Цепочка цела; подмена строки в базе находится.
    expect(await CashService.verify(db as any, s.tenantId)).toEqual({ ok: true });
    await (db as any).execute(sql`UPDATE cash_documents SET amount = amount + 1 WHERE id = ${e.docId}`);
    expect(await CashService.verify(db as any, s.tenantId)).toEqual({ ok: false, brokenAt: e.docId });

    // Свой кошелёк курьера видит долг и сдачи.
    const mine = await CashService.mine(db as any, s.tenantId, s.courierId);
    expect(mine.onHand).toBe(0);
    expect(mine.documents.length).toBeGreaterThanOrEqual(2);

    o = await CashService.overview(db as any, s.tenantId);
    expect(o.dayClosed).toBe(false); // открыт снова
    expect(o.ledgerSum).toBe(0);
  });
});

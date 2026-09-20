import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { closeMath, onHandsOf, OFFICE_ROLES } from "../services/order-close";
import { RISK, riskScore, type RiskSignals } from "../services/control";

/**
 * Расчёт по заказу — вместо кассы (владелец, 18.09.2026: «касса тоже надо
 * убрать; до получения физических денег заказ не закроется, или долг»).
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · арифметика закрытия: сдал меньше заявленного — недостача курьера,
 *     больше — платёж офиса; сверх суммы заказа — отказ; остаток — долг;
 *   · «на руках» — только наличные поля без отметки получения; сторно-пары
 *     не считаются;
 *   · оплата офиса получена сразу и закрывает расчёт; полевые наличные
 *     открывают его заново; второй круг заказа снимает закрытие;
 *   · ручки: money — читателям заказа, close и confirmBank — офису правом
 *     приёма денег; список знает фильтр «ждут расчёта», сводка — счётчик;
 *   · KPI и контроль берут недостачу из заказов; сигналов кассы (долг,
 *     лимит) больше нет;
 *   · кассы нет: ни сервиса, ни роутера, ни экрана, ни таблиц в схеме;
 *     миграция 0053 сносит их и закрывает историю задним числом;
 *   · тексты аудита: order.closed по-русски и по-узбекски.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n"));

describe("арифметика закрытия", () => {
  const base = { total: 1_250_000, claimed: 1_200_000, paidBefore: 1_200_000, extra: 0 };
  it("сдал ровно заявленное — ни недостачи, ни доплаты; остаток — долг", () => {
    expect(closeMath({ ...base, cashReceived: 1_200_000 })).toEqual({ shortage: 0, surplusCash: 0, added: 0, remainder: 50_000 });
  });
  it("сдал меньше — недостача курьера, магазину не долг", () => {
    expect(closeMath({ ...base, cashReceived: 1_000_000 })).toEqual({ shortage: 200_000, surplusCash: 0, added: 0, remainder: 50_000 });
  });
  it("сдал больше — лишнее ложится платежом офиса на остаток", () => {
    expect(closeMath({ ...base, cashReceived: 1_250_000 })).toEqual({ shortage: 0, surplusCash: 50_000, added: 50_000, remainder: 0 });
  });
  it("карта или перевод сверху — тоже платёж; сверх суммы заказа — отказ", () => {
    expect(closeMath({ ...base, cashReceived: 1_200_000, extra: 50_000 }).remainder).toBe(0);
    expect(() => closeMath({ ...base, cashReceived: 1_200_000, extra: 50_000.01 })).toThrow(/больше суммы заказа/);
    expect(() => closeMath({ ...base, cashReceived: 1_300_000 })).toThrow(/больше суммы заказа/);
  });
  it("копейки сравниваются в тийинах, отрицательное — отказ", () => {
    expect(closeMath({ total: 0.3, claimed: 0, cashReceived: 0.1, paidBefore: 0.2, extra: 0 }).remainder).toBe(0);
    expect(() => closeMath({ ...base, cashReceived: -1 })).toThrow(/отрицательной/);
  });
});

describe("наличные на руках", () => {
  const row = (o: Partial<{ id: number; method: string; type: string; receivedAt: Date | null; reversalOf: number | null; status: string; amount: string }>) => ({
    id: 1, amount: "100.00", method: "cash", status: "paid", type: "payment", reversalOf: null, receivedAt: null, bankConfirmedAt: null, bankRef: null,
    notes: null, createdAt: new Date(), paidAt: null, createdBy: 7, createdByName: "Курьер", createdByRole: "courier", ...o,
  }) as Parameters<typeof onHandsOf>[0][number];
  it("считаются наличные поля без отметки; безнал, полученные и сторно-пары — нет", () => {
    const rows = [
      row({ id: 1 }),
      row({ id: 2, receivedAt: new Date() }),
      row({ id: 3, method: "transfer" }),
      row({ id: 4, status: "reversed" }), row({ id: 5, reversalOf: 4, amount: "-100.00" }),
      row({ id: 6, type: "debt" }),
    ];
    expect(onHandsOf(rows).map(r => r.id)).toEqual([1]);
  });
  it("офис — директор, оператор, суперадмин; курьер и агент — поле", () => {
    expect([...OFFICE_ROLES].sort()).toEqual(["ceo", "operator", "superadmin"]);
  });
});

describe("проводка", () => {
  const shared = read("api/services/order-shared.ts");
  it("оплата офиса получена сразу и закрывает расчёт; полевые наличные открывают его заново", () => {
    expect(shared).toContain('const inOffice = input.method === "cash" && office;');
    expect(shared).toContain("receivedAt: inOffice ? new Date() : null,");
    // С 20.09.2026 закрытие трогается только у доставленного заказа: оплата не отмечает доставку.
    expect(shared).toContain('const closing = office ? { closedAt: new Date(), closedBy: userId } : input.method === "cash" ? { closedAt: null, closedBy: null } : null;');
    expect(shared).toContain('if (order.status === "delivered") {');
  });
  it("второй круг заказа снимает закрытие; недостача остаётся", () => {
    const reopen = read("api/services/order-reopen.ts");
    expect(reopen).toMatch(/closedAt: null,\s*closedBy: null,/);
    expect(reopen).not.toContain("courierShortage");
  });
  it("закрытие — только доставленного, один раз, под замком, строгим следом в журнале", () => {
    const svc = read("api/services/order-close.ts");
    expect(svc).toContain('if (o.status !== "delivered") throw badRequest');
    expect(svc).toContain("if (o.closedAt) throw badRequest");
    expect(svc).toMatch(/isNull\(orders\.deletedAt\)\)\)\.for\("update"\)/);
    expect(svc).toContain('action: "order.closed"');
    expect(svc).toContain("{ strict: true }");
    expect(svc).toContain("if (m.remainder > 0 && !input.acceptDebt) {");
  });
});

describe("ручки", () => {
  const router = read("api/order-router.ts");
  it("money — читателям заказа; close и confirmBank — офису правом приёма денег", () => {
    expect(router).toMatch(/money: orderReaderQuery/);
    expect(router).toMatch(/close: operatorQuery\.use\(can\("payments\.accept"\)\)/);
    expect(router).toMatch(/confirmBank: operatorQuery\.use\(can\("payments\.accept"\)\)/);
    expect(router).toContain("await assertOrderVisible(ctx.db, ctx.tenant.id, input.orderId, { id: ctx.user.id, role: ctx.user.role });\n      return OrderCloseService.money(");
  });
  it("список знает «ждут расчёта», сводка — счётчик", () => {
    expect(router).toContain("awaitingMoney: z.boolean().optional(),");
    expect(router).toContain("awaitingMoneyCount: Number(awaiting?.n ?? 0),");
    const readSvc = read("api/services/order-read.ts");
    expect(readSvc).toContain('if (f.awaitingMoney) conditions.push(eq(orders.status, "delivered"), isNull(orders.closedAt));');
    expect(readSvc).toContain("closedAt: orders.closedAt,");
  });
});

describe("KPI и контроль", () => {
  it("недостача в зарплату — из закрытых заказов", () => {
    const kpi = read("api/services/kpi.ts");
    expect(kpi).toContain("OrderCloseService.shortageIn(db as never, tenantId, agentId, periodStart, periodEnd)");
    expect(kpi).not.toContain("services/cash");
  });
  it("индекс риска: недостача и наличные дольше суток есть; долга и лимита кассы нет", () => {
    expect(Object.keys(RISK)).not.toContain("debt");
    expect(Object.keys(RISK)).not.toContain("overLimit");
    const quiet: RiskSignals = { shortageCount: 0, shortageMoney: 0, onHand: 0, onHandSince: null, nonCashOverdueCount: 0, nonCashOverdueMoney: 0, delivered: 0, deliveredOld: 0, unconfirmed: 0, disputed: 0, reopened: 0, returned: 0, agentOrders: 0, discounted: 0, visits: 0, suspiciousVisits: 0 };
    const now = new Date("2026-09-18T12:00:00Z");
    expect(riskScore({ ...quiet, onHand: 500, onHandSince: new Date("2026-09-17T10:00:00Z") }, now).factors).toEqual([{ code: "cashLate", points: 15, money: 500, hours: 26 }]);
    expect(riskScore({ ...quiet, onHand: 500, onHandSince: new Date("2026-09-18T10:00:00Z") }, now).factors).toEqual([]);
    const control = read("api/services/control.ts");
    expect(control).toContain("OrderCloseService.onHands(db, tenantId)");
    expect(control).toContain("orders.shortageUserId");
  });
});

describe("кассы нет", () => {
  it("ни сервиса, ни роутера, ни крона, ни экрана", () => {
    for (const p of ["api/services/cash.ts", "api/cash-router.ts", "api/cron/cash-evening.ts", "src/pages/Cash.tsx", "src/components/cash", "src/lib/cash-labels.ts"]) {
      expect(existsSync(join(ROOT, p)), `${p} должен быть удалён`).toBe(false);
    }
    expect(read("api/router.ts")).not.toMatch(/cash:\s/);
    expect(read("src/const.ts")).not.toContain('"/cash"');
    expect(read("src/App.tsx")).not.toContain('path="/cash"');
    expect(read("api/cron/scheduler.ts")).not.toContain("cash-evening");
  });
  it("в схеме нет таблиц кассы, PIN и её настроек; есть поля расчёта", () => {
    const schema = read("db/schema.ts");
    for (const s of ['"cash_documents"', '"cash_days"', '"cash_categories"', "cash_pin_hash", "cash_limit", "cash_deadline", "cash_start_day"]) expect(schema).not.toContain(s);
    for (const s of ['closedAt:         timestamp("closed_at")', 'courierShortage:  decimal("courier_shortage"', 'shortageUserId:   bigint("shortage_user_id"', 'receivedAt: timestamp("received_at")', "bank_confirm_days"]) expect(schema).toContain(s);
  });
  it("миграции: 0053 сносит кассу и добавляет расчёт; 0054 и 0055 закрывают историю задним числом — по одному идемпотентному выражению", () => {
    const sql = readFileSync(join(ROOT, "db/migrations/0053_order_close.sql"), "utf8");
    for (const s of ["DROP TABLE `cash_documents`", "DROP TABLE `cash_days`", "DROP TABLE `cash_categories`", "ADD `closed_at` timestamp", "ADD `courier_shortage` decimal(12,2)", "ADD `received_at` timestamp", "DROP COLUMN `cash_pin_hash`"]) expect(sql).toContain(s);
    expect(sql).not.toMatch(/^UPDATE/m);
    expect(sql.trimEnd().endsWith("--> statement-breakpoint")).toBe(false);
    expect(readFileSync(join(ROOT, "db/migrations/0054_orders_closed_history.sql"), "utf8")).toMatch(/^UPDATE `orders` SET `closed_at` = COALESCE\(`delivered_at`, `updated_at`, `created_at`\) WHERE `status` = 'delivered' AND `closed_at` IS NULL;/);
    expect(readFileSync(join(ROOT, "db/migrations/0055_payments_received_history.sql"), "utf8")).toMatch(/^UPDATE `payments` SET `received_at` = `created_at` WHERE `payment_method` = 'cash' AND `received_at` IS NULL;/);
  });
  it("тексты аудита: закрытие расчёта названо, кассовых действий нет", () => {
    const texts = read("contracts/audit-text.ts");
    expect(texts).toMatch(/"order\.closed": \{ ru: "[^"]+", uz: "[^"]+" \}/);
    expect(texts).not.toMatch(/"cash\./);
    expect(read("src/pages/AuditLog.tsx")).toContain('"order.closed":');
  });
});

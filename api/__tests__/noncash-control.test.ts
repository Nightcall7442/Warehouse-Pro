/**
 * Безнал под выпиской: карта и перевод — обещание денег, пока кассир не
 * сверил их с банком.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · состояние платежа: в пути → просрочен ровно после срока; подтверждён и
 *     сторно — вне зависимости от возраста;
 *   · свой платёж подтверждает только директор; чужой — любой кассир;
 *   · подтверждение — тем же правом, что приём денег; срок — только директор;
 *   · повтор, сторнированный и наличный платёж — отказ (текст в сервисе);
 *   · подтверждение пишется в журнал действий и названо по-русски;
 *   · вечерний крон отдаёт директору безнал в пути и просрочку по людям;
 *   · вкладка есть, «не пришло» ведёт в сторно платежа, выгрузка не глушится;
 *   · сотрудник в кошельке видит свои переводы, которые ещё не сверили;
 *   · миграция 0046 добавляет ровно три поля платежа и срок в настройках.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nonCashStatus, canConfirm, NON_CASH } from "../services/noncash";
import { nonCashLines } from "../cron/cash-evening";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

const at = (iso: string) => new Date(iso);

describe("состояние платежа", () => {
  const base = { status: "paid", bankConfirmedAt: null };
  it("в пути до срока включительно, просрочен — строго после", () => {
    const created = at("2026-09-10T08:00:00Z");
    expect(nonCashStatus({ ...base, createdAt: created }, at("2026-09-13T07:59:59Z"), 3)).toBe("transit");
    expect(nonCashStatus({ ...base, createdAt: created }, at("2026-09-13T08:00:00Z"), 3)).toBe("transit");
    expect(nonCashStatus({ ...base, createdAt: created }, at("2026-09-13T08:00:01Z"), 3)).toBe("overdue");
  });
  it("подтверждённый и сторнированный не стареют", () => {
    const old = at("2026-01-01T00:00:00Z"), now = at("2026-09-16T00:00:00Z");
    expect(nonCashStatus({ status: "paid", bankConfirmedAt: at("2026-01-02T00:00:00Z"), createdAt: old }, now, 3)).toBe("confirmed");
    expect(nonCashStatus({ status: "reversed", bankConfirmedAt: null, createdAt: old }, now, 3)).toBe("reversed");
    // Сторно после подтверждения — всё равно сторно: денег нет.
    expect(nonCashStatus({ status: "reversed", bankConfirmedAt: at("2026-01-02T00:00:00Z"), createdAt: old }, now, 3)).toBe("reversed");
  });
  it("срок из настроек, а не зашитый", () => {
    const created = at("2026-09-10T08:00:00Z"), now = at("2026-09-12T08:00:01Z");
    expect(nonCashStatus({ ...base, createdAt: created }, now, 1)).toBe("overdue");
    expect(nonCashStatus({ ...base, createdAt: created }, now, 7)).toBe("transit");
  });
});

describe("кто подтверждает", () => {
  it("свой — только директор; чужой — любой; платёж без автора (1С) — любой", () => {
    expect(canConfirm({ id: 7, role: "operator" }, 7)).toBe(false);
    expect(canConfirm({ id: 7, role: "operator" }, 8)).toBe(true);
    expect(canConfirm({ id: 7, role: "ceo" }, 7)).toBe(true);
    expect(canConfirm({ id: 7, role: "operator" }, null)).toBe(true);
  });
  it("безнал — это карта и перевод, наличные сюда не входят", () => {
    expect([...NON_CASH].sort()).toEqual(["card", "transfer"]);
  });
});

describe("права и отказы", () => {
  const router = read("api/cash-router.ts");
  const svc = read("api/services/noncash.ts");
  it("список, сводка и «пришло» — кассир; срок подтверждения — только директор", () => {
    for (const p of ["nonCash", "nonCashSummary", "bankConfirm"]) expect(router, `${p} не cashierQuery`).toMatch(new RegExp(`${p}:\\s*cashierQuery`));
    expect(router).toMatch(/saveSettings:\s*adminQuery[\s\S]*?bankConfirmDays: z\.number\(\)\.int\(\)\.min\(1\)\.max\(60\)/);
  });
  it("отказы названы: свой, повтор, сторно, не безнал; строки берутся под замок", () => {
    expect(svc).toContain("Подтвердить свой же платёж нельзя");
    expect(svc).toContain("уже подтверждён");
    expect(svc).toContain("сторнирован — подтверждать нечего");
    expect(svc).toContain("не карта и не перевод");
    expect(svc).toMatch(/inArray\(payments\.id, ids\)\)\)\.for\("update"\)/);
    // Подтверждается только то, что ещё не подтверждено — даже если замок обошли.
    expect(svc).toMatch(/inArray\(payments\.id, ids\), isNull\(payments\.bankConfirmedAt\)\)/);
  });
  it("подтверждение попадает в журнал действий и названо по-русски и по-узбекски", () => {
    expect(svc).toContain('action: "payment.bank_confirm"');
    expect(read("contracts/audit-text.ts")).toMatch(/"payment\.bank_confirm": \{ ru: "[^"]+", uz: "[^"]+" \}/);
    expect(read("src/pages/AuditLog.tsx")).toContain('"payment.bank_confirm":');
  });
});

describe("вечерний крон", () => {
  const nc = (over: Array<[string, number, number]>, transit = { count: 0, total: 0 }) => ({
    days: 3, transit, overdue: { count: over.reduce((s, o) => s + o[1], 0), total: over.reduce((s, o) => s + o[2], 0) },
    confirmedToday: { count: 0, total: 0 },
    byEmployee: over.map(([name, count, total], i) => ({ id: i + 1, name, count, total, overdueCount: count, overdueTotal: total })),
  });
  it("молчит, когда в пути пусто", () => {
    expect(nonCashLines(nc([]))).toBe("");
  });
  it("в пути — цифрой; просрочка — по людям, с экранированием имени", () => {
    const text = nonCashLines(nc([["Ali <b>", 2, 1_200_000]], { count: 1, total: 300_000 }));
    expect(text).toContain("Безнал в пути: 3 на");
    expect(text).toContain("дольше 3 дн.: 2 на");
    expect(text).toContain("Ali &lt;b&gt; — 2 на");
    expect(text).not.toContain("<b>Ali");
  });
  it("крон не пропускает организацию, у которой всё сдано, но безнал просрочен", () => {
    const cron = read("api/cron/cash-evening.ts");
    expect(cron).toContain("if (withCash.length === 0 && o.dayClosed && nc.overdue.count === 0) continue;");
    expect(cron).toContain("nonCashLines(nc)");
  });
});

describe("экран", () => {
  const page = read("src/pages/Cash.tsx");
  const tab = read("src/components/cash/NonCashTab.tsx");
  it("вкладка «Безнал» на месте, просрочка видна с любой вкладки", () => {
    expect(page).toContain('["noncash", t("Безнал", "Naqdsiz")]');
    expect(page).toContain('data-testid="noncash-overdue-notice"');
    expect(page).toContain('<NonCashTab');
  });
  it("«не пришло» — сторно платежа тем же путём, что везде; «пришло» — пакетом с подтверждением", () => {
    expect(tab).toContain("trpc.shop.reversePayment.useMutation");
    expect(tab).toContain("trpc.cash.bankConfirm.useMutation");
    expect(tab).toContain("Отменить подтверждение нельзя — только сторно платежа");
  });
  it("свой платёж в списке не выбирается — подтвердит другой", () => {
    expect(tab).toContain("(isCeo || r.createdBy !== userId)");
    expect(tab).toContain('t("свой — подтвердит другой"');
  });
  it("выгрузка — русская и не глушится условием", () => {
    expect(tab).toMatch(/name: "Безнал"/);
    expect(tab).toMatch(/header: "Операция банка"/);
    expect(tab).not.toMatch(/disabled=\{[^}]*\}\s*onClick=\{\(\) => exportToExcel/);
  });
  it("сотрудник видит в кошельке переводы, которые ещё не сверили", () => {
    expect(read("api/services/cash.ts")).toContain("NonCashService.mineTransit(db, tenantId, userId)");
    expect(read("src/components/cash/MyCashCard.tsx")).toContain("m.nonCashTransit.count > 0");
  });
});

describe("миграция 0046", () => {
  const sql = readFileSync(join(ROOT, "db/migrations/0046_noncash_control.sql"), "utf8");
  it("три поля платежа, срок в настройках, ключ на пользователя — и ничего лишнего", () => {
    const stmts = sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(5);
    expect(sql).toContain("ALTER TABLE `payments` ADD `bank_confirmed_at` timestamp;");
    expect(sql).toContain("ALTER TABLE `payments` ADD `bank_confirmed_by` bigint unsigned;");
    expect(sql).toContain("ALTER TABLE `payments` ADD `bank_ref` varchar(64);");
    expect(sql).toContain("ALTER TABLE `settings` ADD `bank_confirm_days` int DEFAULT 3 NOT NULL;");
    expect(sql).toMatch(/FOREIGN KEY \(`bank_confirmed_by`\) REFERENCES `users`\(`id`\) ON DELETE restrict/);
    expect(sql.trimEnd().endsWith("--> statement-breakpoint")).toBe(false);
  });
});

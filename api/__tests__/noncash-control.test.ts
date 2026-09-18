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
 *   · «пришло» — из карточки заказа, тем же правом, что приём денег
 *     (касса убрана 18.09.2026 — безнал живёт в заказе);
 *   · миграция 0046 добавляет ровно три поля платежа и срок в настройках.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nonCashStatus, canConfirm, NON_CASH } from "../services/noncash";

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
  const router = read("api/order-router.ts");
  const svc = read("api/services/noncash.ts");
  it("«пришло» — из карточки заказа, правом приёма денег", () => {
    expect(router).toMatch(/confirmBank:\s*operatorQuery\.use\(can\("payments\.accept"\)\)/);
    expect(router).toContain("NonCashService.confirm(getDb(), ctx.tenant.id");
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

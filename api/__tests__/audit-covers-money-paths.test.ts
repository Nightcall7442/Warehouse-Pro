/**
 * Журнал действий покрывает то, о чём спорят о деньгах, и след у денежных
 * действий — часть сделки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В журнале было 16 действий, и мимо него шли: цена и себестоимость товара,
 * кредитный лимит магазина, цена в прайс-листе, настройки (порог скидки),
 * проведение возврата и прихода, перемещение между складами, ключи API,
 * настройки 1С, а уборка самого журнала — по одной куке суперадмина.
 * Запись шла «мимо» транзакции и глотала ошибки: правка проходила, следа нет.
 *
 * Нарочная поломка: убери `{ strict: true }` у product.updated — второй
 * тест назовёт файл; убери вызов recordAudit из api-key-router.revoke —
 * первый назовёт действие.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { recordAudit, changedFields } from "../services/audit-log";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/** Действие → файл, где оно обязано писаться. */
const COVERAGE: Array<[string, string]> = [
  ["product.updated",            "api/product-router.ts"],
  ["product.deleted",            "api/product-router.ts"],
  ["price_list.item_set",        "api/price-list-router.ts"],
  ["price_list.deleted",         "api/price-list-router.ts"],
  ["shop.credit_limit_changed",  "api/shop-router.ts"],
  ["settings.updated",           "api/settings-router.ts"],
  ["onec.config_saved",          "api/onec-router.ts"],
  ["api_key.created",            "api/api-key-router.ts"],
  ["api_key.revoked",            "api/api-key-router.ts"],
  ["api_key.status",             "api/api-key-router.ts"],
  ["return.status",              "api/returns-router.ts"],
  ["arrival.completed",          "api/services/arrival.ts"],
  ["stock.transfer_completed",   "api/warehouse-multi-router.ts"],
  ["audit.purged",               "api/audit-router.ts"],
  // уже были — держим, чтобы не пропали
  ["order.create",               "api/order-router.ts"],
  ["order.payment_recorded",     "api/services/order-settlement.ts"],
  ["payment.reverse",            "api/services/payment.ts"],
  ["stock.adjusted",             "api/services/stock.ts"],
  ["supplier.return_goods",      "api/supplier-router.ts"],
];

/** Действия, след которых обязан быть в транзакции (strict), — и файл, где смотреть. */
const STRICT: Array<[string, string]> = [
  ["product.updated",           "api/product-router.ts"],
  ["shop.credit_limit_changed", "api/shop-router.ts"],
  ["settings.updated",          "api/settings-router.ts"],
  ["return.status",             "api/returns-router.ts"],
  ["arrival.completed",         "api/services/arrival.ts"],
  ["stock.transfer_completed",  "api/warehouse-multi-router.ts"],
];

describe("журнал действий", () => {
  it("каждое денежное действие пишется там, где положено", () => {
    const missing = COVERAGE.filter(([action, file]) => !read(file).includes(`action: "${action}"`)).map(([a, f]) => `${a} в ${f}`);
    expect(missing).toEqual([]);
  });

  it("денежные следы — строгие и внутри транзакции (tx, strict: true)", () => {
    const weak: string[] = [];
    for (const [action, file] of STRICT) {
      const src = read(file);
      const at = src.indexOf(`action: "${action}"`);
      const call = src.slice(src.lastIndexOf("recordAudit(", at), src.indexOf(");", at) + 2);
      if (!/recordAudit\(tx\b/.test(call) || !/\{\s*strict:\s*true\s*\}/.test(call)) weak.push(`${action} в ${file}`);
    }
    expect(weak, "след не в транзакции или не строгий").toEqual([]);
  });

  it("строгий режим пробрасывает ошибку записи; мягкий — глотает", async () => {
    const failing = { insert: () => ({ values: async () => { throw new Error("audit_log unavailable"); } }) } as never;
    const entry = { tenantId: 1, action: "x" };
    await expect(recordAudit(failing, entry)).resolves.toBeUndefined();
    await expect(recordAudit(failing, entry, { strict: true })).rejects.toThrow("audit_log unavailable");
  });

  it("changedFields: числа сравниваются как числа, нетронутое не считается правкой", () => {
    const before = { unitPrice: "100.00", costPrice: "80.00", status: "active", reorderPoint: "10.00" };
    expect(changedFields(before, { unitPrice: "100", costPrice: "85.00", status: "active" }, ["unitPrice", "costPrice", "status", "reorderPoint"]))
      .toEqual({ costPrice: { from: "80.00", to: "85.00" } });
    expect(changedFields({ creditLimit: null }, { creditLimit: "500000" }, ["creditLimit"])).toEqual({ creditLimit: { from: null, to: "500000" } });
    expect(changedFields({ creditLimit: "500000.00" }, { name: "x" }, ["creditLimit"])).toEqual({});
  });

  it("мягких вызовов без await не осталось; уборка журнала — только с кодом второго фактора", () => {
    for (const f of ["api/user-router.ts", "api/services/stock.ts"]) {
      expect(read(f)).not.toMatch(/^\s+recordAudit\(/m);
    }
    const audit = read("api/audit-router.ts");
    expect(audit).toContain("const step = await checkTotpStepUp(ctx.db, ctx.user.id, input.totpCode);");
    expect(audit.indexOf("checkTotpStepUp(")).toBeLessThan(audit.indexOf("await purgeOldAuditLogs("));
    expect(read("src/components/superadmin/TenantDetail.tsx")).toContain("totpCode: purgeCode.trim()");
  });

  it("пароль 1С в журнал не попадает", () => {
    const src = read("api/onec-router.ts");
    const at = src.indexOf('action: "onec.config_saved"');
    const meta = src.slice(at, src.indexOf("});", at));
    expect(meta).not.toContain("password");
    vi.restoreAllMocks();
  });
});

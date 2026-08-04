import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * `shops.debt` is derived, not maintained by hand — every mutation that can
 * change what a shop owes calls recalcShopDebt() and lets it re-read the
 * underlying orders, payments and returns. See api/services/shop-debt.ts for
 * why: the previous approach, where each call site nudged the balance by its
 * own delta, leaked real money out of the debtor list three separate times
 * (a delivery that booked nothing because the order wasn't marked "в долг";
 * a payment that subtracted from a balance nothing had ever been added to;
 * two helpers in one transaction where the second misread state the first had
 * just written).
 *
 * These tests guard that property at the source level, because the failure was
 * never a wrong formula — it was a *new code path that forgot the balance
 * existed*. A unit test of any single mutation cannot catch the next one of
 * those; a rule about the whole codebase can.
 */

const API_DIR = join(__dirname, "..");
const DEBT_HELPER = join("services", "shop-debt.ts");

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTypeScript(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/** Statements that assign to the shops.debt column, in SQL or via the query builder. */
const DEBT_WRITE_PATTERNS = [
  /UPDATE\s+shops[\s\S]{0,80}?\bSET\b[\s\S]{0,40}?\bdebt\s*=/i, // raw SQL
  /\.set\(\s*\{[^}]*\bdebt\s*:/,                                 // drizzle .set({ debt: ... })
];

describe("shops.debt is written in exactly one place", () => {
  it("no module outside services/shop-debt.ts assigns to shops.debt", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const rel = relative(API_DIR, file);
      if (rel === DEBT_HELPER || rel === DEBT_HELPER.split(sep).join("/")) continue;

      const source = readFileSync(file, "utf8");
      if (DEBT_WRITE_PATTERNS.some(p => p.test(source))) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These modules assign to shops.debt directly:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nThe balance is derived, not maintained incrementally. Write the ` +
        `orders/payments/returns rows that justify the change, then call ` +
        `recalcShopDebt(tx, tenantId, shopId) — see services/shop-debt.ts.`,
    ).toEqual([]);
  });

  it("the helper's own statement is a full recompute, not a delta", () => {
    const helper = readFileSync(join(API_DIR, DEBT_HELPER), "utf8");

    // A delta update reads the column it writes ("debt = debt + x"); a
    // recompute never does. This is the property that makes the write
    // idempotent and safe to run twice in one transaction.
    expect(helper).not.toMatch(/\bdebt\s*=\s*[\s\S]{0,30}\bdebt\b\s*[+-]/i);
    expect(helper).toMatch(/SET\s+s\.debt\s*=\s*GREATEST\(0,/i);
  });
});

describe("every path that can change what a shop owes re-derives the balance", () => {
  /**
   * Writing an order/payment/return row is what *creates* an obligation; the
   * balance only reflects it once recalcShopDebt runs. A module that writes
   * those rows but never calls the helper has, by construction, left the
   * balance stale — which is exactly how the original bugs shipped.
   */
  const MUTATORS = [
    "services/order.ts",
    "services/payment.ts",
    "courier-router.ts",
    "returns-router.ts",
    "webhooks/onec.ts",
  ];

  it.each(MUTATORS)("%s calls recalcShopDebt", (relPath) => {
    const source = readFileSync(join(API_DIR, relPath.split("/").join(sep)), "utf8");
    expect(source).toMatch(/recalcShopDebt\s*\(/);
  });
});

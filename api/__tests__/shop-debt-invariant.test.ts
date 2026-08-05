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

describe("the two return routes cannot credit the same goods twice", () => {
  /**
   * An order's goods can come back either by marking the order itself
   * cancelled/returned, or by completing a return document ("Возвраты")
   * against it. Both are supported. Applying both to the same order used to
   * double-count, in stock and in money:
   *
   *   order 10 units delivered → return document for 6 completed → order then
   *   marked returned
   *     stock:  240 → 246 → 256   (six units invented; 250 is correct)
   *     debt:   273 000 → 156 000 → 0   (the 78 000 owed on an *unrelated*
   *                                      order in the same shop wiped out)
   *
   * Those numbers are measured, not hypothetical — removing either guard
   * reproduces them exactly. The final GREATEST(0, …) hides the money half on
   * a shop whose only order this is, which is what let it go unnoticed.
   */

  it("recalcShopDebt ignores return documents whose order is already written off", () => {
    const helper = readFileSync(join(API_DIR, DEBT_HELPER.split("/").join(sep)), "utf8");
    // The returns subtraction must be conditional on the linked order still
    // counting — otherwise its value is deducted on top of an order that
    // already contributed zero.
    const returnsClause = helper.slice(helper.indexOf("FROM returns"));
    expect(returnsClause).toMatch(/NOT\s+EXISTS/i);
    expect(returnsClause).toMatch(/status\s+IN\s*\(\s*'cancelled'\s*,\s*'returned'\s*\)/i);
  });

  it("updateStatus sizes its stock delta net of units already returned by document", () => {
    const source = readFileSync(join(API_DIR, join("services", "order.ts")), "utf8");
    // effectiveQty decides how many units a status change moves. It has to
    // subtract what a completed return document already put back on the shelf.
    expect(source).toMatch(/returnedByProduct/);
    expect(source).toMatch(/eq\(\s*returns\.status\s*,\s*"completed"\s*\)/);
    const effective = source.slice(source.indexOf("const effectiveQty"));
    expect(effective.slice(0, 400)).toMatch(/base\s*-\s*alreadyReturned/);
  });

  it("completing a return is refused when its order is already cancelled/returned", () => {
    const source = readFileSync(join(API_DIR, "returns-router.ts"), "utf8");
    // The reverse direction: the order already credited every unit back, so
    // the document must not run at all.
    expect(source).toMatch(/linkedOrder/);
    expect(source).toMatch(/уже.*(отменён|возвращён)|зачислило бы тот же товар/);
  });
});

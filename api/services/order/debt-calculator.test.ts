import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { OrderDebtCalculator } from "./debt-calculator";
import type { Tx } from "./types";

/**
 * The receivable rules. Each case is a decision the four lifecycle operations used
 * to re-derive inline, and getting one wrong overstates or wipes a shop's debt.
 *
 * The fake tx records the SQL fragments it is handed, so a test can assert both
 * *whether* the debt moved and in which direction.
 */

const executed: Array<{ text: string; params: unknown[] }> = [];

const dialect = new MySqlDialect();

function fakeTx(): Tx {
  return {
    execute: vi.fn(async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      executed.push({ text, params });
      return [];
    }),
  } as unknown as Tx;
}

const creditOrder = { status: "new", shopId: 7, total: "1500.00", paymentMethod: "debt" };
const cashOrder = { ...creditOrder, paymentMethod: "cash" };

let tx: Tx;

beforeEach(() => {
  executed.length = 0;
  tx = fakeTx();
});

/** The signed amount the statement applied, read back from the bound params. */
function movedBy(): number | null {
  const stmt = executed.find(e => e.text.includes("UPDATE shops"));
  if (!stmt) return null;
  const numeric = stmt.params.find(p => typeof p === "number");
  return typeof numeric === "number" ? numeric : null;
}

describe("adjustShopDebt", () => {
  it("does nothing for a zero delta", async () => {
    await OrderDebtCalculator.adjustShopDebt(tx, 1, 7, 0);
    expect(executed).toHaveLength(0);
  });

  it("clamps at zero so a double reversal cannot drive the debt negative", async () => {
    await OrderDebtCalculator.adjustShopDebt(tx, 1, 7, -500);
    expect(executed[0]!.text).toContain("GREATEST(0");
    expect(movedBy()).toBe(-500);
  });
});

describe("onCreate", () => {
  it("books the total for a credit order", async () => {
    await OrderDebtCalculator.onCreate(tx, 1, 7, "debt", 1500);
    expect(movedBy()).toBe(1500);
  });

  it("ignores non-credit payment methods", async () => {
    for (const method of ["cash", "card", "transfer", undefined]) {
      await OrderDebtCalculator.onCreate(tx, 1, 7, method, 1500);
    }
    expect(executed).toHaveLength(0);
  });

  it("ignores a zero or negative total", async () => {
    await OrderDebtCalculator.onCreate(tx, 1, 7, "debt", 0);
    await OrderDebtCalculator.onCreate(tx, 1, 7, "debt", -10);
    expect(executed).toHaveLength(0);
  });
});

describe("onCancel", () => {
  it("takes the receivable back", async () => {
    await OrderDebtCalculator.onCancel(tx, 1, creditOrder);
    expect(movedBy()).toBe(-1500);
  });

  it("leaves cash orders alone", async () => {
    await OrderDebtCalculator.onCancel(tx, 1, cashOrder);
    expect(executed).toHaveLength(0);
  });
});

describe("onStatusCancel / onDelete", () => {
  it("reverses while the order still holds stock", async () => {
    await OrderDebtCalculator.onStatusCancel(tx, 1, { ...creditOrder, status: "processing" });
    expect(movedBy()).toBe(-1500);
  });

  it("leaves a completed order's debt standing — the goods changed hands", async () => {
    await OrderDebtCalculator.onStatusCancel(tx, 1, { ...creditOrder, status: "completed" });
    await OrderDebtCalculator.onDelete(tx, 1, { ...creditOrder, status: "completed" });
    expect(executed).toHaveLength(0);
  });

  it("withdraws the receivable when an open credit order is deleted", async () => {
    await OrderDebtCalculator.onDelete(tx, 1, creditOrder);
    expect(movedBy()).toBe(-1500);
  });
});

describe("onRestore", () => {
  it("brings the receivable back with the order", async () => {
    await OrderDebtCalculator.onRestore(tx, 1, creditOrder);
    expect(movedBy()).toBe(1500);
  });

  it("does not resurrect a debt for an order that was completed", async () => {
    await OrderDebtCalculator.onRestore(tx, 1, { ...creditOrder, status: "completed" });
    expect(executed).toHaveLength(0);
  });
});

describe("onTotalChanged", () => {
  it("moves the receivable by the difference, not the new total", async () => {
    await OrderDebtCalculator.onTotalChanged(tx, 1, creditOrder, 1200);
    expect(movedBy()).toBe(-300);
  });

  it("increases it when a discount is removed", async () => {
    await OrderDebtCalculator.onTotalChanged(tx, 1, creditOrder, 1800);
    expect(movedBy()).toBe(300);
  });

  it("writes nothing when the total is unchanged", async () => {
    await OrderDebtCalculator.onTotalChanged(tx, 1, creditOrder, 1500);
    expect(executed).toHaveLength(0);
  });

  it("ignores a completed order — its debt is settled business", async () => {
    await OrderDebtCalculator.onTotalChanged(tx, 1, { ...creditOrder, status: "completed" }, 1200);
    expect(executed).toHaveLength(0);
  });
});

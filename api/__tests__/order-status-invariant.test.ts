import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  OPEN_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  REVENUE_ORDER_STATUSES,
} from "../lib/order-status";

/**
 * Forty query sites hard-coded `["delivered", "completed"]` as "the sale
 * happened". `completed` is not a member of the `orders.status` enum and no row
 * has ever held it, so each of those was comparing an enum column against a
 * value it cannot take — silently matching nothing, and reported by the
 * type-checker as two dozen errors nobody acted on.
 *
 * These tests keep the lifecycle defined in one place.
 */

const API = join(__dirname, "..");

/** The enum as db/schema.ts declares it. */
const SCHEMA_STATUSES = [
  "new", "processing", "shipped", "pending", "delivered", "cancelled", "returned",
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(API).map(f => ({ path: relative(API, f), text: readFileSync(f, "utf8") }));

describe("order status lifecycle", () => {
  it("covers the schema enum exactly once", () => {
    const named = [...OPEN_ORDER_STATUSES, ...CLOSED_ORDER_STATUSES].sort();
    expect(named).toEqual([...SCHEMA_STATUSES].sort());
    expect(new Set(named).size, "a status may not be both open and closed").toBe(named.length);
  });

  it("treats only real statuses as revenue", () => {
    for (const status of REVENUE_ORDER_STATUSES) {
      expect(SCHEMA_STATUSES, `"${status}" is not a value orders.status can hold`).toContain(status);
    }
  });

  it("has no order status the schema does not define", () => {
    // Guards against `completed` — or any successor — creeping back in as a
    // filter value the column can never match.
    const ghost = /orders\.status,\s*\[[^\]]*"completed"/;
    const offenders = FILES.filter(f => ghost.test(f.text)).map(f => f.path);
    expect(offenders, `these files filter orders.status on a value the enum lacks:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("filters orders.status through the shared sets, not inline literals", () => {
    // `inArray(orders.status, ["delivered"])` written by hand is how the drift
    // started; it must come from lib/order-status.ts instead.
    const inline = /inArray\(\s*orders\.status\s*,\s*\[/g;
    const offenders = FILES
      .filter(f => f.path !== join("lib", "order-status.ts"))
      .flatMap(f => (f.text.match(inline) ?? []).map(() => f.path));

    expect([...new Set(offenders)], "use OPEN/CLOSED/REVENUE_ORDER_STATUSES instead of a literal list")
      .toEqual([]);
  });
});

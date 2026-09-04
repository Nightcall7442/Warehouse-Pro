import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * stock_movements is the history of goods physically entering and leaving a
 * warehouse. It is only worth reading if it is complete — a ledger missing
 * half its entries is worse than none, because it looks authoritative.
 *
 * It had been missing most of them: of the thirteen modules that changed
 * warehouse_stock, only three ever wrote a movement, and the rows they wrote
 * did not say which warehouse. So these tests hold two lines:
 *
 *   1. movements are written through one helper, so they cannot be recorded
 *      with a missing warehouse or an ad-hoc reference type;
 *   2. any module that deducts or adds physical stock records a movement.
 *
 * Reservations are deliberately out of scope: reserving shuffles `reserved`
 * and `available` without moving anything, so it is not a movement. That is
 * also what keeps the ledger reconcilable — the sum of a product's movements
 * is exactly what has entered and left.
 */

const API_DIR = join(__dirname, "..");
const LEDGER_HELPER = join("services", "stock-ledger.ts");

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

const relPath = (file: string) => relative(API_DIR, file).split(sep).join("/");

describe("stock_movements is written in exactly one place", () => {
  it("no module inserts movements directly", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const rel = relPath(file);
      if (rel === LEDGER_HELPER.split(sep).join("/")) continue;
      if (/\.insert\(\s*stockMovements\s*\)/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These modules insert into stock_movements directly:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nUse recordStockMovement(tx, {...}) from services/stock-ledger.ts — ` +
        `it requires a warehouse and a known reason, which a hand-written ` +
        `insert can silently omit.`,
    ).toEqual([]);
  });

  it("the helper always records a warehouse", () => {
    const helper = readFileSync(join(API_DIR, LEDGER_HELPER), "utf8");
    expect(helper).toMatch(/warehouseId:\s*(number|entry\.warehouseId)/);
    // warehouseId is required on the entry type — not optional.
    expect(helper).not.toMatch(/warehouseId\?\s*:/);
  });
});

describe("physical stock changes are recorded", () => {
  /**
   * A module that changes current_stock has moved goods; if it never calls the
   * ledger, that movement is invisible. Modules listed as exempt only ever
   * create empty rows or move reservations, which are not movements.
   */
  const EXEMPT = new Set([
    "services/onec-sync.ts",      // inserts stock rows at 0.00
    "services/ProductService.ts", // inserts stock rows at 0.00
    "product-router.ts",          // deletes/restores rows wholesale on product delete
    "warehouse-router.ts",        // inserts stock rows at 0.00
  ]);

  it("every module that moves physical stock writes to the ledger", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const rel = relPath(file);
      if (rel === LEDGER_HELPER.split(sep).join("/") || EXEMPT.has(rel)) continue;

      const source = readFileSync(file, "utf8");
      // Arithmetic on current_stock means goods moved; setting it on a fresh
      // row (`currentStock: "0.00"`) does not.
      const movesStock =
        /current_stock\s*=\s*current_stock\s*[+-]/.test(source) ||
        /currentStock:\s*sql`[^`]*[+-]/.test(source);
      if (movesStock && !/recordStockMovement\s*\(/.test(source)) offenders.push(rel);
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These modules change current_stock without recording a movement:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nCall recordStockMovement(tx, {...}) alongside the update, in the ` +
        `same transaction, so the shelf and its history cannot disagree.`,
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A stock row satisfies `current_stock = available + reserved` at all times:
 * everything on hand is either free to sell or spoken for by an open order.
 *
 * Nothing enforces that at the database level, so it survives only as long as
 * every write respects it — and the arithmetic makes that easy to check. Since
 * the three columns are linked by one equation, moving just one of them always
 * breaks it. A correct write therefore touches at least two:
 *
 *   goods arrive             current += q, available += q
 *   order reserves them      reserved += q, available -= q
 *   order ships              current -= q, reserved  -= q
 *   order is cancelled       reserved -= q, available += q
 *
 * A statement touching exactly one column is, without exception, a bug — and a
 * silent one, because the row still looks plausible afterwards. This test is
 * cheap insurance against writing that statement, in the same spirit as
 * shop-debt-invariant.test.ts: the balance-sheet bugs that actually shipped
 * were never wrong formulas, they were paths that forgot an obligation existed.
 */

const API_DIR = join(__dirname, "..");
const STOCK_COLUMNS = ["current_stock", "reserved", "available"] as const;
const STOCK_COLUMNS_CAMEL = ["currentStock", "reserved", "available"] as const;

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** The SET clause of each `UPDATE warehouse_stock ... WHERE`, raw-SQL form. */
function rawUpdateClauses(source: string): string[] {
  const clauses: string[] = [];
  const re = /UPDATE\s+warehouse_stock\b([\s\S]*?)\bWHERE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) clauses.push(m[1]);
  return clauses;
}

/** The object literal of each `.update(warehouseStock).set({ ... })`, drizzle form. */
function builderUpdateClauses(source: string): string[] {
  const clauses: string[] = [];
  const re = /\.update\(\s*warehouseStock\s*\)[\s\S]{0,60}?\.set\(\s*\{/gi;
  while (re.exec(source) !== null) {
    // Walk from the opening brace to its match so nested sql`` templates and
    // objects don't truncate the clause early.
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    clauses.push(source.slice(re.lastIndex, i));
  }
  return clauses;
}

function columnsTouched(clause: string): string[] {
  const touched = new Set<string>();
  STOCK_COLUMNS.forEach((c, idx) => {
    // `current_stock =` in SQL, or `currentStock:` in a drizzle object.
    if (new RegExp(`\\b${c}\\s*=`).test(clause)) touched.add(c);
    if (new RegExp(`\\b${STOCK_COLUMNS_CAMEL[idx]}\\s*:`).test(clause)) touched.add(c);
  });
  return [...touched];
}

describe("current_stock = available + reserved", () => {
  it("no stock update moves a single column on its own", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of [...rawUpdateClauses(source), ...builderUpdateClauses(source)]) {
        const touched = columnsTouched(clause);
        if (touched.length === 1) {
          offenders.push(`${rel} — updates only ${touched[0]}`);
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These statements move one stock column in isolation, which breaks\n` +
        `current_stock = available + reserved:\n` +
        offenders.map(o => `  - ${o}`).join("\n") +
        `\n\nEvery real stock movement changes at least two of the three ` +
        `columns — see the table in this test file.`,
    ).toEqual([]);
  });

  it("recognises a correct write and rejects a lone-column one", () => {
    // Guards the detector itself: a test that cannot fail protects nothing.
    const good = "SET current_stock = current_stock - 5, reserved = reserved - 5";
    const bad = "SET current_stock = current_stock - 5";

    expect(columnsTouched(good)).toHaveLength(2);
    expect(columnsTouched(bad)).toEqual(["current_stock"]);
  });
});

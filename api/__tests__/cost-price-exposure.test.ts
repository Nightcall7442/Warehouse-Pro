import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Who may see what the company pays for its goods.
 *
 * Cost price and gross margin are the two numbers a competitor — or a shop
 * negotiating a discount — would most like to have. An agent who knows the
 * cost knows exactly how far the price can be pushed, so this is not an
 * abstract permission question: it changes what happens at the counter.
 *
 * These are source-level assertions because the alternative is a full tRPC
 * caller per role against a mock db, and what actually needs guarding here is
 * a property of the code — which middleware guards a procedure, and which
 * columns a projection ships — not the behaviour of a query.
 */

const api = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

/** Body of a single tRPC procedure, from its name to the next one. */
function procedure(src: string, name: string): string {
  const start = src.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`procedure ${name} not found`);
  const next = src.slice(start + 1).search(/\n {2}[a-zA-Z][a-zA-Z0-9]*:\s*\w+Query/);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

describe("cost price and margin exposure", () => {
  // reportsQuery admits merchandisers and operators, which is right for sales
  // reporting and wrong for the margin. financeQuery is the CEO-only gate.
  describe("finance procedures are CEO-only", () => {
    const src = api("analytics-router.ts");

    it.each(["cogsByProduct", "cogsSummary", "pnl", "pnlByPaymentMethod"])(
      "%s runs under financeQuery",
      (name) => {
        expect(procedure(src, name)).toMatch(new RegExp(`^\\s{2}${name}:\\s*financeQuery`));
      },
    );

    it("financeQuery admits nobody but the CEO", () => {
      const mw = api("middleware.ts");
      const line = mw.split("\n").find(l => l.includes("export const financeQuery"));
      expect(line).toBeDefined();
      expect(line).toMatch(/requireRole\(\["ceo"\]\)/);
    });

    // The point of a separate gate: widening who may administer the system
    // must not quietly widen who may read the margin.
    it("is not an alias of a broader role gate", () => {
      const mw = api("middleware.ts");
      expect(mw).not.toMatch(/export const financeQuery\s*=\s*(adminQuery|operatorQuery|reportsQuery)/);
    });
  });

  describe("product feed", () => {
    const src = api("product-router.ts");

    // listAll is what the mobile app pulls on every order screen, and it runs
    // under fieldSalesQuery — agents and merchandisers included. Shipping the
    // cost here put the buying price on the phone of everyone who negotiates.
    it("listAll never selects costPrice", () => {
      expect(procedure(src, "listAll")).not.toMatch(/costPrice:\s*products\.costPrice/);
    });

    it.each(["list", "getById"])("%s only hands cost to ceo or operator", (name) => {
      const body = procedure(src, name);
      expect(body).toMatch(/ctx\.user\.role === "ceo"/);
      expect(body).toMatch(/ctx\.user\.role === "operator"/);
      expect(body).toMatch(/costPrice:\s*canSeeCost \? /);
    });

    // list() is cached. A key that ignores the caller's role would let the
    // first operator to open the page fill the cache with cost-bearing rows,
    // and serve them to every agent behind them.
    it("list keeps the cost decision in its cache key", () => {
      const body = procedure(src, "list");
      // The whole assignment, not one line: the key is built across several.
      const start = body.indexOf("const cacheKey =");
      const statement = body.slice(start, body.indexOf(";", start));
      expect(statement).toMatch(/canSeeCost/);
    });
  });
});

/**
 * A filter narrows; it must never widen.
 *
 * Every report gained agent, territory and category filters, and each of those
 * is a value the caller supplies. The one thing none of them may do is reach
 * outside the caller's own tenant — so every reporting query has to carry a
 * tenant condition of its own, independent of whatever the caller passed.
 */
describe("report queries stay inside the tenant", () => {
  const REPORTING = ["analytics-router.ts", "reports-router.ts"];

  it.each(REPORTING)("%s scopes every query to ctx.tenant.id", (file) => {
    const src = api(file);

    // Each procedure body, from its name to the next one.
    const starts = [...src.matchAll(/\n {2}(\w+):\s*\w+Query/g)];
    expect(starts.length).toBeGreaterThan(0);

    for (let i = 0; i < starts.length; i++) {
      const from = starts[i].index!;
      const to = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      const body = src.slice(from, to);
      const name = starts[i][1];

      // Procedures that read no table at all have nothing to scope.
      if (!/\.from\(/.test(body)) continue;

      // Either straight from the context, or through a local alias bound to it
      // at the top of the procedure — several do `const tid = ctx.tenant.id`.
      const alias = body.match(/const (\w+)\s*=\s*ctx\.tenant\.id/)?.[1];
      // A plain substring for the alias case: building a RegExp from a template
      // literal silently ate the \s and \b as JS escapes, so it matched nothing.
      const scoped = /tenantId,\s*ctx\.tenant\.id/.test(body)
        || (alias !== undefined && body.includes(`tenantId, ${alias})`));

      expect(scoped, `${name}: no tenant scoping`).toBe(true);
    }
  });

  // The filters are all optional and additive — none of them may replace the
  // tenant condition rather than joining it.
  it("never lets a caller-supplied id stand in for the tenant", () => {
    for (const file of REPORTING) {
      const src = api(file);
      expect(src).not.toMatch(/tenantId,\s*input[?.]/);
      expect(src).not.toMatch(/tenantId,\s*input\./);
    }
  });
});

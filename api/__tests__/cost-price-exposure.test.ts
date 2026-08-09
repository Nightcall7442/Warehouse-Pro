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
      //
      // Помощники revenueOrderConditions / liveOrderConditions ставят
      // eq(orders.tenantId, …) внутри себя (api/lib/order-status.ts) — вместе с
      // фильтром удалённых заказов, который иначе забывали. Для этой проверки
      // они засчитываются как ограничение по арендатору: иначе тест толкал бы
      // обратно к ручному условию, то есть ровно к той форме, которую и
      // потребовалось убрать.
      const viaHelper = /(revenueOrderConditions|liveOrderConditions)\(\s*(ctx\.tenant\.id|\w+)\s*\)/.test(body);
      const scoped = viaHelper
        || /tenantId,\s*ctx\.tenant\.id/.test(body)
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

/**
 * Data that belongs to management, reachable by anyone who is merely signed in.
 *
 * Four procedures sat behind authedQuery — the guard that means "has a session"
 * and nothing more — while returning integration keys, the buying price, other
 * people's commissions and the whole team's quotas. Three of them had siblings
 * in the same file that did check, which is how the gap stayed invisible: the
 * file looked guarded.
 */
describe("management data is not reachable by every signed-in user", () => {
  function procedureBody(file: string, name: string): string {
    const src = api(file);
    const start = src.indexOf(`  ${name}:`);
    expect(start, `${file}: ${name} not found`).toBeGreaterThan(-1);
    const next = src.slice(start + 1).search(/\n {2}[a-zA-Z][a-zA-Z0-9]*:\s*\w+Query/);
    return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
  }

  const guardOf = (file: string, name: string) =>
    procedureBody(file, name).match(/^\s{2}\w+:\s*(\w+Query)/)?.[1];

  // Listing the keys tells an attacker which integrations exist, what they may
  // do and what their prefixes look like — the three mutations beside it have
  // always checked, and the module header has always said CEO only.
  it("api keys cannot be listed without the same role check the mutations make", () => {
    const body = procedureBody("api-key-router.ts", "list");
    expect(body).toMatch(/role !== "superadmin"/);
    expect(body).toMatch(/role !== "ceo"/);
  });

  // The same buying price that was closed in product-router, leaking through a
  // raw SQL query in a different router that the earlier fix never touched.
  it("the multi-warehouse stock query hands cost only to ceo or operator", () => {
    const body = procedureBody("warehouse-multi-router.ts", "getStock");
    expect(body).toMatch(/canSeeCost/);
    expect(body).toMatch(/ctx\.user\.role === "ceo"/);
    expect(body).toMatch(/ctx\.user\.role === "operator"/);
  });

  // The KPI page that calls this is open to agents, so the fix narrows the rows
  // rather than refusing the call — an agent still sees their own commission.
  it("commissions are narrowed to the caller unless they manage people", () => {
    const body = procedureBody("commission-router.ts", "list");
    expect(body).toMatch(/seesEveryone/);
    expect(body).toMatch(/eq\(commissions\.userId,\s*ctx\.user\.id\)/);
    // And a caller must not be able to name somebody else and get around it.
    expect(body).toMatch(/input\?\.userId && seesEveryone/);
  });

  it("team quotas are behind a management guard, personal quota is not", () => {
    expect(guardOf("sales-target-router.ts", "list")).toBe("managementQuery");
    expect(guardOf("sales-target-router.ts", "summary")).toBe("managementQuery");
    // myQuota returns the caller's own plan, so it stays open to everyone.
    expect(guardOf("sales-target-router.ts", "myQuota")).toBe("authedQuery");
  });

  it("managementQuery admits exactly the roles the mobile tab is shown to", () => {
    const line = api("middleware.ts").split("\n").find(l => l.includes("export const managementQuery"));
    expect(line).toMatch(/\["ceo", "operator", "supervisor"\]/);
  });
});

/**
 * A cache key must name every input that changes the answer.
 *
 * shopList and productList left pageSize out while the routers used it for the
 * LIMIT, so five callers asking for 5, 25, 200, 500 and 10000 rows all hashed
 * to one entry. Whoever loaded first decided what the rest got for three
 * minutes: a shop picker that asked for 500 would quietly render 25, and a
 * shop that exists could not be selected until the cache expired. The reports
 * hub has the same exposure — its cards ask for 10000 and would export a
 * truncated file with nothing on the sheet to say so.
 */
describe("list caches key on everything that changes the result", () => {
  const cache = api("lib/cache.ts");

  it.each(["productList", "shopList"])("%s takes pageSize and puts it in the key", (name) => {
    const line = cache.split("\n").find(l => l.trimStart().startsWith(`${name}:`));
    expect(line, `${name} not found`).toBeDefined();
    expect(line).toMatch(/pageSize:\s*number/);

    // The template on the following line has to interpolate it, not merely accept it.
    const at = cache.indexOf(`${name}:`);
    const template = cache.slice(at, cache.indexOf("`,", at));
    expect(template).toMatch(/\$\{pageSize\}/);
  });

  it.each([
    ["shop-router.ts", "shopList"],
    ["product-router.ts", "productList"],
  ])("%s passes its own pageSize into %s", (file, name) => {
    const src = api(file);
    const call = src.slice(src.indexOf(`CacheKeys.${name}(`));
    expect(call.slice(0, 120)).toMatch(/page,\s*pageSize/);
  });
});

/**
 * A field agent sees their own work, and the totals above it must agree.
 *
 * OrderService.list has always narrowed to the caller for non-privileged roles.
 * order.stats and dashboard.revenueTrend did not, so an agent's Orders page
 * listed their own orders under tiles counting the whole company, and the
 * sparkline on their phone's home screen drew the company's daily revenue.
 * Two numbers on one screen disagreeing is how this stayed unnoticed: it reads
 * as a rendering quirk rather than as a leak.
 */
describe("per-agent scoping matches between a list and its totals", () => {
  const PRIVILEGED = /\["ceo", "operator", "supervisor", "superadmin"\]/;

  it("OrderService.list narrows to the caller", () => {
    const src = api("services/order.ts");
    expect(src).toMatch(PRIVILEGED);
    expect(src).toMatch(/eq\(orders\.agentId,\s*opts\.userId\)/);
  });

  it.each([
    ["order-router.ts", "stats"],
    ["dashboard-router.ts", "revenueTrend"],
  ])("%s.%s narrows the same way", (file, name) => {
    const src = api(file);
    const start = src.indexOf(`  ${name}:`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const next = src.slice(start + 1).search(/\n {2}[a-zA-Z][a-zA-Z0-9]*:\s*\w+Query/);
    const body = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);

    expect(body, `${name}: no role check`).toMatch(PRIVILEGED);
    expect(body, `${name}: not narrowed to the caller`).toMatch(/eq\(orders\.agentId,\s*ctx\.user\.id\)/);
  });

  // The caller passes agentId/agentIds to filter within what they may see. If
  // that were applied instead of the self-scoping rather than on top of it, an
  // agent could name a colleague and read their numbers.
  it("a caller-supplied agentId cannot replace the self-scoping", () => {
    const src = api("order-router.ts");
    const start = src.indexOf("  stats:");
    const body = src.slice(start, src.indexOf("\n  list:", start));
    const selfScope = body.indexOf("eq(orders.agentId, ctx.user.id)");
    const supplied = body.indexOf("input?.agentIds");
    expect(selfScope).toBeGreaterThan(-1);
    expect(supplied).toBeGreaterThan(selfScope);
  });
});

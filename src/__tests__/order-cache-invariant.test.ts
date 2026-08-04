import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Editing an order used to leave the Orders list showing the old total until a
 * full page reload: each mutation's onSuccess hand-picked a couple of queries
 * to invalidate, and every call site picked a different, incomplete set.
 *
 * The fix routes every order-affecting mutation through
 * `useInvalidateOrderCaches()`, which knows the whole blast radius. These tests
 * scan the source so a new mutation written the old way fails here rather than
 * shipping as another stale-total bug.
 */

const SRC = join(__dirname, "..");

/** Procedures whose success changes an order, its shop's debt, or stock. */
const ORDER_WRITE_PROCEDURES = [
  "order.create",
  "order.update",
  "order.updateItems",
  "order.updateStatus",
  "order.delete",
  "order.restore",
  "order.recordPartialDelivery",
  "order.recordDeliveryAndPayment",
  "order.bulkUpdateStatus",
  "order.bulkCompleteWithPayment",
  "order.bulkAssignAgent",
  "order.bulkAssignCourier",
  "courier.assignCourier",
  "courier.markOutForDelivery",
  "courier.markDelivered",
  "courier.markFailed",
];

/**
 * Writes that only touch metadata attached to an order — a saved filter, a
 * comment — and move no money or stock, so they legitimately refresh just
 * their own list.
 */
const METADATA_ONLY = ["order.saveFilter", "order.deleteFilter", "order.addComment"];

/** Read-only "mutations": these produce a document and change nothing. */
const READ_ONLY = ["order.batchPrintInvoices", "order.createLoadingList"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The `onSuccess: { … }` body of a `trpc.<proc>.useMutation({ … })` call. */
function mutationHandlers(source: string, procedure: string): string[] {
  const bodies: string[] = [];
  const marker = `trpc.${procedure}.useMutation(`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;
    from = start + marker.length;

    // Walk to the matching close paren so nested braces stay inside the body.
    let depth = 0;
    let end = from;
    for (let i = from - 1; i < source.length; i++) {
      const c = source[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    bodies.push(source.slice(from, end));
  }
  return bodies;
}

const FILES = sourceFiles(SRC).map(f => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("order cache invalidation", () => {
  it("routes every order-affecting mutation through useInvalidateOrderCaches", () => {
    const offenders: string[] = [];

    for (const proc of ORDER_WRITE_PROCEDURES) {
      for (const file of FILES) {
        for (const body of mutationHandlers(file.text, proc)) {
          if (!body.includes("onSuccess")) {
            offenders.push(`${file.path}: trpc.${proc} has no onSuccess — the UI will show stale data`);
            continue;
          }
          if (!body.includes("invalidateOrderCaches()")) {
            offenders.push(`${file.path}: trpc.${proc} does not call invalidateOrderCaches()`);
          }
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("keeps no hand-rolled order/shop invalidation alongside the shared helper", () => {
    // A narrow `utils.order.list.invalidate()` next to the helper is dead code
    // at best and a sign someone is re-growing the old pattern at worst.
    const narrow = /utils\.(order|shop|warehouse|warehouseMulti|analytics|dashboard)\.(list|stats|getById)\.invalidate/;
    const offenders = FILES
      .filter(f => f.text.includes("invalidateOrderCaches()") && narrow.test(f.text))
      .map(f => f.path);

    expect(offenders, `these files mix the shared helper with hand-picked invalidation:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("lists every affected router in the shared helper", () => {
    const helper = readFileSync(join(SRC, "hooks", "useOrderCacheSync.ts"), "utf8");
    // An order write moves money (shop), stock (warehouse*) and every report
    // built on them. Dropping one of these silently reintroduces stale reads.
    for (const router of ["order", "shop", "warehouse", "warehouseMulti", "courier", "analytics", "dashboard"]) {
      expect(helper, `useOrderCacheSync must invalidate the "${router}" router`).toContain(`"${router}"`);
    }
  });

  it("does not force refetches for writes that change nothing", () => {
    for (const proc of [...METADATA_ONLY, ...READ_ONLY]) {
      for (const file of FILES) {
        for (const body of mutationHandlers(file.text, proc)) {
          expect(body, `${file.path}: trpc.${proc} changes no order data, so it should not invalidate everything`)
            .not.toContain("invalidateOrderCaches()");
        }
      }
    }
  });
});

import type { TrpcContext } from "../../context";

/**
 * The one place a fake request context becomes a real one.
 *
 * TrpcContext requires `db: DrizzleInstance` — a live connection with drizzle's
 * full query builder on it. A test hands in a hand-rolled fake that answers the
 * handful of calls the procedure under test makes, and no amount of typing will
 * make that object structurally a DrizzleInstance. So a conversion is
 * unavoidable somewhere.
 *
 * What matters is that it happens once, with a name, rather than as a cast
 * scattered across every `createCaller(...)` in the suite. Two hundred silent
 * casts and one declared seam do the same thing to the compiler and opposite
 * things to a reader: the first hides that the db is a stand-in, the second
 * says so.
 *
 * Use it on the context builder's return, not at call sites — one per test
 * file, at the point where the fake is assembled.
 */
export function asTestContext(ctx: unknown): TrpcContext {
  return ctx as TrpcContext;
}

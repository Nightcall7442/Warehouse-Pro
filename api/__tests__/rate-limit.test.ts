/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../lib/rate-limit";

const OPTS = { windowMs: 60_000, limit: 3, namespace: "test" };

// Each test gets a fresh namespace so stores don't bleed
let ns = 0;
function opts() {
  return { ...OPTS, namespace: `test-${ns++}` };
}

describe("rate limiter", () => {
  it("allows requests under the limit", () => {
    const o = opts();
    expect(checkRateLimit("1.2.3.4", o)).toBe(true);
    expect(checkRateLimit("1.2.3.4", o)).toBe(true);
    expect(checkRateLimit("1.2.3.4", o)).toBe(true);
  });

  it("blocks once limit is exceeded", () => {
    const o = opts();
    checkRateLimit("1.2.3.4", o);
    checkRateLimit("1.2.3.4", o);
    checkRateLimit("1.2.3.4", o);
    expect(checkRateLimit("1.2.3.4", o)).toBe(false);
    expect(checkRateLimit("1.2.3.4", o)).toBe(false);
  });

  it("isolates different IPs", () => {
    const o = opts();
    checkRateLimit("1.1.1.1", o);
    checkRateLimit("1.1.1.1", o);
    checkRateLimit("1.1.1.1", o);
    // Different IP should still be allowed
    expect(checkRateLimit("2.2.2.2", o)).toBe(true);
  });

  it("isolates different namespaces", () => {
    const o1 = opts();
    const o2 = opts();
    checkRateLimit("1.2.3.4", o1);
    checkRateLimit("1.2.3.4", o1);
    checkRateLimit("1.2.3.4", o1);
    // Exhausted o1 but o2 is independent
    expect(checkRateLimit("1.2.3.4", o2)).toBe(true);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    const o = opts();
    checkRateLimit("1.2.3.4", o);
    checkRateLimit("1.2.3.4", o);
    checkRateLimit("1.2.3.4", o);
    expect(checkRateLimit("1.2.3.4", o)).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit("1.2.3.4", o)).toBe(true);
    vi.useRealTimers();
  });
});

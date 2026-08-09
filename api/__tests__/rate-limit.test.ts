 
import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../lib/rate-limit";

const OPTS = { windowMs: 60_000, limit: 3, namespace: "test" };

// Each test gets a fresh namespace so stores don't bleed
let ns = 0;
function opts() {
  return { ...OPTS, namespace: `test-${ns++}` };
}

describe("rate limiter", () => {
  it("allows requests under the limit", async () => {
    const o = opts();
    expect(await checkRateLimit("1.2.3.4", o)).toBe(true);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(true);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(true);
  });

  it("blocks once limit is exceeded", async () => {
    const o = opts();
    await checkRateLimit("1.2.3.4", o);
    await checkRateLimit("1.2.3.4", o);
    await checkRateLimit("1.2.3.4", o);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(false);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(false);
  });

  it("isolates different IPs", async () => {
    const o = opts();
    await checkRateLimit("1.1.1.1", o);
    await checkRateLimit("1.1.1.1", o);
    await checkRateLimit("1.1.1.1", o);
    // Different IP should still be allowed
    expect(await checkRateLimit("2.2.2.2", o)).toBe(true);
  });

  it("isolates different namespaces", async () => {
    const o1 = opts();
    const o2 = opts();
    await checkRateLimit("1.2.3.4", o1);
    await checkRateLimit("1.2.3.4", o1);
    await checkRateLimit("1.2.3.4", o1);
    // Exhausted o1 but o2 is independent
    expect(await checkRateLimit("1.2.3.4", o2)).toBe(true);
  });

  it("resets after window expires", async () => {
    vi.useFakeTimers();
    const o = opts();
    await checkRateLimit("1.2.3.4", o);
    await checkRateLimit("1.2.3.4", o);
    await checkRateLimit("1.2.3.4", o);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);
    expect(await checkRateLimit("1.2.3.4", o)).toBe(true);
    vi.useRealTimers();
  });
});

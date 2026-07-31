
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkRateLimit, getClientIp, rememberSocketIp } from "../lib/rate-limit";

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

  it("gives five different socket addresses five independent buckets", async () => {
    // FIX: P0.2 — with TRUSTED_PROXY_COUNT=0 every request used to resolve to
    // "unknown", so one client exhausting the limit blocked everyone.
    delete process.env.TRUSTED_PROXY_COUNT;
    const o = { ...OPTS, limit: 1, namespace: `socket-${ns++}` };
    const ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"];

    const requests = ips.map(ip => {
      const req = new Request("https://example.test/api/trpc/order.list");
      rememberSocketIp(req, ip);
      return req;
    });

    expect(requests.map(getClientIp)).toEqual(ips);
    // First request from each IP is allowed …
    for (const req of requests) {
      expect(await checkRateLimit(getClientIp(req), o)).toBe(true);
    }
    // … and blocking one IP leaves the others' buckets untouched.
    expect(await checkRateLimit(getClientIp(requests[0]!), o)).toBe(false);
    expect(new Set(requests.map(getClientIp)).size).toBe(5);
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

describe("getClientIp", () => {
  const TRUSTED = process.env.TRUSTED_PROXY_COUNT;

  afterEach(() => {
    if (TRUSTED === undefined) delete process.env.TRUSTED_PROXY_COUNT;
    else process.env.TRUSTED_PROXY_COUNT = TRUSTED;
  });

  function request(headers: Record<string, string> = {}, socketIp?: string): Request {
    const req = new Request("https://example.test/api/trpc/order.list", { headers });
    if (socketIp) rememberSocketIp(req, socketIp);
    return req;
  }

  describe("without a trusted proxy (TRUSTED_PROXY_COUNT=0)", () => {
    it("uses the socket address", () => {
      process.env.TRUSTED_PROXY_COUNT = "0";
      expect(getClientIp(request({}, "203.0.113.7"))).toBe("203.0.113.7");
    });

    it("ignores spoofable proxy headers", () => {
      process.env.TRUSTED_PROXY_COUNT = "0";
      const req = request({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }, "203.0.113.7");
      expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("keeps two spoofed headers from the same socket in one bucket", () => {
      process.env.TRUSTED_PROXY_COUNT = "0";
      const a = request({ "x-forwarded-for": "1.1.1.1" }, "203.0.113.7");
      const b = request({ "x-forwarded-for": "9.9.9.9" }, "203.0.113.7");
      expect(getClientIp(a)).toBe(getClientIp(b));
    });

    it("normalizes IPv4-mapped IPv6 addresses", () => {
      process.env.TRUSTED_PROXY_COUNT = "0";
      expect(getClientIp(request({}, "::ffff:203.0.113.7"))).toBe("203.0.113.7");
    });

    it('falls back to "unknown" when the socket address is unavailable', () => {
      process.env.TRUSTED_PROXY_COUNT = "0";
      expect(getClientIp(request())).toBe("unknown");
    });
  });

  describe("behind a trusted proxy", () => {
    it("takes the hop the proxy appended, not the client-supplied prefix", () => {
      process.env.TRUSTED_PROXY_COUNT = "1";
      const req = request({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }, "10.0.0.1");
      expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("counts hops from the right for two proxies", () => {
      process.env.TRUSTED_PROXY_COUNT = "2";
      const req = request({ "x-forwarded-for": "1.1.1.1, 203.0.113.7, 10.0.0.9" });
      expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("falls back to x-real-ip, then to the socket address", () => {
      process.env.TRUSTED_PROXY_COUNT = "1";
      expect(getClientIp(request({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
      expect(getClientIp(request({}, "203.0.113.9"))).toBe("203.0.113.9");
    });

    it("treats a malformed TRUSTED_PROXY_COUNT as no proxy", () => {
      process.env.TRUSTED_PROXY_COUNT = "not-a-number";
      const req = request({ "x-forwarded-for": "1.1.1.1" }, "203.0.113.7");
      expect(getClientIp(req)).toBe("203.0.113.7");
    });
  });
});

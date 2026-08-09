import { vi } from "vitest";

/**
 * The stand-in every router test installs for ../lib/rate-limit.
 *
 * Sixteen test files each carried their own copy, listing the module's exports
 * by hand. That worked right up until the module gained one — and then 157
 * tests failed in files with nothing to do with rate limiting, because a
 * vi.mock factory replaces the *whole* module and anything it forgets becomes
 * an import error the moment production code touches it.
 *
 * One factory, imported by all of them, turns the next export into one edit.
 *
 * The default is "always allow": these suites are testing routers, not limits.
 * A test that wants to watch a limit fire should mock checkRateLimit itself
 * rather than teaching this shared fake to sometimes say no.
 */
export function rateLimitMock() {
  return {
    checkRateLimit:      vi.fn(async () => true),
    checkRateLimitAsync: vi.fn(async () => true),
    getClientIp:         vi.fn(() => "127.0.0.1"),
    rateLimitSubject:    vi.fn((_req: Request, subject?: string | null) => subject ?? "127.0.0.1"),
  };
}

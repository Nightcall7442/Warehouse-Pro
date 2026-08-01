import { describe, it, expect, beforeEach, vi } from "vitest";

// error-log.ts persists to logs/error-log.jsonl on import and on every write.
// Keep the suite hermetic: no directories created, no files touched.
vi.mock("fs", () => ({
  existsSync: () => false,
  mkdirSync: () => undefined,
  readFileSync: () => "",
  appendFileSync: () => undefined,
  statSync: () => ({ size: 0 }),
  renameSync: () => undefined,
}));

import { TRPCError } from "@trpc/server";
import {
  classifyTrpcError,
  getClientIssues,
  getErrors,
  logTrpcError,
  purgeOldErrors,
  recordClientIssue,
  resetClientIssues,
  UNKNOWN_METHOD,
} from "../lib/error-log";

/** Drop every buffered error so each test reads a clean feed. */
function clearErrorFeed() {
  purgeOldErrors(0);
}

beforeEach(() => {
  clearErrorFeed();
  resetClientIssues();
});

describe("classifyTrpcError — status mapping", () => {
  const cases: Array<[TRPCError["code"], number]> = [
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["BAD_REQUEST", 400],
    ["TOO_MANY_REQUESTS", 429],
    ["INTERNAL_SERVER_ERROR", 500],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code} to ${expected}`, () => {
      const { statusCode } = classifyTrpcError({ error: new TRPCError({ code }) });
      expect(statusCode).toBe(expected);
    });
  }

  it("never reports a client condition as a server fault", () => {
    for (const [code] of cases.filter(([, status]) => status < 500)) {
      const result = classifyTrpcError({ error: new TRPCError({ code }) });
      expect(result.isClientError).toBe(true);
      expect(result.isServerFault).toBe(false);
    }
  });

  it("treats 5xx codes other than INTERNAL_SERVER_ERROR as server faults", () => {
    for (const code of ["NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "TIMEOUT"] as const) {
      const result = classifyTrpcError({ error: new TRPCError({ code }) });
      // TIMEOUT is 408 — a client condition — the rest are genuine faults.
      expect(result.isServerFault).toBe(result.statusCode >= 500);
    }
    expect(classifyTrpcError({ error: new TRPCError({ code: "BAD_GATEWAY" }) })).toMatchObject({
      statusCode: 502,
      isServerFault: true,
      isClientError: false,
    });
  });
});

describe("classifyTrpcError — request method", () => {
  it("records the request's method rather than a constant POST", () => {
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    expect(classifyTrpcError({ error, method: "GET" }).method).toBe("GET");
    expect(classifyTrpcError({ error, method: "PATCH" }).method).toBe("PATCH");
    expect(classifyTrpcError({ error, method: "POST" }).method).toBe("POST");
  });

  it("normalises casing and whitespace", () => {
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    expect(classifyTrpcError({ error, method: " get " }).method).toBe("GET");
  });

  it("falls back to UNKNOWN when the request exposes no method", () => {
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    expect(classifyTrpcError({ error }).method).toBe(UNKNOWN_METHOD);
    expect(classifyTrpcError({ error, method: undefined }).method).toBe(UNKNOWN_METHOD);
    expect(classifyTrpcError({ error, method: null }).method).toBe(UNKNOWN_METHOD);
    expect(classifyTrpcError({ error, method: "" }).method).toBe(UNKNOWN_METHOD);
  });
});

describe("logTrpcError — sink routing", () => {
  it("keeps an expired session (UNAUTHORIZED on auth.me) out of the error feed", () => {
    const result = logTrpcError({
      error: new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" }),
      path: "auth.me",
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expect(result.isServerFault).toBe(false);
    expect(result.entry).toBeUndefined();
    expect(getErrors().errors).toHaveLength(0);
    expect(getErrors().total).toBe(0);
  });

  it("reproduces the production report: one expired session, zero server errors", () => {
    // auth.me, settings.get and warehouseMulti.list all failed in the same second.
    for (const path of ["auth.me", "settings.get", "warehouseMulti.list"]) {
      logTrpcError({
        error: new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" }),
        path,
        method: "GET",
      });
    }

    const { errors, total } = getErrors();
    expect(total).toBe(0);
    expect(errors.filter((e) => e.statusCode === 500)).toHaveLength(0);

    // Still observable — three counted client conditions, none of them a 500.
    const issues = getClientIssues();
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.statusCode === 401 && i.code === "UNAUTHORIZED")).toBe(true);
    expect(issues.map((i) => i.path).sort()).toEqual(["auth.me", "settings.get", "warehouseMulti.list"]);
  });

  it.each([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["BAD_REQUEST", 400],
    ["TOO_MANY_REQUESTS", 429],
  ] as const)("keeps %s (%i) out of the error feed but counts it", (code, statusCode) => {
    logTrpcError({ error: new TRPCError({ code }), path: "some.proc", method: "POST" });

    expect(getErrors().total).toBe(0);
    expect(getClientIssues()).toEqual([
      expect.objectContaining({ code, statusCode, path: "some.proc", count: 1 }),
    ]);
  });

  it("still records a genuine 5xx in the error feed", () => {
    const cause = new Error("connection lost");
    const result = logTrpcError({
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "boom", cause }),
      path: "order.create",
      method: "POST",
    });

    expect(result.isServerFault).toBe(true);
    expect(result.entry).toBeDefined();

    const { errors, total } = getErrors();
    expect(total).toBe(1);
    expect(errors[0]).toMatchObject({
      message: "boom",
      code: "INTERNAL_SERVER_ERROR",
      path: "order.create",
      method: "POST",
      statusCode: 500,
    });
    expect(errors[0].stack).toBe(cause.stack);
    expect(getClientIssues()).toHaveLength(0);
  });

  it("records the real HTTP method on the feed entry, not a hard-coded POST", () => {
    logTrpcError({
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "query blew up" }),
      path: "dashboard.stats",
      method: "GET",
    });

    expect(getErrors().errors[0].method).toBe("GET");
  });

  it("falls back to UNKNOWN method and 'unknown' path when neither is available", () => {
    logTrpcError({ error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "x" }) });

    expect(getErrors().errors[0]).toMatchObject({ method: UNKNOWN_METHOD, path: "unknown" });
  });

  it("keeps the feed to real faults when 4xx and 5xx arrive together", () => {
    logTrpcError({ error: new TRPCError({ code: "UNAUTHORIZED" }), path: "auth.me", method: "GET" });
    logTrpcError({ error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "db down" }), path: "shop.list", method: "POST" });
    logTrpcError({ error: new TRPCError({ code: "TOO_MANY_REQUESTS" }), path: "auth.login", method: "POST" });

    const { errors, total } = getErrors();
    expect(total).toBe(1);
    expect(errors[0]).toMatchObject({ path: "shop.list", statusCode: 500 });
  });
});

describe("recordClientIssue — counters", () => {
  it("aggregates repeats of the same code+path", () => {
    for (let i = 0; i < 5; i++) {
      recordClientIssue({ code: "UNAUTHORIZED", path: "auth.me", statusCode: 401 });
    }

    const issues = getClientIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(5);
    expect(issues[0].lastSeen).toBeGreaterThanOrEqual(issues[0].firstSeen);
  });

  it("makes a brute-force burst visible without touching the error feed", () => {
    for (let i = 0; i < 40; i++) {
      logTrpcError({ error: new TRPCError({ code: "TOO_MANY_REQUESTS" }), path: "auth.login", method: "POST" });
    }
    logTrpcError({ error: new TRPCError({ code: "UNAUTHORIZED" }), path: "auth.me", method: "GET" });

    expect(getErrors().total).toBe(0);
    expect(getClientIssues()[0]).toMatchObject({ path: "auth.login", statusCode: 429, count: 40 });
  });

  it("filters counted issues by recency", () => {
    recordClientIssue({ code: "FORBIDDEN", path: "admin.users", statusCode: 403 });

    expect(getClientIssues({ since: Date.now() - 1000 })).toHaveLength(1);
    expect(getClientIssues({ since: Date.now() + 1000 })).toHaveLength(0);
  });
});

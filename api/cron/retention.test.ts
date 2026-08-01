import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Retention deletes production rows, so the tests that matter are the ones about
 * what it *refuses* to do: a misread environment variable must never become
 * "delete everything", and one run must never hold a lock long enough to stall
 * writers.
 */

const mockEnv = {
  retentionAgentLocationsDays: 90,
  retentionStockMovementsDays: 730,
  retentionAuditLogDays: 730,
  retentionSchedule: "30 3 * * *",
  isProduction: false,
};

vi.mock("../lib/env", () => ({ env: mockEnv }));

const { runRetention, pruneTable, resolveCutoff, retentionPolicy, RETENTION_LIMITS } =
  await import("./retention");

const NOW = new Date("2026-08-01T03:30:00Z");

/** Records every batch it is asked to delete and reports a scripted row count. */
function fakeDeleter(plan: Record<string, number[]>) {
  const calls: Array<{ table: string; column: string; cutoff: string; limit: number }> = [];
  const remaining = { ...plan };
  const deleter = async (table: string, column: string, cutoff: string, limit: number) => {
    calls.push({ table, column, cutoff, limit });
    const queue = remaining[table];
    if (!queue || queue.length === 0) return 0;
    return queue.shift()!;
  };
  return { deleter, calls };
}

beforeEach(() => {
  Object.assign(mockEnv, {
    retentionAgentLocationsDays: 90,
    retentionStockMovementsDays: 730,
    retentionAuditLogDays: 730,
  });
});

describe("resolveCutoff", () => {
  it("computes the cutoff from the keep-window", () => {
    const decision = resolveCutoff(90, NOW.getTime());
    expect(decision.action).toBe("delete");
    if (decision.action !== "delete") throw new Error("unreachable");
    expect(decision.cutoff.toISOString()).toBe("2026-05-03T03:30:00.000Z");
  });

  it("treats 0 and an unparsed variable as keep-forever, not delete-everything", () => {
    for (const days of [0, -1, NaN]) {
      const decision = resolveCutoff(days, NOW.getTime());
      expect(decision.action, `days=${days}`).toBe("skip");
    }
  });

  it("refuses a window shorter than the floor", () => {
    const decision = resolveCutoff(3, NOW.getTime());
    expect(decision.action).toBe("refuse");
    if (decision.action !== "refuse") throw new Error("unreachable");
    expect(decision.reason).toContain("misconfiguration");
  });

  it("accepts exactly the floor", () => {
    expect(resolveCutoff(RETENTION_LIMITS.MIN_RETENTION_DAYS, NOW.getTime()).action).toBe("delete");
  });
});

describe("pruneTable", () => {
  const policy = { table: "agent_locations", column: "created_at", days: 90, purpose: "GPS trail" };

  it("deletes in batches until a short batch ends the run", async () => {
    const { deleter, calls } = fakeDeleter({ agent_locations: [5000, 5000, 1200] });

    const result = await pruneTable(policy, NOW.getTime(), deleter, 0);

    expect(result.status).toBe("deleted");
    expect(result.rowsDeleted).toBe(11_200);
    expect(calls).toHaveLength(3);
    expect(calls.every(c => c.limit === RETENTION_LIMITS.BATCH_SIZE)).toBe(true);
    expect(result.capReached).toBe(false);
  });

  it("passes a MySQL datetime cutoff, not an ISO string", async () => {
    const { deleter, calls } = fakeDeleter({ agent_locations: [0] });
    await pruneTable(policy, NOW.getTime(), deleter);
    expect(calls[0]!.cutoff).toBe("2026-05-03 03:30:00");
  });

  it("stops at the per-run cap and says so", async () => {
    const batches = Array.from(
      { length: RETENTION_LIMITS.MAX_ROWS_PER_RUN / RETENTION_LIMITS.BATCH_SIZE + 5 },
      () => RETENTION_LIMITS.BATCH_SIZE,
    );
    const { deleter, calls } = fakeDeleter({ agent_locations: batches });

    // pauseMs = 0: the real 200ms breather between batches is what protects
    // replicas, not what this test is checking.
    const result = await pruneTable(policy, NOW.getTime(), deleter, 0);

    expect(result.capReached).toBe(true);
    expect(result.rowsDeleted).toBe(RETENTION_LIMITS.MAX_ROWS_PER_RUN);
    expect(calls).toHaveLength(RETENTION_LIMITS.MAX_ROWS_PER_RUN / RETENTION_LIMITS.BATCH_SIZE);
  });

  it("issues nothing at all when retention is disabled", async () => {
    const { deleter, calls } = fakeDeleter({});
    const result = await pruneTable({ ...policy, days: 0 }, NOW.getTime(), deleter);

    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("issues nothing when the window is below the floor", async () => {
    const { deleter, calls } = fakeDeleter({});
    const result = await pruneTable({ ...policy, days: 1 }, NOW.getTime(), deleter);

    expect(result.status).toBe("refused");
    expect(calls).toHaveLength(0);
  });

  it("reports a failure with the rows it managed to delete", async () => {
    let call = 0;
    const deleter = async () => {
      call += 1;
      if (call === 1) return RETENTION_LIMITS.BATCH_SIZE;
      throw new Error("Lock wait timeout exceeded");
    };

    const result = await pruneTable(policy, NOW.getTime(), deleter, 0);

    expect(result.status).toBe("failed");
    expect(result.rowsDeleted).toBe(RETENTION_LIMITS.BATCH_SIZE);
    expect(result.reason).toContain("Lock wait timeout");
  });
});

describe("runRetention", () => {
  it("covers all three growing tables", async () => {
    const { deleter, calls } = fakeDeleter({ agent_locations: [10], stock_movements: [5], audit_log: [0] });

    const result = await runRetention(NOW, deleter, 0);

    expect(result.tables.map(t => t.table)).toEqual(["agent_locations", "stock_movements", "audit_log"]);
    expect(result.success).toBe(true);
    expect(result.message).toContain("15");
    expect(new Set(calls.map(c => c.table)).size).toBe(3);
  });

  it("keeps going when one table fails", async () => {
    const deleter = async (table: string) => {
      if (table === "stock_movements") throw new Error("table is read only");
      return 7;
    };

    const result = await runRetention(NOW, deleter, 0);

    expect(result.success).toBe(false);
    expect(result.tables.find(t => t.table === "stock_movements")?.status).toBe("failed");
    // The other two still ran — a broken policy on one table must not let the
    // others grow unbounded.
    expect(result.tables.filter(t => t.status === "deleted")).toHaveLength(2);
    expect(result.message).toContain("stock_movements");
  });

  it("honours per-table configuration", async () => {
    Object.assign(mockEnv, { retentionAgentLocationsDays: 30, retentionAuditLogDays: 0 });
    const { deleter, calls } = fakeDeleter({ agent_locations: [1], stock_movements: [1] });

    const result = await runRetention(NOW, deleter, 0);

    expect(calls.find(c => c.table === "agent_locations")!.cutoff).toBe("2026-07-02 03:30:00");
    expect(result.tables.find(t => t.table === "audit_log")?.status).toBe("skipped");
    expect(calls.some(c => c.table === "audit_log")).toBe(false);
  });

  it("defaults the GPS trail to the shortest window of the three", () => {
    const policy = retentionPolicy();
    const gps = policy.find(p => p.table === "agent_locations")!;
    expect(gps.days).toBeLessThan(policy.find(p => p.table === "audit_log")!.days);
  });
});

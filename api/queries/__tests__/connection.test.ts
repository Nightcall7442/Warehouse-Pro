import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The pool is faked at the mysql2 layer so these tests exercise the real module:
 * the AsyncLocalStorage scoping, the transaction propagation and the reconnect
 * backoff all run as written, without a database.
 */
const poolState = {
  created: 0,
  ended: 0,
  queries: 0,
  /** Number of leading queries that should fail before the fake server answers. */
  failuresLeft: 0,
  errorListeners: 0,
};

function makeFakePool() {
  poolState.created += 1;
  const execute = async () => {
    poolState.queries += 1;
    if (poolState.failuresLeft > 0) {
      poolState.failuresLeft -= 1;
      throw new Error("ECONNREFUSED");
    }
    return [[{ 1: 1 }], []];
  };
  return {
    query: execute,
    execute,
    end: async () => { poolState.ended += 1; },
    pool: { on: () => { poolState.errorListeners += 1; } },
  };
}

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => makeFakePool() },
  createPool: () => makeFakePool(),
}));

const { getDb, runWithDb, withTransaction, inTransaction, checkDatabaseHealth, waitForDatabase, closeDb, resetDb } =
  await import("../connection");

/** A stand-in handle; identity is all these assertions care about. */
const fakeHandle = { tag: "scoped" } as unknown as ReturnType<typeof getDb>;

beforeEach(() => {
  poolState.created = 0;
  poolState.ended = 0;
  poolState.queries = 0;
  poolState.failuresLeft = 0;
  resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("request-scoped handle", () => {
  it("returns the pooled instance outside any scope", () => {
    const db = getDb();
    expect(db).toBeDefined();
    expect(poolState.created).toBe(1);
    // Same instance on a second call — one pool per process, not per call.
    expect(getDb()).toBe(db);
    expect(poolState.created).toBe(1);
  });

  it("returns the scoped handle inside runWithDb", () => {
    runWithDb(fakeHandle, () => {
      expect(getDb()).toBe(fakeHandle);
    });
  });

  it("propagates the scope across awaits", async () => {
    await runWithDb(fakeHandle, async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(getDb()).toBe(fakeHandle);
    });
  });

  it("keeps concurrent scopes isolated", async () => {
    const first = { tag: "first" } as unknown as ReturnType<typeof getDb>;
    const second = { tag: "second" } as unknown as ReturnType<typeof getDb>;

    const seen: unknown[] = [];
    await Promise.all([
      runWithDb(first, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        seen.push(getDb());
      }),
      runWithDb(second, async () => {
        seen.push(getDb());
      }),
    ]);

    expect(seen).toEqual([second, first]);
  });

  it("restores the outer scope after a nested one ends", () => {
    const inner = { tag: "inner" } as unknown as ReturnType<typeof getDb>;
    runWithDb(fakeHandle, () => {
      runWithDb(inner, () => {
        expect(getDb()).toBe(inner);
      });
      expect(getDb()).toBe(fakeHandle);
    });
  });

  it("leaves no scope behind once the callback has finished", async () => {
    await runWithDb(fakeHandle, async () => {});
    expect(getDb()).not.toBe(fakeHandle);
  });
});

describe("withTransaction", () => {
  it("makes the transaction handle ambient for the callback", async () => {
    const tx = { tag: "tx" };
    const handle = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as ReturnType<typeof getDb>;

    const seenInside = await runWithDb(handle, () =>
      withTransaction(async () => {
        // A callee that resolves its own handle must land on the transaction,
        // not on a separate pooled connection that a rollback cannot undo.
        expect(inTransaction()).toBe(true);
        return getDb();
      }),
    );

    expect(seenInside).toBe(tx);
    expect(inTransaction()).toBe(false);
  });

  it("passes the transaction handle to the callback as well", async () => {
    const tx = { tag: "tx" };
    const handle = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as ReturnType<typeof getDb>;

    await runWithDb(handle, () =>
      withTransaction(async (received) => {
        expect(received).toBe(tx);
      }),
    );
  });

  it("clears the scope when the transaction throws", async () => {
    const handle = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ tag: "tx" }),
    } as unknown as ReturnType<typeof getDb>;

    await expect(
      runWithDb(handle, () => withTransaction(async () => { throw new Error("rollback"); })),
    ).rejects.toThrow("rollback");
    expect(inTransaction()).toBe(false);
  });
});

describe("checkDatabaseHealth", () => {
  it("is true when the server answers", async () => {
    await expect(checkDatabaseHealth()).resolves.toBe(true);
    expect(poolState.queries).toBe(1);
  });

  it("is false when the query fails", async () => {
    poolState.failuresLeft = 1;
    await expect(checkDatabaseHealth()).resolves.toBe(false);
  });

  it("probes the pool even inside a scoped handle", async () => {
    // The health probe must describe the process's own connectivity, not whatever
    // handle happens to be bound to the current request.
    await runWithDb(fakeHandle, async () => {
      await expect(checkDatabaseHealth()).resolves.toBe(true);
    });
  });
});

describe("waitForDatabase", () => {
  it("returns immediately when the first probe succeeds", async () => {
    await expect(waitForDatabase([1, 1, 1, 1])).resolves.toBe(true);
    expect(poolState.queries).toBe(1);
  });

  it("retries with backoff and rebuilds the pool between attempts", async () => {
    poolState.failuresLeft = 2; // first probe plus one retry fail
    await expect(waitForDatabase([1, 1, 1, 1])).resolves.toBe(true);
    expect(poolState.queries).toBe(3);
    // A dead pool is discarded rather than re-probed: one rebuild per retry.
    expect(poolState.created).toBeGreaterThan(1);
    expect(poolState.ended).toBeGreaterThan(0);
  });

  it("gives up after the backoff is exhausted", async () => {
    poolState.failuresLeft = Number.MAX_SAFE_INTEGER;
    await expect(waitForDatabase([1, 1])).resolves.toBe(false);
    // Initial probe plus one per delay.
    expect(poolState.queries).toBe(3);
  });

  it("uses 1s, 2s, 4s, 8s by default", async () => {
    vi.useFakeTimers();
    poolState.failuresLeft = Number.MAX_SAFE_INTEGER;
    const delays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const pending = waitForDatabase();
    // Drain the retry loop: each iteration schedules one timer.
    for (let i = 0; i < 4; i += 1) {
      await vi.runOnlyPendingTimersAsync();
    }
    await expect(pending).resolves.toBe(false);

    for (const call of setTimeoutSpy.mock.calls) {
      if (typeof call[1] === "number") delays.push(call[1]);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
    setTimeoutSpy.mockRestore();
  });
});

describe("closeDb", () => {
  it("ends the pool and drops the instance", async () => {
    const first = getDb();
    await closeDb();
    expect(poolState.ended).toBe(1);
    // A later call builds a fresh pool rather than handing back a closed one.
    expect(getDb()).not.toBe(first);
    expect(poolState.created).toBe(2);
  });

  it("is a no-op when no pool was ever created", async () => {
    await closeDb();
    await closeDb();
    expect(poolState.ended).toBe(0);
  });

  it("swallows an error from pool.end so shutdown can continue", async () => {
    const db = getDb() as unknown as { $client: { end: () => Promise<void> } };
    expect(db).toBeDefined();
    db.$client.end = async () => { throw new Error("connection reset"); };
    await expect(closeDb()).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  };
});

import { idMappings } from "@db/schema";

type FakeMapping = {
  id: number;
  tenantId: number;
  entityType: string;
  externalId: string;
  internalId: number;
  lastSyncedAt?: Date;
};

let mappingsTable: FakeMapping[] = [];
let nextId = 1;

function resetTables() {
  mappingsTable = [];
  nextId = 1;
}

const colToField = new Map<unknown, string>();
for (const [field, col] of Object.entries(idMappings)) colToField.set(col, field);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((child: unknown) => evalCond(row, child));
  if (c.__kind === "eq") {
    const col = c.col as { name?: string } | string;
    const val = c.val as { name?: string } | string | number;
    const fnL = (typeof col === "object" && col !== null ? (colToField.get(col) ?? col.name ?? col) : colToField.get(col) ?? (typeof col === "string" ? col : "")) as string;
    const fnR = (typeof val === "object" && val !== null ? (colToField.get(val) ?? val.name ?? val) : colToField.get(val) ?? (typeof val === "string" ? val : "")) as string;
    const r = row as Record<string, unknown>;
    const left = r[fnL];
    const right = typeof val === "object" && val !== null && colToField.has(val) ? r[fnR] : val;
    return left === right || String(left) === String(right);
  }
  return true;
}

function makeMockDb() {
  const db = {
    select: (_proj?: unknown) => ({
      from: (_ref: unknown) => ({
        where: (cond: unknown) => {
          const filtered = mappingsTable.filter((r) => evalCond(r, cond));
          return Object.assign(Promise.resolve(filtered), {
            limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          });
        },
      }),
    }),
    insert: (_ref: unknown) => ({
      values: (vals: unknown) => {
        const v = vals as Record<string, unknown>;
        mappingsTable.push({
          id: nextId++,
          tenantId: v.tenantId as number,
          entityType: v.entityType as string,
          externalId: v.externalId as string,
          internalId: v.internalId as number,
        });
        return Promise.resolve([{ insertId: nextId - 1 }]);
      },
    }),
    update: (_ref: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          for (const row of mappingsTable) {
            if (evalCond(row, cond)) {
              for (const [key, val] of Object.entries(patch)) {
                (row as Record<string, unknown>)[key] = val;
              }
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

import { OneCMapper } from "../onec-mapper";

describe("OneCMapper.getInternalId", () => {
  it("returns null for unmapped ID", async () => {
    const result = await OneCMapper.getInternalId(mockDb as any, 1, "product", "uuid-123");
    expect(result).toBeNull();
  });

  it("returns internalId when mapping exists", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-123", 42);
    const result = await OneCMapper.getInternalId(mockDb as any, 1, "product", "uuid-123");
    expect(result).toBe(42);
  });

  it("isolates by tenant", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-123", 42);
    const result = await OneCMapper.getInternalId(mockDb as any, 2, "product", "uuid-123");
    expect(result).toBeNull();
  });

  it("isolates by entityType", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-123", 42);
    const result = await OneCMapper.getInternalId(mockDb as any, 1, "order", "uuid-123");
    expect(result).toBeNull();
  });
});

describe("OneCMapper.getExternalId", () => {
  it("returns null when no mapping exists", async () => {
    const result = await OneCMapper.getExternalId(mockDb as any, 1, "product", 42);
    expect(result).toBeNull();
  });

  it("returns externalId when mapping exists", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-999", 42);
    const result = await OneCMapper.getExternalId(mockDb as any, 1, "product", 42);
    expect(result).toBe("uuid-999");
  });
});

describe("OneCMapper.upsert", () => {
  it("inserts new mapping", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-abc", 10);
    expect(mappingsTable).toHaveLength(1);
    expect(mappingsTable[0].externalId).toBe("uuid-abc");
    expect(mappingsTable[0].internalId).toBe(10);
  });

  it("updates existing mapping", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-abc", 10);
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-abc", 20);
    expect(mappingsTable).toHaveLength(1);
    expect(mappingsTable[0].internalId).toBe(20);
  });
});

describe("OneCMapper.getAll", () => {
  it("returns all mappings for tenant and entityType", async () => {
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-a", 1);
    await OneCMapper.upsert(mockDb as any, 1, "product", "uuid-b", 2);
    await OneCMapper.upsert(mockDb as any, 1, "order", "uuid-c", 3);

    const result = await OneCMapper.getAll(mockDb as any, 1, "product");
    expect(result).toHaveLength(2);
  });
});

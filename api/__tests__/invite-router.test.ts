import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    gt: (col: unknown, val: unknown) => ({ __kind: "gt", col, val }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
    relations: () => ({}),
  };
});

vi.mock("../lib/mailer", () => ({
  sendInviteEmail: vi.fn(async () => true),
}));

vi.mock("../lib/env", () => ({
  env: { appUrl: "http://localhost:3000" },
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../lib/constants", () => ({
  INVITE_EXPIRY_MS: 48 * 60 * 60 * 1000,
}));

vi.mock("../auth/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hash_${p}`),
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { invites, users, tenants } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

let invitesTable: any[] = [];
let usersTable: any[] = [];

function resetTables() {
  invitesTable = [];
  usersTable = [
    { id: 10, tenantId: 1, name: "CEO", email: "ceo@test.com", passwordHash: "hash_x", role: "ceo", status: "active", createdAt: new Date(), updatedAt: new Date() },
  ];
}

const colToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) { colToField.set((table as Record<string, unknown>)[name], name); }
reg(invites, "id"); reg(invites, "tenantId"); reg(invites, "email"); reg(invites, "role");
reg(invites, "token"); reg(invites, "expiresAt"); reg(invites, "acceptedAt");
reg(invites, "createdBy"); reg(invites, "createdAt");
reg(users, "id"); reg(users, "tenantId"); reg(users, "name"); reg(users, "email");
reg(users, "passwordHash"); reg(users, "role"); reg(users, "status");
reg(users, "createdAt"); reg(users, "updatedAt");
reg(tenants, "id"); reg(tenants, "name");

function mapCol(col: unknown): string { return colToField.get(col) ?? (col as any)?.name ?? String(col); }

/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: mapCol,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function buildChain(rows: Record<string, unknown>[]) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n));
  chain.orderBy = () => chain;
  chain.where = (cond: unknown) => buildChain(rows.filter(r => evalCond(r, cond)));
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.groupBy = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === invites) return invitesTable;
  if (col === users) return usersTable;
  if (col === tenants) return [{ id: 1, name: "Test Org" }];
  return [];
}

function makeMockDb() {
  let nextId = 200;
  const db: any = {};
  db.select = () => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: any[] = [];
      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: any) => {
        if (joinCond?.__kind === "eq") joins.push({ table: useTable(joinTable), primaryCol: mapCol(joinCond.col), joinCol: mapCol(joinCond.val) });
        return from;
      };
      from.innerJoin = from.leftJoin;
      from.where = (cond: unknown) => {
        let filtered = primaryRows.filter((r: any) => evalCond(r, cond));
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of filtered) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          filtered = expanded;
        }
        return buildChain(filtered);
      };
      from.then = (resolve: any, reject: any) => {
        const rows = [...primaryRows];
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of rows) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          rows.length = 0;
          rows.push(...expanded);
        }
        return Promise.resolve(rows).then(resolve, reject);
      };
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.insert = (table: any) => ({
    values: vi.fn((vals: any) => {
      const id = nextId++;
      const tbl = table === invites ? invitesTable : table === users ? usersTable : [];
      tbl.push({ id: String(id), ...vals, createdAt: new Date() });
      return [{ insertId: id }];
    }),
  });
  db.update = (table: any) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        const tbl = table === invites ? invitesTable : table === users ? usersTable : [];
        for (const row of tbl) {
          if (!evalCond(row, cond)) continue;
          Object.assign(row, patch);
        }
        return Promise.resolve();
      },
    }),
  });
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("invite.send", () => {
  it("creates an invite record and returns acceptUrl", async () => {
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    const result = await caller.send({ email: "new@user.com", role: "agent" });
    expect(result.success).toBe(true);
    expect(result.acceptUrl).toContain("/invite/");
    expect(invitesTable.length).toBe(1);
    expect(invitesTable[0].email).toBe("new@user.com");
    expect(invitesTable[0].role).toBe("agent");
    expect(invitesTable[0].tenantId).toBe(1);
  });

  it("rejects if email already registered as user", async () => {
    usersTable.push({ id: 99, tenantId: 1, email: "existing@user.com", name: "X", role: "agent" });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.send({ email: "existing@user.com", role: "agent" }))
      .rejects.toThrow(/already registered|уже зарегистрирован/i);
  });

  it("sends email via sendInviteEmail", async () => {
    const { sendInviteEmail } = await import("../lib/mailer");
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await caller.send({ email: "invited@test.com", role: "operator" });
    expect(sendInviteEmail).toHaveBeenCalled();
  });

  it("rejects invalid role", async () => {
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.send({ email: "x@test.com", role: "ceo" as any }))
      .rejects.toThrow();
  });
});

describe("invite.verify", () => {
  it("returns invite details for valid token", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    invitesTable.push({
      id: "inv1", tenantId: 1, email: "invited@test.com", role: "agent",
      token: "valid-token-abc", expiresAt: futureDate, acceptedAt: null, createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    const result = await caller.verify({ token: "valid-token-abc" });
    expect(result.email).toBe("invited@test.com");
    expect(result.role).toBe("agent");
    expect(result.orgName).toBe("Test Org");
  });

  it("rejects expired token", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    invitesTable.push({
      id: "inv2", tenantId: 1, email: "expired@test.com", role: "agent",
      token: "expired-token", expiresAt: pastDate, acceptedAt: null, createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.verify({ token: "expired-token" }))
      .rejects.toThrow(/недействительно|истекло/i);
  });

  it("rejects already accepted invite", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    invitesTable.push({
      id: "inv3", tenantId: 1, email: "done@test.com", role: "agent",
      token: "accepted-token", expiresAt: futureDate, acceptedAt: new Date(), createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.verify({ token: "accepted-token" }))
      .rejects.toThrow(/уже принято/i);
  });

  it("rejects unknown token", async () => {
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.verify({ token: "nonexistent" }))
      .rejects.toThrow(/недействительно|истекло/i);
  });
});

describe("invite.accept", () => {
  it("creates user and marks invite accepted", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    invitesTable.push({
      id: "inv4", tenantId: 1, email: "accept@test.com", role: "supervisor",
      token: "accept-token", expiresAt: futureDate, acceptedAt: null, createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    const result = await caller.accept({ token: "accept-token", name: "New Supervisor", password: "password123" });
    expect(result.success).toBe(true);
    expect(usersTable.some(u => u.email === "accept@test.com" && u.role === "supervisor")).toBe(true);
    expect(invitesTable[0].acceptedAt).not.toBeNull();
  });

  it("rejects expired token", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    invitesTable.push({
      id: "inv5", tenantId: 1, email: "old@test.com", role: "agent",
      token: "old-token", expiresAt: pastDate, acceptedAt: null, createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.accept({ token: "old-token", name: "Agent", password: "password123" }))
      .rejects.toThrow(/недействительно|истекло/i);
  });

  it("rejects already accepted invite", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    invitesTable.push({
      id: "inv6", tenantId: 1, email: "done2@test.com", role: "agent",
      token: "done-token", expiresAt: futureDate, acceptedAt: new Date(), createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await expect(caller.accept({ token: "done-token", name: "Agent", password: "password123" }))
      .rejects.toThrow(/недействительно|истекло/i);
  });

  it("hashes password before storing", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    invitesTable.push({
      id: "inv7", tenantId: 1, email: "hash@test.com", role: "courier",
      token: "hash-token", expiresAt: futureDate, acceptedAt: null, createdBy: 10, createdAt: new Date(),
    });
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    await caller.accept({ token: "hash-token", name: "Courier", password: "password123" });
    const created = usersTable.find(u => u.email === "hash@test.com");
    expect(created?.passwordHash).toBe("hash_password123");
  });
});

describe("invite.list", () => {
  it("returns invites for current tenant", async () => {
    invitesTable.push(
      { id: "i1", tenantId: 1, email: "a@test.com", role: "agent", createdAt: new Date("2025-06-01") },
      { id: "i2", tenantId: 1, email: "b@test.com", role: "operator", createdAt: new Date("2025-06-02") },
      { id: "i3", tenantId: 99, email: "c@other.com", role: "agent", createdAt: new Date("2025-06-03") },
    );
    const { inviteRouter } = await import("../invite-router");
    const caller = inviteRouter.createCaller(buildCtx());
    const result = await caller.list();
    expect(result.length).toBe(2);
    expect(result.every((i: any) => i.tenantId === 1)).toBe(true);
  });
});

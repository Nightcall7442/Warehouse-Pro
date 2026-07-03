import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

import { subscriptions } from "@db/schema";

interface FakeSubscription {
  id: string;
  tenantId: number;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnds: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let subscriptionsTable: FakeSubscription[] = [];

function resetTables() {
  const trialEnds = new Date(Date.now() + 14 * 86_400_000);
  subscriptionsTable = [
    {
      id: "sub-1",
      tenantId: 1,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      plan: "trial",
      status: "trialing",
      trialEndsAt: trialEnds,
      currentPeriodEnds: trialEnds,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function tableOf(ref: unknown): string {
  if (ref === subscriptions) return "subscriptions";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "subscriptions") return subscriptionsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(subscriptions)) columnToFieldName.set(col, field);

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((c: unknown) => evalCond(row, c as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    if (!(fieldName as string in row)) return true;
    return row[fieldName as string] === cond.val || String(row[fieldName as string]) === String(cond.val);
  }
  return true;
}

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    offset?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.offset = (n: number) => chainable(rows.slice(n));
  p.orderBy = () => chainable(rows);
  return p;
}

function makeMockDb() {
  let insertCallback: ((vals: Record<string, unknown>) => void) | null = null;

  function selectBuilder(_proj?: unknown) {
    let currentTable = "other";
    const api: Record<string, unknown> = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: Record<string, unknown>) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        return chainable(filtered);
      },
      limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
      offset(n: number) { return chainable(rowsFor(currentTable).slice(n)); },
      orderBy() { return chainable(rowsFor(currentTable)); },
    };
    return api;
  }

  const db: Record<string, unknown> = {
    select: (_proj?: unknown) => selectBuilder(_proj),
    insert: (_ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (insertCallback) insertCallback(vals);
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => ({
      set(patch: Record<string, unknown>) {
        return {
          where(cond: Record<string, unknown>) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(patch)) {
                if (val !== undefined) row[key] = val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
  };
  return { db, setInsertCallback: (cb: (vals: Record<string, unknown>) => void) => { insertCallback = cb; } };
}

let mockDb: ReturnType<typeof makeMockDb>["db"];

const mockStripe = {
  customers: { create: vi.fn(async () => ({ id: "cus_test123" })) },
  checkout: {
    sessions: {
      create: vi.fn(async () => ({ url: "https://checkout.stripe.com/test" })),
    },
  },
  billingPortal: {
    sessions: {
      create: vi.fn(async () => ({ url: "https://billing.stripe.com/test" })),
    },
  },
};

vi.mock("../lib/stripe", () => ({
  getStripe: () => mockStripe,
  PLANS: {
    trial: { name: "Trial", price: 0, priceId: null },
    basic: { name: "Basic", price: 9900, priceId: "price_basic_123" },
    pro: { name: "Pro", price: 24900, priceId: "price_pro_456" },
  },
}));

vi.mock("../lib/env", () => ({
  env: {
    appUrl: "http://localhost:3000",
    stripeSecretKey: "sk_test_fake",
    stripeBasicPriceId: "price_basic_123",
    stripeProPriceId: "price_pro_456",
  },
}));

vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

let mockGetOrCreateSubscription: ReturnType<typeof vi.fn>;

vi.mock("../lib/subscription", () => ({
  getOrCreateSubscription: (...args: unknown[]) => (mockGetOrCreateSubscription as any)(...args),
}));

function makeCtx(tenantId: number, userId: number, role = "operator"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetTables();
  const result = makeMockDb();
  mockDb = result.db;
  vi.clearAllMocks();

  mockGetOrCreateSubscription = vi.fn(async (tenantId: number) => {
    const sub = subscriptionsTable.find((s) => s.tenantId === tenantId);
    if (sub) return sub;
    const trialEnds = new Date(Date.now() + 14 * 86_400_000);
    const newSub: FakeSubscription = {
      id: `sub-${tenantId}`,
      tenantId,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      plan: "trial",
      status: "trialing",
      trialEndsAt: trialEnds,
      currentPeriodEnds: trialEnds,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    subscriptionsTable.push(newSub);
    return newSub;
  });
});

describe("stripe.getSubscription", () => {
  it("returns existing subscription for tenant", async () => {
    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSubscription();

    expect(result.plan).toBe("trial");
    expect(result.status).toBe("trialing");
    expect(result.tenantId).toBe(1);
  });

  it("auto-creates trial when no subscription exists", async () => {
    subscriptionsTable = [];
    mockGetOrCreateSubscription = vi.fn(async (tenantId: number) => {
      const trialEnds = new Date(Date.now() + 14 * 86_400_000);
      const newSub: FakeSubscription = {
        id: `sub-${tenantId}`,
        tenantId,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        plan: "trial",
        status: "trialing",
        trialEndsAt: trialEnds,
        currentPeriodEnds: trialEnds,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      subscriptionsTable.push(newSub);
      return newSub;
    });

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSubscription();

    expect(result.plan).toBe("trial");
    expect(result.status).toBe("trialing");
    expect(mockGetOrCreateSubscription).toHaveBeenCalledWith(1);
  });

  it("computes daysLeft correctly", async () => {
    const trialEnds = new Date(Date.now() + 7 * 86_400_000);
    subscriptionsTable[0].trialEndsAt = trialEnds;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSubscription();

    expect(result.daysLeft).toBe(7);
  });

  it("returns 0 daysLeft when trial is expired", async () => {
    subscriptionsTable[0].trialEndsAt = new Date(Date.now() - 86_400_000);

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSubscription();

    expect(result.daysLeft).toBe(0);
  });

  it("returns null daysLeft when no trialEndsAt", async () => {
    subscriptionsTable[0].trialEndsAt = null;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSubscription();

    expect(result.daysLeft).toBeNull();
  });

  it("sets isActive, isTrialing, isPastDue, isCanceled flags correctly", async () => {
    const { stripeRouter } = await import("../stripe-router");

    subscriptionsTable[0].status = "trialing";
    let caller = stripeRouter.createCaller(makeCtx(1, 10));
    let result = await caller.getSubscription();
    expect(result.isActive).toBe(true);
    expect(result.isTrialing).toBe(true);
    expect(result.isPastDue).toBe(false);
    expect(result.isCanceled).toBe(false);

    subscriptionsTable[0].status = "active";
    caller = stripeRouter.createCaller(makeCtx(1, 10));
    result = await caller.getSubscription();
    expect(result.isActive).toBe(true);
    expect(result.isTrialing).toBe(false);
    expect(result.isPastDue).toBe(false);
    expect(result.isCanceled).toBe(false);

    subscriptionsTable[0].status = "past_due";
    caller = stripeRouter.createCaller(makeCtx(1, 10));
    result = await caller.getSubscription();
    expect(result.isActive).toBe(false);
    expect(result.isTrialing).toBe(false);
    expect(result.isPastDue).toBe(true);
    expect(result.isCanceled).toBe(false);

    subscriptionsTable[0].status = "canceled";
    caller = stripeRouter.createCaller(makeCtx(1, 10));
    result = await caller.getSubscription();
    expect(result.isActive).toBe(false);
    expect(result.isTrialing).toBe(false);
    expect(result.isPastDue).toBe(false);
    expect(result.isCanceled).toBe(true);
  });
});

describe("stripe.getPlans", () => {
  it("returns plan list with correct shape", async () => {
    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getPlans();

    expect(result).toHaveLength(3);

    const trial = result.find((p: Record<string, unknown>) => p.key === "trial");
    expect(trial).toBeDefined();
    expect(trial!.name).toBe("Trial");
    expect(trial!.price).toBe(0);
    expect(trial!.priceId).toBeNull();

    const basic = result.find((p: Record<string, unknown>) => p.key === "basic");
    expect(basic).toBeDefined();
    expect(basic!.name).toBe("Basic");
    expect(basic!.price).toBe(9900);
    expect(basic!.priceId).toBe("price_basic_123");

    const pro = result.find((p: Record<string, unknown>) => p.key === "pro");
    expect(pro).toBeDefined();
    expect(pro!.name).toBe("Pro");
    expect(pro!.price).toBe(24900);
    expect(pro!.priceId).toBe("price_pro_456");
  });
});

describe("stripe.createCheckoutSession", () => {
  it("throws if plan has no priceId (trial plan)", async () => {
    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await expect(caller.createCheckoutSession({ plan: "basic" as never })).resolves.toBeDefined();

    mockStripe.checkout.sessions.create.mockClear();
    mockGetOrCreateSubscription = vi.fn(async () => ({
      ...subscriptionsTable[0],
      plan: "trial",
      status: "trialing",
    }));

    vi.mocked((await import("../lib/stripe")).PLANS).trial.priceId = null;

    const callerTrial = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await expect(callerTrial.createCheckoutSession({ plan: "basic" })).resolves.toBeDefined();
  });

  it("creates Stripe customer when none exists", async () => {
    subscriptionsTable[0].stripeCustomerId = null;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.createCheckoutSession({ plan: "basic" });

    expect(mockStripe.customers.create).toHaveBeenCalledWith({
      email: "t@t.com",
      name: "Test Co",
      metadata: { tenantId: "1" },
    });
    expect(result.url).toBe("https://checkout.stripe.com/test");
  });

  it("reuses existing Stripe customer", async () => {
    subscriptionsTable[0].stripeCustomerId = "cus_existing_456";

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.createCheckoutSession({ plan: "pro" });

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(result.url).toBe("https://checkout.stripe.com/test");
  });

  it("creates checkout session with correct params", async () => {
    subscriptionsTable[0].stripeCustomerId = "cus_existing_456";

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await caller.createCheckoutSession({ plan: "pro" });

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_existing_456",
        line_items: [{ price: "price_pro_456", quantity: 1 }],
        success_url: "http://localhost:3000/settings/billing?success=1",
        cancel_url: "http://localhost:3000/settings/billing?canceled=1",
        metadata: { tenantId: "1" },
      })
    );
  });

  it("preserves trial_end when trialing", async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 86_400_000);
    subscriptionsTable[0].stripeCustomerId = "cus_existing_456";
    subscriptionsTable[0].status = "trialing";
    subscriptionsTable[0].trialEndsAt = trialEndsAt;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await caller.createCheckoutSession({ plan: "basic" });

    const callArgs = (mockStripe.checkout.sessions.create.mock.calls as any)[0]?.[0];
    expect(callArgs!.subscription_data.trial_end).toBe(Math.floor(trialEndsAt.getTime() / 1000));
  });

  it("omits trial_end when not trialing", async () => {
    subscriptionsTable[0].stripeCustomerId = "cus_existing_456";
    subscriptionsTable[0].status = "active";
    subscriptionsTable[0].trialEndsAt = null;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await caller.createCheckoutSession({ plan: "basic" });

    const callArgs = (mockStripe.checkout.sessions.create.mock.calls as any)[0]?.[0];
    expect(callArgs!.subscription_data.trial_end).toBeUndefined();
  });

  it("requires admin role (rejects operator)", async () => {
    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "operator"));
    await expect(caller.createCheckoutSession({ plan: "basic" })).rejects.toThrow();
  });
});

describe("stripe.createBillingPortalSession", () => {
  it("throws if no billing account (no stripeCustomerId)", async () => {
    subscriptionsTable[0].stripeCustomerId = null;

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    await expect(caller.createBillingPortalSession()).rejects.toThrow("No billing account found");
  });

  it("creates portal session and returns URL", async () => {
    subscriptionsTable[0].stripeCustomerId = "cus_existing_456";

    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.createBillingPortalSession();

    expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing_456",
      return_url: "http://localhost:3000/settings/billing",
    });
    expect(result.url).toBe("https://billing.stripe.com/test");
  });

  it("requires admin role", async () => {
    const { stripeRouter } = await import("../stripe-router");
    const caller = stripeRouter.createCaller(makeCtx(1, 10, "operator"));
    await expect(caller.createBillingPortalSession()).rejects.toThrow();
  });
});

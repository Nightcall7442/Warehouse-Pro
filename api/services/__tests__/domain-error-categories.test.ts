import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * FIX: production monitoring was full of `500 INTERNAL_SERVER_ERROR` entries whose
 * message was an ordinary business condition — "Магазин не найден", "Невозможно
 * удалить товар: на складе есть остаток". Services threw plain `Error`, and tRPC
 * turns anything that is not a `TRPCError` into a 500, complete with a stack trace
 * and a Sentry event.
 *
 * `DomainError` fixed that for the order domain; this file is the regression gate
 * for the rest of the service layer. It asserts the *category*, not just that
 * something throws — a wrong category is exactly the bug being fixed, and it is
 * invisible to a `rejects.toThrow(/message/)` assertion.
 *
 * The services here have no mock-DB harness of their own. Rather than build ten,
 * the db is a stub that hands each `select()` the next queued result set: enough
 * to steer a service down its rejection path, and deliberately not enough to test
 * anything about the queries themselves — that stays with the per-service suites.
 */

vi.mock("../../lib/mailer", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../queries/tenants", () => ({ findTenantBySlug: vi.fn().mockResolvedValue(null) }));

vi.mock("../../lib/subscription", () => ({
  getOrCreateSubscription: vi.fn(),
  createTrialSubscription: vi.fn().mockResolvedValue(undefined),
}));

// getStripe() throws "STRIPE_SECRET_KEY is not configured." without a key — a real
// server fault, and not what these tests are about.
vi.mock("../../lib/stripe", () => ({
  getStripe: () => ({
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
  }),
  PLANS: {
    trial: { name: "Trial", nameUz: "Trial", maxUsers: 3, maxProducts: 50, maxOrdersMonth: 100, price: 0, priceId: null },
    basic: { name: "Basic", nameUz: "Basic", maxUsers: 10, maxProducts: 500, maxOrdersMonth: 1000, price: 9900, priceId: "price_basic" },
    pro: { name: "Pro", nameUz: "Pro", maxUsers: 50, maxProducts: 5000, maxOrdersMonth: 10000, price: 24900, priceId: "price_pro" },
  },
}));

// ── A db stub that replays queued result sets ────────────────────────────────
type Rows = unknown[];
let selectQueue: Rows[] = [];

/** Every builder method returns `this`; awaiting it yields the queued rows. */
function resultChain(rows: Rows) {
  const chain: Record<string, unknown> = {
    then: (onOk: (v: Rows) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onOk, onErr),
  };
  for (const method of [
    "from", "where", "limit", "offset", "orderBy", "groupBy", "having",
    "innerJoin", "leftJoin", "rightJoin", "for",
  ]) {
    chain[method] = () => chain;
  }
  return chain;
}

const writeChain = () => {
  const chain: Record<string, unknown> = {
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve([{ insertId: 1 }]).then(onOk, onErr),
  };
  for (const method of ["values", "set", "where", "onDuplicateKeyUpdate"]) {
    chain[method] = () => chain;
  }
  return chain;
};

const db = {
  select: () => resultChain(selectQueue.shift() ?? []),
  insert: () => writeChain(),
  update: () => writeChain(),
  delete: () => writeChain(),
  execute: () => Promise.resolve(),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
};

/** Queue the result sets the service under test will consume, in query order. */
function queue(...sets: Rows[]) {
  selectQueue = sets;
}

vi.mock("../../queries/connection", () => ({ getDb: () => db }));

import { isDomainError, type DomainError, type DomainErrorCode } from "../../lib/domain-error";
import { ShopService } from "../ShopService";
import { ProductService } from "../ProductService";
import { ArrivalService } from "../ArrivalService";
import { TenantService } from "../TenantService";
import { UserService } from "../UserService";
import { BillingService } from "../BillingService";
import { MerchandiserService } from "../merchandiser";
import { AnalyticsService } from "../AnalyticsService";
import { PasswordResetService } from "../password-reset";
import { suggestQuotas } from "../quota-suggest";
import { getOrCreateSubscription } from "../../lib/subscription";

/** The services take a real Drizzle handle; the stub only implements what they call. */
const anyDb = db as unknown as Parameters<typeof ShopService.delete>[0];

/** Await `fn` and return the DomainError it rejected with. */
async function rejection(fn: () => Promise<unknown>): Promise<DomainError> {
  try {
    await fn();
  } catch (err) {
    if (isDomainError(err)) return err;
    throw new Error(`expected a DomainError, got ${String(err)}`);
  }
  throw new Error("expected a rejection");
}

/** Assert both halves of the contract: the category, and the untouched message. */
async function expectDomain(
  fn: () => Promise<unknown>,
  code: DomainErrorCode,
  message: string,
) {
  const err = await rejection(fn);
  expect(err.code).toBe(code);
  expect(err.message).toBe(message);
}

beforeEach(() => {
  selectQueue = [];
  vi.mocked(getOrCreateSubscription).mockReset();
});

describe("ShopService.delete", () => {
  it("reports a shop outside the tenant as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(() => ShopService.delete(anyDb, 1, 999), "NOT_FOUND", "Магазин не найден");
  });

  it("reports linked orders as CONFLICT", async () => {
    queue([{ id: 5, tenantId: 1 }], [{ count: 3 }]);
    await expectDomain(
      () => ShopService.delete(anyDb, 1, 5),
      "CONFLICT",
      "Невозможно удалить магазин: связано 3 заказ(ов)",
    );
  });

  it("reports linked payments as CONFLICT", async () => {
    queue([{ id: 5, tenantId: 1 }], [{ count: 0 }], [{ count: 2 }]);
    await expectDomain(
      () => ShopService.delete(anyDb, 1, 5),
      "CONFLICT",
      "Невозможно удалить магазин: связано 2 платёж(ей)",
    );
  });
});

describe("ProductService.delete", () => {
  it("reports a product outside the tenant as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(() => ProductService.delete(anyDb, 1, 999), "NOT_FOUND", "Товар не найден");
  });

  it("reports order lines referencing the product as CONFLICT", async () => {
    queue([{ id: 7, tenantId: 1 }], [{ count: 4 }]);
    await expectDomain(
      () => ProductService.delete(anyDb, 1, 7),
      "CONFLICT",
      "Невозможно удалить товар: связан с 4 позицией(ями) заказов",
    );
  });

  it("reports remaining stock as CONFLICT", async () => {
    queue([{ id: 7, tenantId: 1 }], [{ count: 0 }], [{ currentStock: "12.00" }]);
    await expectDomain(
      () => ProductService.delete(anyDb, 1, 7),
      "CONFLICT",
      "Невозможно удалить товар: на складе есть остаток",
    );
  });
});

describe("ArrivalService.delete", () => {
  it("reports an arrival outside the tenant as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(() => ArrivalService.delete(anyDb, 1, 999), "NOT_FOUND", "Приход не найден");
  });
});

describe("TenantService", () => {
  it("reports an unknown tenant as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(() => TenantService.getById(anyDb, 999), "NOT_FOUND", "Tenant not found.");
  });

  it("reports a taken email as CONFLICT", async () => {
    queue([{ id: 1 }]);
    await expectDomain(
      () => TenantService.create(anyDb, {
        orgName: "Acme", ownerName: "Bob",
        ownerEmail: "bob@example.com", ownerPassword: "hunter2hunter2",
      }),
      "CONFLICT",
      "Email already registered.",
    );
  });
});

describe("UserService.changePassword", () => {
  it("reports an unknown user as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(
      () => UserService.changePassword(anyDb, 1, 999, "old", "newnewnew"),
      "NOT_FOUND",
      "User not found",
    );
  });

  /**
   * Failing the current-password check is the actor not being allowed to make the
   * change — not a malformed request, and certainly not a server fault.
   */
  it("reports a wrong current password as FORBIDDEN", async () => {
    queue([{ id: 4, passwordHash: "pbkdf2$1$aa$bb" }]);
    await expectDomain(
      () => UserService.changePassword(anyDb, 1, 4, "wrong", "newnewnew"),
      "FORBIDDEN",
      "Current password is incorrect",
    );
  });
});

describe("MerchandiserService", () => {
  const report = { planId: 3, shopId: 1, photos: [], checklist: [] };

  it("reports an unknown visit plan as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(
      () => MerchandiserService.submitReport(anyDb, 1, 7, report),
      "NOT_FOUND",
      "План визита не найден",
    );
  });

  it("reports someone else's visit plan as FORBIDDEN", async () => {
    queue([{ id: 3, tenantId: 1, agentId: 99 }]);
    await expectDomain(
      () => MerchandiserService.submitReport(anyDb, 1, 7, report),
      "FORBIDDEN",
      "Этот план назначен другому сотруднику",
    );
  });

  it("reports a malformed period as BAD_REQUEST", async () => {
    await expectDomain(
      () => MerchandiserService.getReportsByDateRange(anyDb, 1, "01.02.2025", "2025-02-28"),
      "BAD_REQUEST",
      "Некорректный период: ожидается формат ГГГГ-ММ-ДД",
    );
  });
});

describe("AnalyticsService.getPnL", () => {
  it("reports a malformed period as BAD_REQUEST", async () => {
    await expectDomain(
      () => AnalyticsService.getPnL(1, { from: "yesterday", to: "2025-02-28" }),
      "BAD_REQUEST",
      "Некорректный период: ожидается формат ГГГГ-ММ-ДД",
    );
  });
});

describe("suggestQuotas", () => {
  it("reports a malformed month as BAD_REQUEST", async () => {
    await expectDomain(
      () => suggestQuotas(anyDb, 1, "2025-13-45"),
      "BAD_REQUEST",
      "Некорректный месяц: ожидается формат ГГГГ-ММ-ДД",
    );
  });
});

describe("PasswordResetService.confirm", () => {
  /**
   * Same shape as the screenshot case that started this: the row is gone (spent,
   * expired, or never existed). A user clicking an old link is not a 500.
   */
  it("reports a spent or unknown token as NOT_FOUND", async () => {
    queue([]);
    await expectDomain(
      () => PasswordResetService.confirm(anyDb, "deadbeef", "newnewnew"),
      "NOT_FOUND",
      "Ссылка недействительна или уже использована.",
    );
  });
});

describe("BillingService", () => {
  it("reports an unknown tenant as NOT_FOUND", async () => {
    queue([]);
    // A tenant id no other test caches a status for.
    await expectDomain(() => BillingService.getStatus(anyDb, 987_654), "NOT_FOUND", "Tenant not found");
  });

  it("reports an unknown plan key as BAD_REQUEST", async () => {
    await expectDomain(
      () => BillingService.upgrade(anyDb, 1, "platinum" as never),
      "BAD_REQUEST",
      "Invalid plan",
    );
  });

  it("reports a tenant with no Stripe customer as CONFLICT", async () => {
    vi.mocked(getOrCreateSubscription).mockResolvedValue({ stripeCustomerId: null } as never);
    await expectDomain(
      () => BillingService.createPortalSession(anyDb, 1),
      "CONFLICT",
      "No billing account found. Please subscribe first.",
    );
  });
});

describe("what stays a plain Error", () => {
  /**
   * An unset STRIPE_*_PRICE_ID is a deployment mistake, not something the caller
   * did. It should keep producing a 500 and a Sentry event — converting it would
   * hide a broken deploy behind a 409 the operator never sees.
   */
  it("keeps a missing Stripe price id as a server fault", async () => {
    vi.mocked(getOrCreateSubscription).mockResolvedValue({ stripeCustomerId: "cus_1" } as never);
    const err = await BillingService.createCheckoutSession(anyDb, 1, "trial" as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isDomainError(err)).toBe(false);
    expect((err as Error).message).toBe("Plan not configured");
  });
});

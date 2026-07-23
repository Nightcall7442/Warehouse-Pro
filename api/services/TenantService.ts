import { tenants, users, settings, orders, products, shops, subscriptions } from "@db/schema";
import { eq, ne, count, sum } from "drizzle-orm";
import { findTenantBySlug } from "../queries/tenants";
import { hashPassword } from "../auth/password";
import { sanitizeString } from "../lib/sanitize";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface TenantCreateInput {
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  plan?: "trial" | "basic" | "pro" | "exclusive";
  trialDays?: number;
}

export interface TenantUpdateInput {
  plan?: "trial" | "basic" | "pro" | "exclusive";
  status?: "active" | "suspended";
  expiryDays?: number;
  trialDays?: number;
}

export const TenantService = {
  async create(db: Db, data: TenantCreateInput) {
    let slug = slugify(data.orgName);
    const base = slug;
    let attempt = 1;
    while (await findTenantBySlug(slug)) slug = `${base}-${attempt++}`;

    const existing = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, data.ownerEmail)).limit(1);
    if (existing.length) throw new Error("Email already registered.");

    const passwordHash = await hashPassword(data.ownerPassword);
    const trialDays = data.trialDays ?? 14;
    const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);
    const plan = data.plan ?? "trial";
    const planExpiresAt = plan !== 'trial' ? new Date(Date.now() + 30 * 86_400_000) : null;

    let tenantId: number;
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(tenants).values({
        slug, name: sanitizeString(data.orgName), plan,
        status: "active", trialEndsAt, planExpiresAt: planExpiresAt ?? undefined,
        ownerEmail: data.ownerEmail,
      });
      tenantId = Number(r.insertId);

      await tx.insert(users).values({
        tenantId, name: sanitizeString(data.ownerName), email: data.ownerEmail,
        passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
      });
      await tx.insert(settings).values({ tenantId, companyName: sanitizeString(data.orgName) });
    });

    return { success: true, slug, tenantId: tenantId! };
  },

  async list(db: Db) {
    const allTenants = await db.select({
      id: tenants.id, slug: tenants.slug, name: tenants.name, plan: tenants.plan,
      status: tenants.status, ownerEmail: tenants.ownerEmail,
      trialEndsAt: tenants.trialEndsAt, planExpiresAt: tenants.planExpiresAt,
      maxUsers: tenants.maxUsers, maxProducts: tenants.maxProducts,
      maxOrdersMonth: tenants.maxOrdersMonth,
      createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
    }).from(tenants);

    const userCounts = await db
      .select({ tenantId: users.tenantId, cnt: count(users.id) })
      .from(users).groupBy(users.tenantId);

    const orderStats = await db
      .select({
        tenantId: orders.tenantId,
        cnt: count(orders.id),
        total: sum(orders.total),
      })
      .from(orders).groupBy(orders.tenantId);

    const userMap = Object.fromEntries(userCounts.map(r => [r.tenantId, r.cnt]));
    const orderMap = Object.fromEntries(orderStats.map(r => [r.tenantId, { cnt: r.cnt, total: r.total ?? "0" }]));

    return allTenants.map(t => ({
      ...t,
      userCount: Number(userMap[t.id] ?? 0),
      orderCount: Number(orderMap[t.id]?.cnt ?? 0),
      orderTotal: Number(orderMap[t.id]?.total ?? 0),
    }));
  },

  async getById(db: Db, tenantId: number) {
    const [tenant] = await db.select({
      id: tenants.id, slug: tenants.slug, name: tenants.name, plan: tenants.plan,
      status: tenants.status, trialEndsAt: tenants.trialEndsAt, planExpiresAt: tenants.planExpiresAt,
      ownerEmail: tenants.ownerEmail, ownerPhone: tenants.ownerPhone,
      maxUsers: tenants.maxUsers, maxProducts: tenants.maxProducts, maxOrdersMonth: tenants.maxOrdersMonth,
      createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
    }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error("Tenant not found.");

    const [subscription, tenantUsers, orderStat, productStat, shopStat] = await Promise.all([
      db.select({
        id: subscriptions.id, plan: subscriptions.plan, status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnds: subscriptions.currentPeriodEnds,
      }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1),
      db.select({
        id: users.id, name: users.name, email: users.email,
        role: users.role, status: users.status, lastSignInAt: users.lastSignInAt,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ cnt: count(orders.id), total: sum(orders.total) })
        .from(orders).where(eq(orders.tenantId, tenantId)),
      db.select({ cnt: count(products.id) })
        .from(products).where(eq(products.tenantId, tenantId)),
      db.select({ cnt: count(shops.id) })
        .from(shops).where(eq(shops.tenantId, tenantId)),
    ]);

    return {
      tenant,
      subscription: subscription ?? null,
      users: tenantUsers,
      stats: {
        orders: Number(orderStat[0]?.cnt ?? 0),
        revenue: Number(orderStat[0]?.total ?? 0),
        products: Number(productStat[0]?.cnt ?? 0),
        shops: Number(shopStat[0]?.cnt ?? 0),
      },
    };
  },

  async update(db: Db, tenantId: number, data: TenantUpdateInput) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (data.plan && data.expiryDays) {
      updates.plan = data.plan;
      updates.planExpiresAt = new Date(Date.now() + data.expiryDays * 86_400_000);
    }
    if (data.status) {
      updates.status = data.status;
    }
    if (data.trialDays) {
      const base = new Date();
      updates.trialEndsAt = new Date(base.getTime() + data.trialDays * 86_400_000);
    }

    await db.update(tenants).set(updates).where(eq(tenants.id, tenantId));

    if (data.plan) {
      await db.update(subscriptions)
        .set({ plan: data.plan, status: "active", updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, tenantId));
    }

    return { success: true };
  },

  async getStats(db: Db) {
    const [tenantStat] = await db.select({ total: count(tenants.id) }).from(tenants).where(ne(tenants.slug, "system"));
    const [userStat] = await db.select({ total: count(users.id) }).from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(ne(tenants.slug, "system"));
    const [orderStat] = await db.select({ total: count(orders.id), revenue: sum(orders.total) }).from(orders);

    const byPlan = await db
      .select({ plan: tenants.plan, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.plan);

    const byStatus = await db
      .select({ status: tenants.status, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.status);

    return {
      tenants: Number(tenantStat?.total ?? 0),
      users: Number(userStat?.total ?? 0),
      orders: Number(orderStat?.total ?? 0),
      revenue: Number(orderStat?.revenue ?? 0),
      byPlan: Object.fromEntries(byPlan.map(r => [r.plan, Number(r.cnt)])),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, Number(r.cnt)])),
    };
  },
};

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, adminQuery, superAdminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, settings, orders, products, shops, subscriptions } from "@db/schema";
import { eq, ne, sql, count, sum } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { findTenantBySlug, listTenants } from "./queries/tenants";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";
import { createTrialSubscription } from "./lib/subscription";
import { logger } from "./lib/logger";

const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, limit: 5, namespace: "register" };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const tenantRouter = createRouter({
  // ── Публичная регистрация ──────────────────────────────────────────────────
  register: publicQuery
    .input(z.object({
      orgName:  z.string().min(2).max(100),
      name:     z.string().min(2).max(100),
      email:    z.string().email(),
      password: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, REGISTER_RATE_LIMIT)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many registration attempts." });
      }

      const db = getDb();
      let slug = slugify(input.orgName);
      const base = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) slug = `${base}-${attempt++}`;

      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });

      const passwordHash = await hashPassword(input.password);

      await db.transaction(async (tx) => {
        const [tenantResult] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: "trial", status: "active",
        });
        const tenantId = Number(tenantResult.insertId);
        await tx.insert(users).values({
          tenantId, name: input.name, email: input.email,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
        });
        await tx.insert(settings).values({ tenantId, companyName: input.orgName });
      });

      const [newTenant] = await db.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (newTenant?.id) await createTrialSubscription(newTenant.id).catch((err) => {
        logger.error("Failed to create trial subscription during registration", { tenantId: newTenant.id, error: err instanceof Error ? err.message : String(err) });
      });

      return { slug, message: "Organisation created. You can now sign in." };
    }),

  // ── Текущий тенант ─────────────────────────────────────────────────────────
  current: adminQuery.query(({ ctx }) => ({
    id:     ctx.tenant.id,
    slug:   ctx.tenant.slug,
    name:   ctx.tenant.name,
    plan:   ctx.tenant.plan,
    status: ctx.tenant.status,
  })),

  // ── Invite user внутри тенанта ─────────────────────────────────────────────
  inviteUser: adminQuery
    .input(z.object({
      name:     z.string().min(2).max(100),
      email:    z.string().email(),
      password: z.string().min(8),
      role:     z.enum(["operator", "agent", "supervisor", "merchandiser"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });

      const passwordHash = await hashPassword(input.password);
      await db.insert(users).values({
        tenantId: ctx.tenant.id, name: input.name, email: input.email,
        passwordHash, role: input.role, status: "active", lastSignInAt: new Date(),
      });
      return { success: true };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // SUPER ADMIN endpoints
  // ══════════════════════════════════════════════════════════════════════════

  /** Список всех тенантов с основной статистикой */
  list: superAdminQuery.query(async () => {
    const db = getDb();

    const allTenants = await listTenants();

    // Статистика: кол-во юзеров и заказов на тенант одним запросом
    const userCounts = await db
      .select({ tenantId: users.tenantId, cnt: count(users.id) })
      .from(users)
      .groupBy(users.tenantId);

    const orderStats = await db
      .select({
        tenantId: orders.tenantId,
        cnt:      count(orders.id),
        total:    sum(orders.total),
      })
      .from(orders)
      .groupBy(orders.tenantId);

    const userMap  = Object.fromEntries(userCounts.map(r  => [r.tenantId,  r.cnt]));
    const orderMap = Object.fromEntries(orderStats.map(r => [r.tenantId, { cnt: r.cnt, total: r.total ?? "0" }]));

    return allTenants.map(t => ({
      ...t,
      userCount:  Number(userMap[t.id]  ?? 0),
      orderCount: Number(orderMap[t.id]?.cnt   ?? 0),
      orderTotal: Number(orderMap[t.id]?.total ?? 0),
    }));
  }),

  /** Детальный профиль одного тенанта */
  getDetail: superAdminQuery
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();

      const [tenant] = await db.select({
        id: tenants.id, slug: tenants.slug, name: tenants.name, plan: tenants.plan,
        status: tenants.status, trialEndsAt: tenants.trialEndsAt, planExpiresAt: tenants.planExpiresAt,
        ownerEmail: tenants.ownerEmail, ownerPhone: tenants.ownerPhone,
        maxUsers: tenants.maxUsers, maxProducts: tenants.maxProducts, maxOrdersMonth: tenants.maxOrdersMonth,
        createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
      }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found." });

      const [subscription, tenantUsers, orderStat, productStat, shopStat] = await Promise.all([
        db.select({
          id: subscriptions.id, plan: subscriptions.plan, status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnds: subscriptions.currentPeriodEnds,
        }).from(subscriptions).where(eq(subscriptions.tenantId, input.tenantId)).limit(1),
        db.select({
          id: users.id, name: users.name, email: users.email,
          role: users.role, status: users.status, lastSignInAt: users.lastSignInAt,
          createdAt: users.createdAt,
        }).from(users).where(eq(users.tenantId, input.tenantId)),
        db.select({ cnt: count(orders.id), total: sum(orders.total) })
          .from(orders).where(eq(orders.tenantId, input.tenantId)),
        db.select({ cnt: count(products.id) })
          .from(products).where(eq(products.tenantId, input.tenantId)),
        db.select({ cnt: count(shops.id) })
          .from(shops).where(eq(shops.tenantId, input.tenantId)),
      ]);

      // Заказы по месяцам (последние 6)
      const monthlyOrders = await db.execute(sql`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS month,
          COUNT(*) AS cnt,
          COALESCE(SUM(total), 0) AS total
        FROM orders
        WHERE tenant_id = ${input.tenantId}
          AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY month
        ORDER BY month ASC
      `);

      return {
        tenant,
        subscription: subscription ?? null,
        users:        tenantUsers,
        stats: {
          orders:   Number(orderStat[0]?.cnt   ?? 0),
          revenue:  Number(orderStat[0]?.total ?? 0),
          products: Number(productStat[0]?.cnt ?? 0),
          shops:    Number(shopStat[0]?.cnt    ?? 0),
        },
        monthlyOrders: (monthlyOrders as unknown as Array<{ month: string; cnt: string; total: string }>).map(r => ({
          month:   r.month,
          orders:  Number(r.cnt),
          revenue: Number(r.total),
        })),
      };
    }),

  /** Создать тенант вручную (суперадмин) */
  create: superAdminQuery
    .input(z.object({
      orgName:       z.string().min(2).max(100),
      ownerName:     z.string().min(2).max(100),
      ownerEmail:    z.string().email(),
      ownerPassword: z.string().min(8),
      plan:          z.enum(["trial", "basic", "pro", "exclusive"]).default("trial"),
      trialDays:     z.number().min(1).max(365).default(14),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      let slug = slugify(input.orgName);
      const base = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) slug = `${base}-${attempt++}`;

      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.ownerEmail)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });

      const passwordHash  = await hashPassword(input.ownerPassword);
      const trialEndsAt   = new Date(Date.now() + input.trialDays * 86_400_000);
      const planExpiresAt = input.plan !== "trial"
        ? new Date(Date.now() + 30 * 86_400_000)
        : null;

      let tenantId: number;
      await db.transaction(async (tx) => {
        const [r] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: input.plan,
          status: "active", trialEndsAt, planExpiresAt: planExpiresAt ?? undefined,
          ownerEmail: input.ownerEmail,
        });
        tenantId = Number(r.insertId);

        await tx.insert(users).values({
          tenantId, name: input.ownerName, email: input.ownerEmail,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
        });
        await tx.insert(settings).values({ tenantId, companyName: input.orgName });
      });

      await createTrialSubscription(tenantId!).catch((err) => {
        logger.error("Failed to create trial subscription for admin-created tenant", { tenantId: tenantId!, error: err instanceof Error ? err.message : String(err) });
      });

      return { success: true, slug, tenantId: tenantId! };
    }),

  /** Обновить тариф */
  updatePlan: superAdminQuery
    .input(z.object({
      tenantId:   z.number(),
      plan:       z.enum(["trial", "basic", "pro", "exclusive"]),
      expiryDays: z.number().min(1).max(3650).default(30),
    }))
    .mutation(async ({ input }) => {
      const db          = getDb();
      const planExpires = new Date(Date.now() + input.expiryDays * 86_400_000);

      await db.update(tenants)
        .set({ plan: input.plan, planExpiresAt: planExpires, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));

      // Обновить subscription запись если есть
      await db.update(subscriptions)
        .set({ plan: input.plan, status: "active", currentPeriodEnds: planExpires, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, input.tenantId));

      return { success: true };
    }),

  /** Приостановить / активировать */
  setStatus: superAdminQuery
    .input(z.object({
      tenantId: z.number(),
      status:   z.enum(["active", "suspended"]),
    }))
    .mutation(async ({ input }) => {
      await getDb().update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));
      return { success: true };
    }),

  /** Продлить trial */
  extendTrial: superAdminQuery
    .input(z.object({
      tenantId: z.number(),
      days:     z.number().min(1).max(365),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [tenant] = await db.select({ trialEndsAt: tenants.trialEndsAt })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);

      const base    = tenant?.trialEndsAt && tenant.trialEndsAt > new Date()
        ? tenant.trialEndsAt
        : new Date();
      const newDate = new Date(base.getTime() + input.days * 86_400_000);

      await db.update(tenants)
        .set({ trialEndsAt: newDate, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));

      await db.update(subscriptions)
        .set({ trialEndsAt: newDate, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, input.tenantId));

      return { success: true, trialEndsAt: newDate };
    }),

  /** Сбросить пароль владельца */
  resetOwnerPassword: superAdminQuery
    .input(z.object({
      tenantId:    z.number(),
      userId:      z.number(),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const db           = getDb();
      const passwordHash = await hashPassword(input.newPassword);
      await db.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  /** Общая сводка платформы */
  platformStats: superAdminQuery.query(async () => {
    const db = getDb();

    // Исключаем системный тенант из всей статистики
    const [tenantStat] = await db.select({ total: count(tenants.id) }).from(tenants).where(ne(tenants.slug, "system"));
    const [userStat]   = await db.select({ total: count(users.id) }).from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(ne(tenants.slug, "system"));
    const [orderStat]  = await db.select({ total: count(orders.id), revenue: sum(orders.total) }).from(orders);

    const byPlan = await db
      .select({ plan: tenants.plan, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.plan);

    const byStatus = await db
      .select({ status: tenants.status, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.status);

    // Новые тенанты по месяцам (последние 6, без системного)
    const growth = await db.execute(sql`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS cnt
      FROM tenants
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND slug != 'system'
      GROUP BY month ORDER BY month ASC
    `);

    return {
      tenants:  Number(tenantStat?.total ?? 0),
      users:    Number(userStat?.total   ?? 0),
      orders:   Number(orderStat?.total  ?? 0),
      revenue:  Number(orderStat?.revenue ?? 0),
      byPlan:   Object.fromEntries(byPlan.map(r => [r.plan, Number(r.cnt)])),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, Number(r.cnt)])),
      growth:   (growth as unknown as Array<{ month: string; cnt: string }>).map(r => ({
        month: r.month, count: Number(r.cnt),
      })),
    };
  }),
});

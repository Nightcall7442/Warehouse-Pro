import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./auth/password";
import { TRPCError } from "@trpc/server";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";
import { sanitizeSearch } from "./lib/sanitize";
import { recordAudit } from "./services/audit-log";

export const userRouter = createRouter({
  list: adminQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
      role:     z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(users.tenantId, tenantId)];
      if (input?.search) conditions.push(like(users.name, `%${sanitizeSearch(input.search)}%`));
      if (input?.role)   conditions.push(eq(users.role, input.role as any));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone,
                    avatar: users.avatar, role: users.role, status: users.status,
                    createdAt: users.createdAt, lastSignInAt: users.lastSignInAt })
          .from(users).where(where).limit(pageSize).offset(offset).orderBy(desc(users.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(users).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const [user] = await getDb().select({ id: users.id, name: users.name, email: users.email,
        phone: users.phone, role: users.role, status: users.status, createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt, avatar: users.avatar, tenantId: users.tenantId })
        .from(users).where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id))).limit(1);
      return user ?? null;
    }),

  me: authedQuery.query(({ ctx }) => ctx.user),

  // Update own profile (name, phone, avatar)
  updateMe: authedQuery
    .input(z.object({
      name:   z.string().min(2).max(100).optional(),
      phone:  z.string().optional(),
      avatar: z.string().max(5000000).optional(), // base64 data URL, max 5MB
    }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(users).set(input).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Change own password
  changePassword: authedQuery
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8, "New password must be at least 8 characters"),
    }))
    .mutation(async ({ input, ctx }) => {
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, { windowMs: 15 * 60 * 1000, limit: 5, namespace: "changePassword" })) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again in 15 minutes." });
      }

      const [user] = await getDb().select({
        id: users.id, passwordHash: users.passwordHash,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });

      const newHash = await hashPassword(input.newPassword);
      await getDb().update(users).set({ passwordHash: newHash }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Admin: update any user in same tenant
  update: adminQuery
    .input(z.object({
      id:     z.number(),
      name:   z.string().optional(),
      phone:  z.string().optional(),
      role:   z.enum(["ceo","operator","agent","supervisor","merchandiser","courier"]).optional(),
      status: z.enum(["active","inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, ...data } = input;

      // #FIX4: Prevent removing last active CEO
      if ((data.role && data.role !== "ceo") || data.status === "inactive") {
        const [target] = await db.select({ role: users.role, status: users.status })
          .from(users).where(and(eq(users.id, id), eq(users.tenantId, ctx.tenant.id))).limit(1);
        if (target?.role === "ceo" && target?.status === "active") {
          const [{ count }] = await db.select({ count: sql<number>`count(*)` })
            .from(users)
            .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo"), eq(users.status, "active")));
          if (count <= 1) {
            throw new Error("Нельзя деактивировать или сменить роль последнего активного CEO.");
          }
        }
      }

      // Capture before state for audit
      const [before] = await db.select({ role: users.role, status: users.status, name: users.name })
        .from(users).where(and(eq(users.id, id), eq(users.tenantId, ctx.tenant.id))).limit(1);

      await db.update(users).set(data)
        .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenant.id)));

      // Audit: user updated (role/status change)
      if (data.role || data.status) {
        recordAudit(db, {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "user.updated",
          targetType: "user",
          targetId: id,
          meta: { before: { role: before?.role, status: before?.status }, after: { role: data.role ?? before?.role, status: data.status ?? before?.status }, userName: before?.name },
          ip: getClientIp(ctx.req),
        });
      }
      return { success: true };
    }),

  // Admin: reset another user's password
  resetPassword: adminQuery
    .input(z.object({
      id:          z.number(),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const newHash = await hashPassword(input.newPassword);
      await db.update(users).set({ passwordHash: newHash })
        .where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id)));

      recordAudit(db, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "user.password_reset_by_admin",
        targetType: "user",
        targetId: input.id,
        ip: getClientIp(ctx.req),
      });
      return { success: true };
    }),

  // Admin: deactivate user
  deactivate: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // #FIX4: Prevent deactivating last active CEO
      const [target] = await db.select({ role: users.role, status: users.status, name: users.name })
        .from(users).where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (target?.role === "ceo" && target?.status === "active") {
        const [{ count }] = await db.select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo"), eq(users.status, "active")));
        if (count <= 1) {
          throw new Error("Нельзя деактивировать последнего активного CEO.");
        }
      }

      await db.update(users).set({ status: "inactive" })
        .where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id)));

      recordAudit(db, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "user.deactivated",
        targetType: "user",
        targetId: input.id,
        meta: { userName: target?.name, role: target?.role },
        ip: getClientIp(ctx.req),
      });
      return { success: true };
    }),
});

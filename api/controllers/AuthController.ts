import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "../auth/session";
import { verifyPassword, hashPassword } from "../auth/password";
import { findUserByEmailAnyTenant, updateUserLastSignIn } from "../queries/users";
import { findTenantById, findTenantBySlug } from "../queries/tenants";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";
import { getDb } from "../queries/connection";
import { tenants, users, settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { createTrialSubscription } from "../lib/subscription";
import { logger } from "../lib/logger";
import type { TrpcContext } from "../context";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20, namespace: "login" };
const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, limit: 5, namespace: "register" };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const AuthController = {
  async me(ctx: TrpcContext) {
    if (!ctx.user || !ctx.tenant) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Необходима авторизация" });
    }
    return {
      ...ctx.user,
      tenant: {
        id: ctx.tenant.id,
        slug: ctx.tenant.slug,
        name: ctx.tenant.name,
        plan: ctx.tenant.plan,
      },
    };
  },

  async login(ctx: TrpcContext, input: { email: string; password: string }) {
    const ip = getClientIp(ctx.req);
    if (!checkRateLimit(ip, LOGIN_RATE_LIMIT)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many login attempts. Please try again in 15 minutes.",
      });
    }

    const user = await findUserByEmailAnyTenant(input.email);

    const dummyHash = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(128);
    const valid = user?.passwordHash
      ? await verifyPassword(input.password, user.passwordHash)
      : await verifyPassword(input.password, dummyHash).then(() => false);

    if (!user || !valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
    }

    if (user.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Account is inactive." });
    }

    const tenant = await findTenantById(user.tenantId);
    if (!tenant || tenant.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Organisation is suspended." });
    }

    await updateUserLastSignIn(user.id);

    const token = await signSessionToken({ userId: user.id });
    const cookieOpts = getSessionCookieOptions(ctx.req.headers);

    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, token, {
        httpOnly: cookieOpts.httpOnly,
        path: cookieOpts.path,
        sameSite: (cookieOpts.sameSite as string)?.toLowerCase() as "lax" | "none",
        secure: cookieOpts.secure,
        maxAge: Session.maxAgeMs / 1000,
      }),
    );

    return {
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      },
    };
  },

  async register(
    ctx: TrpcContext,
    input: { orgName: string; name: string; email: string; password: string },
  ) {
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

    let newUserId!: number;
    await db.transaction(async (tx) => {
      const [tenantResult] = await tx.insert(tenants).values({
        slug, name: input.orgName, plan: "trial", status: "active",
      });
      const tenantId = Number(tenantResult.insertId);
      const [userResult] = await tx.insert(users).values({
        tenantId, name: input.name, email: input.email,
        passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
      });
      newUserId = Number(userResult.insertId);
      await tx.insert(settings).values({ tenantId, companyName: input.orgName });
    });

    const [newTenant] = await db.select({ id: tenants.id })
      .from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (newTenant?.id) await createTrialSubscription(newTenant.id).catch((err) => {
      logger.error("Failed to create trial subscription during registration", { tenantId: newTenant.id, error: err instanceof Error ? err.message : String(err) });
    });

    const token = await signSessionToken({ userId: newUserId });
    const cookieOpts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, token, {
        httpOnly: cookieOpts.httpOnly,
        path: cookieOpts.path,
        sameSite: (cookieOpts.sameSite as string)?.toLowerCase() as "lax" | "none",
        secure: cookieOpts.secure,
        maxAge: Session.maxAgeMs / 1000,
      }),
    );

    return { slug, message: "Organisation created. You can now sign in." };
  },

  async logout(ctx: TrpcContext) {
    const opts = getSessionCookieOptions(ctx.req.headers);

    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: true,
        path: "/",
        sameSite: opts.sameSite as "lax" | "none" | "strict",
        secure: opts.secure,
        maxAge: 0,
        expires: new Date(0),
      }),
    );

    return { success: true };
  },
};

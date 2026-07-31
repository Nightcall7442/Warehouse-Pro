import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";

/**
 * These helpers resolve their handle through `getDb()` on purpose: they run during
 * authentication — before a tRPC context exists — and from the WebSocket upgrade
 * path, which never passes through the request middleware. Inside a request the
 * ambient handle is the request's own (see runWithDb in api/boot.ts); outside one
 * it is the pooled instance.
 */
export async function findUserById(id: number) {
  const rows = await getDb()
    .select({
      id: schema.users.id,
      tenantId: schema.users.tenantId,
      name: schema.users.name,
      email: schema.users.email,
      avatar: schema.users.avatar,
      phone: schema.users.phone,
      role: schema.users.role,
      status: schema.users.status,
      tokenVersion: schema.users.tokenVersion,
      pushToken: schema.users.pushToken,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
      lastSignInAt: schema.users.lastSignInAt,
      telegramChatId: schema.users.telegramChatId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Returns user WITH passwordHash — only for auth flows (login, password change) */
export async function findUserByIdWithPassword(id: number) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Email is unique per tenant */
export async function findUserByEmail(tenantId: number, email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email)))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Used during login when we don't yet know the tenantId */
export async function findUserByEmailAnyTenant(email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .orderBy(schema.users.id) // P1-14 FIX: deterministic ordering for consistent results
    .limit(1);
  return rows.at(0) ?? null;
}

export async function createUser(data: InsertUser) {
  const [result] = await getDb().insert(schema.users).values(data);
  return findUserById(Number(result.insertId));
}

export async function updateUserLastSignIn(id: number) {
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, id));
}

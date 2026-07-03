import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";

export async function findUserById(id: number) {
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

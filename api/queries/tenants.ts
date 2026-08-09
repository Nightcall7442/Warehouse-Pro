import { eq, ne } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertTenant } from "@db/schema";
import { getDb } from "./connection";

export async function findTenantById(id: number) {
  const rows = await getDb()
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function findTenantBySlug(slug: string) {
  const rows = await getDb()
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function createTenant(data: InsertTenant) {
  const [result] = await getDb().insert(schema.tenants).values(data);
  return findTenantById(Number(result.insertId));
}

export async function listTenants() {
  // Исключаем системный тенант (slug="system") — нужен только для superadmin аккаунта
  return getDb()
    .select()
    .from(schema.tenants)
    .where(ne(schema.tenants.slug, "system"))
    .orderBy(schema.tenants.createdAt);
}

import { eq } from "drizzle-orm";
import { tenants } from "@db/schema";
import { getDb } from "../queries/connection";
import { invalidateAuthTenant } from "../auth";
import { recordAudit } from "./audit-log";

/** Выдать/забрать руководство: одна дверь для суперадмина и Telegram. */
export async function setManualAccessFor(tenantId: number, enabled: boolean, actor: { id?: number; name: string }) {
  const db = getDb();
  const [tenant] = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, manualEnabledAt: tenants.manualEnabledAt })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return null;
  const manualEnabledAt = enabled ? (tenant.manualEnabledAt ?? new Date()) : null;
  await db.update(tenants).set({ manualEnabledAt, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  // Сессии держат организацию в кэше — без сброса «Справка» появится через минуты.
  invalidateAuthTenant(tenantId);
  await recordAudit(db, {
    tenantId, actorId: actor.id, actorName: actor.name,
    action: enabled ? "tenant.manual_granted" : "tenant.manual_revoked",
    targetType: "tenant", targetId: tenantId, meta: { slug: tenant.slug },
  });
  return { tenantId, slug: tenant.slug, name: tenant.name, manualEnabledAt };
}

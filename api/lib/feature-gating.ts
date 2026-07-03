import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions } from "@db/schema";

/**
 * Returns true if the tenant has an active or trialing subscription.
 * Returns false if canceled, past_due, or no subscription found (grace period: 7 days past_due).
 */
export async function checkSubscriptionAccess(tenantId: number): Promise<boolean> {
  const db = getDb();
  const [sub] = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  if (!sub) return false; // No subscription — should not happen after tenant.register creates one

  if (sub.status === "active" || sub.status === "trialing") return true;

  // Grace period: 7 days for past_due before blocking
  if (sub.status === "past_due" && sub.currentPeriodEnds) {
    const gracePeriodEnd = new Date(sub.currentPeriodEnds.getTime() + 7 * 86_400_000);
    if (new Date() < gracePeriodEnd) return true;
  }

  return false;
}

/**
 * Get subscription status summary for a tenant.
 */
export async function getSubscriptionStatus(tenantId: number) {
  const db = getDb();
  const [sub] = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return sub ?? null;
}

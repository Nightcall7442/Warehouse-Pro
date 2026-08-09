/**
 * Shared subscription helpers used by tenant-router and billing-router.
 * Creates trial subscription when a new tenant is registered.
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions } from "@db/schema";

export async function createTrialSubscription(tenantId: number): Promise<void> {
  const db          = getDb();
  const trialEndsAt = new Date(Date.now() + 14 * 86_400_000);

  await db.insert(subscriptions).values({
    id:            randomUUID(),
    tenantId,
    plan:          "trial",
    status:        "trialing",
    trialEndsAt,
    currentPeriodEnds: trialEndsAt,
  });
}

export async function getOrCreateSubscription(tenantId: number) {
  const db  = getDb();
  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId)).limit(1);

  if (sub) return sub;

  // Auto-create trial if missing (shouldn't happen but safe fallback)
  await createTrialSubscription(tenantId);
  const [created] = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId)).limit(1);
  return created!;
}

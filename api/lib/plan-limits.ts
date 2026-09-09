import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants, users, products, orders } from "@db/schema";
import { PLANS } from "../../contracts/constants";

type DbInstance = ReturnType<typeof getDb>;

/**
 * Check if a tenant has reached their plan limit for a given resource.
 */
export async function checkPlanLimits(
  db: DbInstance,
  tenantId: number,
  resource: "users" | "products" | "orders"
): Promise<{ allowed: boolean; current: number; limit: number | null }> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return { allowed: false, current: 0, limit: 0 };

  const plan = PLANS[tenant.plan as keyof typeof PLANS];
  if (!plan) return { allowed: true, current: 0, limit: null };

  let current = 0;
  let limit: number | null = null;

  /*
    Предел тарифа плюс докупленное.

    Надбавка хранится в самой организации и живёт отдельно от тарифа: перешли
    на старший — докупленное осталось. Безлимитный тариф (null) надбавка не
    трогает: к «сколько угодно» прибавлять нечего.
  */
  const withExtra = (base: number | null, extra: number) =>
    base === null ? null : base + Math.max(0, Number(extra ?? 0));

  if (resource === "users") {
    limit = withExtra(plan.maxUsers, tenant.extraUsers);
    if (limit !== null) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.tenantId, tenantId));
      current = Number(count);
    }
  } else if (resource === "products") {
    limit = withExtra(plan.maxProducts, tenant.extraProducts);
    if (limit !== null) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.tenantId, tenantId));
      current = Number(count);
    }
  } else if (resource === "orders") {
    limit = plan.maxOrdersMonth;
    if (limit !== null) {
      const monthStart = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
      ).toISOString();
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            sql`${orders.createdAt} >= ${monthStart}`
          )
        );
      current = Number(count);
    }
  }

  return { allowed: limit === null || current < limit, current, limit };
}

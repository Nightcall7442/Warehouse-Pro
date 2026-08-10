import { Hono } from "hono";
import { eq, and, desc, isNull } from "drizzle-orm";
import { shops, orders, orderItems, products, payments } from "@db/schema";
import { getDb } from "./queries/connection";
import { env } from "./lib/env";
import * as jose from "jose";

/**
 * Shop QR Portal — public endpoint for shop owners.
 *
 * Each shop gets a signed URL that shows:
 * - Order history
 * - Current debt
 * - Recent payments
 * - Delivery status
 *
 * No authentication required — the URL itself is the credential.
 * Token is a JWT signed with APP_SECRET, containing shopId + tenantId.
 */

const app = new Hono();

// Generate a portal token for a shop
export function generatePortalToken(shopId: number, tenantId: number): string {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ shopId, tenantId, type: "portal" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("365d")
    .sign(secret);
}

// Verify a portal token
async function verifyPortalToken(token: string): Promise<{ shopId: number; tenantId: number } | null> {
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.type !== "portal") return null;
    return { shopId: payload.shopId as number, tenantId: payload.tenantId as number };
  } catch {
    return null;
  }
}

// ── GET /api/portal/:token — Shop portal data ────────────────────────────
app.get("/:token", async (c) => {
  const token = c.req.param("token");
  const claims = await verifyPortalToken(token);
  if (!claims) {
    return c.json({ error: "Недействительная ссылка" }, 401);
  }

  const db = getDb();
  const { shopId, tenantId } = claims;

  // Get shop info
  const [shop] = await db.select({
    id: shops.id,
    name: shops.name,
    ownerName: shops.ownerName,
    phone: shops.phone,
    address: shops.address,
    city: shops.city,
    district: shops.district,
    debt: shops.debt,
    status: shops.status,
    createdAt: shops.createdAt,
  })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
    .limit(1);

  if (!shop) {
    return c.json({ error: "Магазин не найден" }, 404);
  }

  // Get recent orders (last 30)
  const recentOrders = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    total: orders.total,
    createdAt: orders.createdAt,
  })
    .from(orders)
    .where(and(
      eq(orders.shopId, shopId),
      eq(orders.tenantId, tenantId),
      isNull(orders.deletedAt),
    ))
    .orderBy(desc(orders.createdAt))
    .limit(30);

  // Get recent payments (last 20)
  const recentPayments = await db.select({
    id: payments.id,
    amount: payments.amount,
    type: payments.type,
    notes: payments.notes,
    createdAt: payments.createdAt,
  })
    .from(payments)
    .where(and(
      eq(payments.shopId, shopId),
      eq(payments.tenantId, tenantId),
    ))
    .orderBy(desc(payments.createdAt))
    .limit(20);

  // Summary stats
  const totalOrders = recentOrders.length;
  const totalPaid = recentPayments
    .filter(p => p.type === "payment")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return c.json({
    shop: {
      name: shop.name,
      ownerName: shop.ownerName,
      phone: shop.phone,
      address: shop.address,
      city: shop.city,
      district: shop.district,
      debt: Number(shop.debt),
      memberSince: shop.createdAt,
    },
    summary: {
      totalOrders,
      totalPaid,
      currentDebt: Number(shop.debt),
    },
    orders: recentOrders.map(o => ({
      orderNumber: o.orderNumber,
      status: o.status,
      total: Number(o.total),
      date: o.createdAt,
    })),
    payments: recentPayments.map(p => ({
      amount: Number(p.amount),
      type: p.type,
      notes: p.notes,
      date: p.createdAt,
    })),
  });
});

export default app;

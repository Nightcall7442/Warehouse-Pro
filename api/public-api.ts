/**
 * Public REST API — validates API keys and exposes REST endpoints.
 * Only accessible to Exclusive tier tenants.
 */
import { Hono } from "hono";
import { getDb } from "./queries/connection";
import { apiKeys, products, orders, orderItems, warehouseStock, shops } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./lib/logger";

const app = new Hono();

// ── Rate limiting (in-memory per key) ────────────────────────────────────────
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(keyHash: string, limit: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(keyHash);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(keyHash, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

// ── API Key validation middleware ─────────────────────────────────────────────
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header. Use: Authorization: Bearer wp_live_..." }, 401);
  }
  const rawKey = authHeader.slice(7);
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const db = getDb();
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);

  if (!key) return c.json({ error: "Invalid API key" }, 401);
  if (key.status !== "active") return c.json({ error: "API key is suspended" }, 403);
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return c.json({ error: "API key has expired" }, 403);

  // Rate limit
  if (!checkRateLimit(keyHash, key.rateLimit)) {
    return c.json({ error: "Rate limit exceeded", retryAfter: 60 }, 429);
  }

  // Update last used
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

  // Set context
  c.set("tenantId", key.tenantId);
  c.set("scopes", key.scopes.split(","));
  await next();
});

// ── Scope check helper ───────────────────────────────────────────────────────
function requireScope(scopes: string[], required: string): boolean {
  return scopes.includes("read") || scopes.includes(required);
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/v1/products — list products */
app.get("/products", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "products")) return c.json({ error: "Scope 'products' required" }, 403);

  const db = getDb();
  const rows = await db.select().from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(desc(products.createdAt));
  return c.json({ data: rows, total: rows.length });
});

/** GET /api/v1/products/:id — get product by ID */
app.get("/products/:id", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "products")) return c.json({ error: "Scope 'products' required" }, 403);

  const db = getDb();
  const id = Number(c.req.param("id"));
  const [row] = await db.select().from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId))).limit(1);
  if (!row) return c.json({ error: "Product not found" }, 404);
  return c.json({ data: row });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/v1/orders — list orders */
app.get("/orders", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "orders")) return c.json({ error: "Scope 'orders' required" }, 403);

  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = await db.select().from(orders)
    .where(eq(orders.tenantId, tenantId))
    .orderBy(desc(orders.createdAt))
    .limit(limit).offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(orders).where(eq(orders.tenantId, tenantId));

  return c.json({ data: rows, total: count, limit, offset });
});

/** GET /api/v1/orders/:id — get order with items */
app.get("/orders/:id", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "orders")) return c.json({ error: "Scope 'orders' required" }, 403);

  const db = getDb();
  const id = Number(c.req.param("id"));
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, id), eq(orders.tenantId, tenantId))).limit(1);
  if (!order) return c.json({ error: "Order not found" }, 404);

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  return c.json({ data: { ...order, items } });
});

// ══════════════════════════════════════════════════════════════════════════════
// STOCK
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/v1/stock — list stock levels */
app.get("/stock", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "stock")) return c.json({ error: "Scope 'stock' required" }, 403);

  const db = getDb();
  const rows = await db.select().from(warehouseStock)
    .where(eq(warehouseStock.tenantId, tenantId));
  return c.json({ data: rows, total: rows.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHOPS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/v1/shops — list shops */
app.get("/shops", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "read")) return c.json({ error: "Scope 'read' required" }, 403);

  const db = getDb();
  const rows = await db.select().from(shops)
    .where(eq(shops.tenantId, tenantId));
  return c.json({ data: rows, total: rows.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════════════════

app.get("/health", (c) => c.json({ status: "ok", version: "v1" }));

export default app;

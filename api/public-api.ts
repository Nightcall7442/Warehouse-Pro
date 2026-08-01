/**
 * Public REST API — validates API keys and exposes REST endpoints.
 * Only accessible to Exclusive tier tenants.
 */
import { Hono } from "hono";
import { getDb } from "./queries/connection";
import { apiKeys, products, orders, orderItems, warehouseStock, shops } from "../db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { checkRateLimit as sharedCheckRateLimit } from "./lib/rate-limit";
import { logger } from "./lib/logger";
import { apiKeyPrefix, lookupHashes, upgradeApiKeyHashes, verifyKey } from "./lib/api-key";

const app = new Hono();

/** Verification attempts allowed per minute per key prefix (Argon2 is expensive). */
const VERIFY_ATTEMPTS_PER_MINUTE = 10;

// ── API Key validation middleware ─────────────────────────────────────────────
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header. Use: Authorization: Bearer wp_live_..." }, 401);
  }
  const rawKey = authHeader.slice(7);

  // Throttle *before* any Argon2 work so a flood of guesses cannot burn CPU.
  // Keyed on the (public, low-entropy) prefix, which is all we know pre-lookup.
  const verifyAllowed = await sharedCheckRateLimit(apiKeyPrefix(rawKey), {
    windowMs: 60_000,
    limit: VERIFY_ATTEMPTS_PER_MINUTE,
    namespace: "api-key-verify",
  });
  if (!verifyAllowed) {
    return c.json({ error: "Rate limit exceeded", retryAfter: 60 }, 429);
  }

  // O(1) indexed lookup that matches both the peppered HMAC (current) and the
  // unsalted sha256 (legacy) forms of `keyHash`.
  const hashes = lookupHashes(rawKey);
  const db = getDb();
  const [key] = await db.select().from(apiKeys)
    .where(inArray(apiKeys.keyHash, [hashes.current, hashes.legacy]))
    .limit(1);

  if (!key) return c.json({ error: "Invalid API key" }, 401);

  // Argon2id verification when the row has a secret hash; legacy rows fall back
  // to the deterministic lookup value and get rehashed below.
  const verification = await verifyKey(key, rawKey);
  if (verification.status === "rejected") return c.json({ error: "Invalid API key" }, 401);

  if (key.status !== "active") return c.json({ error: "API key is suspended" }, 403);
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return c.json({ error: "API key has expired" }, 403);

  // Rate limit (using shared Redis-backed limiter).
  // FIX: this was called without `await`, so a Promise (always truthy) was
  // negated and the per-key limit never triggered.
  const allowed = await sharedCheckRateLimit(key.keyHash, {
    windowMs: 60_000,
    limit: key.rateLimit,
    namespace: "public-api",
  });
  if (!allowed) {
    return c.json({ error: "Rate limit exceeded", retryAfter: 60 }, 429);
  }

  // Rehash legacy rows in place. Detached so the request is not held up by a
  // second Argon2 hash, but failures are logged rather than swallowed.
  if (verification.needsUpgrade) {
    void upgradeApiKeyHashes(rawKey)
      .then(fields => db.update(apiKeys).set(fields).where(eq(apiKeys.id, key.id)))
      .then(() => logger.info("Upgraded API key hash to argon2id", { apiKeyId: key.id, tenantId: key.tenantId }))
      .catch((err: unknown) => logger.error("Failed to upgrade API key hash to argon2id", {
        apiKeyId: key.id,
        tenantId: key.tenantId,
        error: err instanceof Error ? err.message : String(err),
      }));
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
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = await db.select().from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(desc(products.createdAt))
    .limit(limit).offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(products).where(eq(products.tenantId, tenantId));

  return c.json({ data: rows, total: count, limit, offset });
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

  const rows = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
    total: orders.total, shopId: orders.shopId, agentId: orders.agentId,
    createdAt: orders.createdAt,
  }).from(orders)
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
  const [order] = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
    total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
    shopId: orders.shopId, agentId: orders.agentId, notes: orders.notes,
    createdAt: orders.createdAt,
  }).from(orders)
    .where(and(eq(orders.id, id), eq(orders.tenantId, tenantId))).limit(1);
  if (!order) return c.json({ error: "Order not found" }, 404);

  const items = await db.select().from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orderItems.orderId, id), eq(orders.tenantId, tenantId)));
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
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = await db.select().from(warehouseStock)
    .where(eq(warehouseStock.tenantId, tenantId))
    .limit(limit).offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(warehouseStock).where(eq(warehouseStock.tenantId, tenantId));

  return c.json({ data: rows, total: count, limit, offset });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHOPS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/v1/shops — list shops */
app.get("/shops", async (c) => {
  const tenantId = c.get("tenantId") as number;
  const scopes = c.get("scopes") as string[];
  if (!requireScope(scopes, "shops")) return c.json({ error: "Scope 'shops' required" }, 403);

  const db = getDb();
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = await db.select().from(shops)
    .where(eq(shops.tenantId, tenantId))
    .limit(limit).offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(shops).where(eq(shops.tenantId, tenantId));

  return c.json({ data: rows, total: count, limit, offset });
});

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════════════════

app.get("/health", (c) => c.json({ status: "ok", version: "v1" }));

export default app;

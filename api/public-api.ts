/**
 * Public REST API — validates API keys and exposes REST endpoints.
 * Only accessible to Exclusive tier tenants.
 */
import { Hono } from "hono";
import { getDb } from "./queries/connection";
import { apiKeys, tenants, products, orders, orderItems, warehouseStock, shops } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { checkRateLimit as sharedCheckRateLimit } from "./lib/rate-limit";
import { hasSubscriptionAccess } from "./lib/feature-gating";

/** What the API-key middleware below puts on the context for every route. */
type PublicApiVariables = {
  tenantId: number;
  scopes: string[];
};

const app = new Hono<{ Variables: PublicApiVariables }>();

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

  // Rate limit (using shared Redis-backed limiter)
  // await matters: checkRateLimit is async, and `!promise` is always false —
  // without it this branch never ran and every key's configured rateLimit was
  // decoration.
  if (!(await sharedCheckRateLimit(keyHash, { windowMs: 60_000, limit: key.rateLimit, namespace: "public-api" }))) {
    return c.json({ error: "Rate limit exceeded", retryAfter: 60 }, 429);
  }

  // ── Состояние организации, которой принадлежит ключ ────────────────────────
  //
  // Ключ проверялся сам по себе: жив, не просрочен, укладывается в лимит. Про
  // организацию не спрашивали ничего, и поэтому отключить неплательщика было
  // фактически нельзя. Веб и мобильное приложение закрываются двумя разными
  // калитками — withSubscriptionGate в tRPC и проверка tenants.status в
  // authenticateRequest, — а этот вход стоял мимо обеих: подписка кончилась,
  // суперадмин поставил status='suspended', сотрудники видят экран оплаты, а
  // GET /api/v1/orders с тем же ключом продолжает бессрочно отдавать заказы,
  // остатки и магазины.
  //
  // Проверка стоит здесь, в общем middleware, а не в каждом маршруте: новый
  // маршрут ниже закрывается сам, забыть его нельзя.
  const [tenant] = await db.select({ status: tenants.status, plan: tenants.plan })
    .from(tenants).where(eq(tenants.id, key.tenantId)).limit(1);

  if (!tenant || tenant.status !== "active") {
    return c.json({ error: "Organisation is suspended. Contact support." }, 403);
  }

  // API продаётся как возможность тарифа Exclusive (см. заголовок файла и
  // список возможностей тарифа на экране оплаты). Ключ при этом выписывается
  // на любом тарифе, включая trial: apiKey.create тариф не смотрит. Пока это
  // так, единственное место, где тариф вообще проверяется, — вот это.
  if (tenant.plan !== "exclusive") {
    return c.json({ error: "Public API requires the Exclusive plan." }, 403);
  }

  // 402, а не 403: подписку продлевают, а не выпрашивают права. По коду
  // интегратор отличает «заплатите» от «вам сюда нельзя» без разбора текста.
  if (!(await hasSubscriptionAccess(key.tenantId))) {
    return c.json({ error: "Subscription expired. Renew to continue using the API." }, 402);
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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
  const tenantId = c.get("tenantId");
  const scopes = c.get("scopes");
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

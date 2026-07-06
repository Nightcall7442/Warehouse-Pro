import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { payments, shops, warehouseStock, tenants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { OneCMapper } from "../services/onec-mapper";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { safeEqual } from "../lib/safe-compare";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();

// ── Auth: global secret + validate tenantId exists ───────────────────────────
app.use("/*", async (c, next) => {
  const secret = c.req.header("X-1C-Secret");
  if (!safeEqual(secret ?? "", env.onecWebhookSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // #FIX2: Validate tenantId from body exists in DB — prevents cross-tenant forgery
  try {
    const body = await c.req.json();
    if (!body?.tenantId) {
      return c.json({ error: "Missing tenantId" }, 400);
    }
    const db = getDb();
    const [tenant] = await db.select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.id, body.tenantId)).limit(1);
    if (!tenant) {
      return c.json({ error: "Invalid tenant" }, 403);
    }
    // Re-inject validated body so downstream handlers don't re-parse
    c.set("validatedBody", body);
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  return next();
});

app.post("/payment", async (c) => {
  try {
    const body = c.get("validatedBody") ?? await c.req.json();
    const { tenantId: tenantIdRaw, shopExternalId, amount, reference } = body;

    const tenantId = Number(tenantIdRaw);
    if (!Number.isFinite(tenantId) || typeof shopExternalId !== "string" || amount == null) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // #FIX3: Validate amount
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return c.json({ error: "Invalid amount: must be a positive number" }, 400);
    }

    const db = getDb();

    const shopId = await OneCMapper.getInternalId(db, tenantId, "shop", shopExternalId);
    if (!shopId) {
      return c.json({ error: "Shop not mapped" }, 400);
    }

    await db.transaction(async (tx) => {
      // #FIX3: Check shop exists and validate against outstanding debt
      const [shop] = await tx.select({ debt: shops.debt })
        .from(shops)
        .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
        .limit(1);

      if (!shop) {
        throw new Error("Shop not found");
      }

      const currentDebt = Number(shop.debt);
      if (parsedAmount > currentDebt) {
        logger.warn("Payment exceeds debt", { tenantId, shopId, amount: parsedAmount, debt: currentDebt });
        // Allow but log warning — don't block legitimate overpayments from 1C
      }

      await tx.insert(payments).values({
        tenantId,
        shopId,
        amount: parsedAmount.toFixed(2),
        type: "payment",
        notes: `1C: ${reference ?? "Payment"}`,
      });

      const newDebt = Math.max(0, currentDebt - parsedAmount);
      await tx.update(shops)
        .set({ debt: String(newDebt) })
        .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
    });

    logger.info("Payment received from 1C", { tenantId, shopId, amount: parsedAmount });
    return c.json({ success: true });
  } catch (e) {
    logger.error("1C payment webhook error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

app.post("/stock", async (c) => {
  try {
    const body = c.get("validatedBody") ?? await c.req.json();
    const { tenantId: tenantIdRaw, productExternalId, quantity } = body;

    const tenantId = Number(tenantIdRaw);
    if (!Number.isFinite(tenantId) || typeof productExternalId !== "string" || quantity == null) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // #FIX3: Validate quantity
    const parsedQty = Number(quantity);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      return c.json({ error: "Invalid quantity: must be a non-negative number" }, 400);
    }

    const db = getDb();

    const productId = await OneCMapper.getInternalId(db, tenantId, "product", productExternalId);
    if (!productId) {
      return c.json({ error: "Product not mapped" }, 400);
    }

    await db.transaction(async (tx) => {
      const [existingStock] = await tx.select({ reserved: warehouseStock.reserved })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId)))
        .limit(1);
      const reserved = Number(existingStock?.reserved ?? 0);
      const available = parsedQty - reserved;

      await tx.insert(warehouseStock).values({
        tenantId,
        productId,
        currentStock: parsedQty.toFixed(2),
        reserved: existingStock ? existingStock.reserved : "0.00",
        available: String(available),
      }).onDuplicateKeyUpdate({
        set: {
          currentStock: parsedQty.toFixed(2),
          available: String(available),
        },
      });
    });

    logger.info("Stock update received from 1C", { tenantId, productId, quantity: parsedQty });
    return c.json({ success: true });
  } catch (e) {
    logger.error("1C stock webhook error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

export default app;

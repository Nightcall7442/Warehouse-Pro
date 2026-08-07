import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { payments, shops, warehouseStock, warehouses, onecConfig } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { OneCMapper } from "../services/onec-mapper";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { safeEqual } from "../lib/safe-compare";
import { recalcShopDebt } from "../services/shop-debt";
import { recordStockMovement } from "../services/stock-ledger";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();

// ── Auth: global secret + validate tenantId exists and has 1C configured ─────
// TODO: Replace global secret with per-tenant webhook secret for proper isolation
app.use("/*", async (c, next) => {
  const secret = c.req.header("X-1C-Secret");
  if (!safeEqual(secret ?? "", env.onecWebhookSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json();
    if (!body?.tenantId) {
      return c.json({ error: "Missing tenantId" }, 400);
    }
    const db = getDb();

    // Validate tenant exists AND has 1C integration configured
    const [config] = await db.select({ tenantId: onecConfig.tenantId })
      .from(onecConfig)
      .where(eq(onecConfig.tenantId, body.tenantId))
      .limit(1);
    if (!config) {
      logger.warn("1C webhook: tenant not found or not configured", { tenantId: body.tenantId });
      return c.json({ error: "Tenant not configured for 1C integration" }, 403);
    }

    c.set("validatedBody", body);
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  return next();
});

app.post("/payment", async (c) => {
  try {
    const body = c.get("validatedBody");
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

    // Номер документа 1С и есть метка попытки: ретрай после таймаута присылает
    // тот же reference, и уникальный индекс не даст записать оплату дважды.
    //
    // Прежняя защита — «поискать платёж с такой же заметкой» — стояла ДО
    // транзакции и потому не защищала: два ретрая, пришедшие одновременно, оба
    // видели пусто и оба вставляли строку. Долг магазина уменьшался вдвое.
    // Сравнение шло к тому же по тексту заметки, так что вручную введённая
    // заметка «1C: 123» могла случайно погасить настоящий платёж.
    const idempotencyKey = typeof reference === "string" && reference
      ? `1c:${reference}`.slice(0, 100)
      : undefined;

    try {
      await db.transaction(async (tx) => {
        // #FIX3: Check shop exists and validate against outstanding debt
        const [shop] = await tx.select({ debt: shops.debt })
          .from(shops)
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
          .limit(1)
          .for("update");

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
          idempotencyKey,
        });

        await recalcShopDebt(tx, tenantId, shopId);
      });
    } catch (e) {
      // Отказ по уникальному индексу означает: этот документ уже проведён, а
      // транзакция откатилась целиком — лишней строки нет, долг не тронут. 1С
      // получает тот же успех, что и с первого раза: ошибка заставила бы её
      // повторять снова или считать оплату непринятой.
      //
      // Условие на ключ обязательно: без reference столбец пуст, конфликтовать
      // нечему, и ER_DUP_ENTRY означал бы нарушение другого индекса, которое
      // нельзя выдавать за принятую оплату.
      if (idempotencyKey && (e as { code?: string } | null)?.code === "ER_DUP_ENTRY") {
        logger.info("1C payment already processed", { tenantId, shopId, reference });
        return c.json({ success: true, duplicate: true });
      }
      throw e;
    }

    logger.info("Payment received from 1C", { tenantId, shopId, amount: parsedAmount });
    return c.json({ success: true });
  } catch (e) {
    logger.error("1C payment webhook error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

app.post("/stock", async (c) => {
  try {
    const body = c.get("validatedBody");
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
        .limit(1)
        .for("update");
      const reserved = Number(existingStock?.reserved ?? 0);
      const available = parsedQty - reserved;

      // Get default warehouse for tenant
      const [defaultWarehouse] = await tx.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
        .limit(1);

      if (!defaultWarehouse) {
        logger.error("No default warehouse found for tenant", { tenantId });
        return c.json({ success: false, error: "No default warehouse" }, 400);
      }

      await tx.insert(warehouseStock).values({
        tenantId,
        warehouseId: defaultWarehouse.id,
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

      // 1C states the count outright rather than a delta, so the ledger records
      // an adjustment to that figure — the size of the correction is whatever
      // the count moved by.
      await recordStockMovement(tx, {
        tenantId, warehouseId: defaultWarehouse.id, productId,
        type: "adjustment", quantity: parsedQty,
        reason: "onec_sync", notes: `1C: остаток установлен в ${parsedQty}`,
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

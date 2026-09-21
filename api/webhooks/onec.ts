import { Hono } from "hono";
import { getDb } from "../queries/connection";
import { payments, shops, warehouses, onecConfig, tenants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { OneCMapper } from "../services/onec-mapper";
import { logger } from "../lib/logger";
import { createHash } from "crypto";
import { safeEqual } from "../lib/safe-compare";
import { hasSubscriptionAccess } from "../lib/feature-gating";
import { recalcShopDebt } from "../services/shop-debt";
import { recordStockMovement, setStock, StockBelowReserveError } from "../services/stock-ledger";
import { invalidateReports } from "../lib/report-cache";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();

// ── Аутентификация: секрет принадлежит организации, а не платформе ───────────
//
// Здесь стоял один секрет на всех (ONEC_WEBHOOK_SECRET), а организация бралась
// из тела запроса и ей верили. Секрет такого рода знает каждый клиент с
// интеграцией и каждый подрядчик, который её настраивал, — и любой из них мог
// прислать чужой tenantId, провести платёж по чужому магазину или переписать
// чужие остатки. Рядом стоял `TODO: Replace global secret with per-tenant
// webhook secret for proper isolation`.
//
// Теперь наоборот: по хешу присланного секрета ищется конфигурация, и
// организация берётся ИЗ НЕЁ. Тело запроса больше не решает, чьи это данные —
// подделать чужой tenantId нельзя, не зная её секрета.
app.use("/*", async (c, next) => {
  const presented = c.req.header("X-1C-Secret") ?? "";
  // Пустой секрет отсекается сразу: иначе он совпал бы с организацией, у
  // которой секрет ещё не выпущен, если бы хеш пустой строки попал в базу.
  if (!presented) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb();
  const presentedHash = createHash("sha256").update(presented).digest("hex");

  const [config] = await db.select({
    tenantId: onecConfig.tenantId,
    secretHash: onecConfig.webhookSecretHash,
  })
    .from(onecConfig)
    .where(eq(onecConfig.webhookSecretHash, presentedHash))
    .limit(1);

  // Неизвестный секрет и выключенная интеграция отвечают одинаково: по ответу
  // нельзя перебором выяснить, у какой организации вебхук включён.
  if (!config?.secretHash || !safeEqual(config.secretHash, presentedHash)) {
    logger.warn("1C webhook: неизвестный секрет");
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  // tenantId в теле теперь необязателен и ни на что не влияет. Если он всё же
  // прислан и не совпадает — это либо ошибка настройки на стороне 1С, либо
  // попытка выдать себя за другую организацию. Оба случая стоят отказа, а не
  // молчаливого исправления: тихо подменив на правильный, мы записали бы
  // данные, которых 1С не имела в виду.
  if (body?.tenantId !== undefined && Number(body.tenantId) !== config.tenantId) {
    logger.warn("1C webhook: tenantId в теле не совпадает с владельцем секрета", {
      owner: config.tenantId, claimed: body.tenantId,
    });
    return c.json({ error: "tenantId does not match the secret owner" }, 403);
  }

  // Подписка и статус — как у людей: приостановленная или неоплаченная
  // организация не проводит платежи и остатки и через 1С (аудит 20.09.2026).
  const [tenant] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, config.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organisation is suspended" }, 403);
  if (!(await hasSubscriptionAccess(config.tenantId))) return c.json({ error: "Subscription inactive" }, 402);
  // Обработчики ниже читают организацию отсюда, а не из тела.
  c.set("validatedBody", { ...body, tenantId: config.tenantId });
  return next();
});

app.post("/payment", async (c) => {
  try {
    const body = c.get("validatedBody");
    const { tenantId: tenantIdRaw, shopExternalId, amount, reference, method: methodRaw } = body;

    const tenantId = Number(tenantIdRaw);
    if (!Number.isFinite(tenantId) || typeof shopExternalId !== "string" || amount == null) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Оплата, о которой сообщает 1С, — это запись в учёте: без способа
    // считаем её поступлением на счёт (выписка банка), не наличными в сейфе.
    // Безнал из 1С подтверждён самим фактом: сверять его с выпиской нечего.
    const method = methodRaw == null ? "transfer" : String(methodRaw);
    if (!["cash", "card", "transfer"].includes(method)) {
      return c.json({ error: "Invalid method: cash, card or transfer" }, 400);
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
          paymentMethod: method as "cash" | "card" | "transfer",
          notes: `1C: ${reference ?? "Payment"}`,
          idempotencyKey,
          ...(method !== "cash" ? { bankConfirmedAt: new Date(), bankRef: `1С ${reference ?? ""}`.trim().slice(0, 64) } : {}),
        });

        await recalcShopDebt(tx, tenantId, shopId);
      });
      await invalidateReports(tenantId, "onec.payment");
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

    logger.info("Payment received from 1C", { tenantId, shopId, amount: parsedAmount, method });
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

    // Склад ищется ДО транзакции, а не внутри неё.
    //
    // Внутри стояло `return c.json({ success: false }, 400)` — но это возврат из
    // колбэка транзакции, его значение просто отбрасывается. Выполнение шло
    // дальше, и наружу уходило `{ success: true }`: 1С считала остаток
    // проведённым, хотя склада по умолчанию нет и записать было некуда.
    const [defaultWarehouse] = await db.select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
      .limit(1);

    if (!defaultWarehouse) {
      logger.error("No default warehouse found for tenant", { tenantId });
      return c.json({ success: false, error: "No default warehouse" }, 400);
    }

    try {
      await db.transaction(async (tx) => {
        // 1С называет итог. Дверь ставит его, выводит available и подрезает
        // партии — раньше всё это считалось здесь руками, а партии не
        // трогались вовсе.
        await setStock(tx, { tenantId, warehouseId: defaultWarehouse.id, productId, quantity: parsedQty });

        // 1C states the count outright rather than a delta, so the ledger records
        // an adjustment to that figure — the size of the correction is whatever
        // the count moved by.
        await recordStockMovement(tx, {
          tenantId, warehouseId: defaultWarehouse.id, productId,
          type: "adjustment", quantity: parsedQty,
          reason: "onec_sync", notes: `1C: остаток установлен в ${parsedQty}`,
        });
      });
    } catch (e) {
      // 1С назвала число меньше отложенного под заказы. Прежде резерв
      // обрезался молча; теперь 1С слышит отказ и остаток не трогается.
      if (!(e instanceof StockBelowReserveError)) throw e;
      logger.warn("1C stock below reserve", { tenantId, productId, quantity: parsedQty, reserved: e.reserved });
      return c.json({ success: false, error: "Stock below reserved", reserved: e.reserved, quantity: parsedQty }, 409);
    }
    await invalidateReports(tenantId, "onec.stock");

    logger.info("Stock update received from 1C", { tenantId, productId, quantity: parsedQty });
    return c.json({ success: true });
  } catch (e) {
    logger.error("1C stock webhook error", { error: String(e) });
    return c.json({ error: "Internal error" }, 500);
  }
});

export default app;

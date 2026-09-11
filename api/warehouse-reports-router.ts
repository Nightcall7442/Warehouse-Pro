import { z } from "zod";
import { createRouter, operatorQuery, supervisorQuery, managementQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  warehouseStock, products, stockMovements,
  orderItems, orders, arrivals, arrivalItems,
  stockBatches, warehouses,
} from "@db/schema";
import { eq, and, sql, desc, gt } from "drizzle-orm";
import { revenueOrderConditions } from "./lib/order-status";
import { dayKey } from "./lib/period";

export const warehouseReportsRouter = createRouter({
  /** Stock breakdown by product category */
  /*
    managementQuery, а не supervisorQuery.

    Страница «Отчёты по складу» открыта ceo и оператору (RoleGuard в
    App.tsx), а два её блока из пяти стояли на supervisorQuery — это ceo и
    СУПЕРВАЙЗЕР. То есть оператор открывал свой отчёт и видел два пустых
    блока с отказом, хотя остальные три (operatorQuery) грузились.
  */
  stockByCategory: managementQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.tenant.id;

    const result = await db.select({
      category: sql<string>`COALESCE(${products.category}, 'Без категории')`,
      totalProducts: sql<number>`COUNT(DISTINCT ${products.id})`,
      totalUnits: sql<number>`COALESCE(SUM(${warehouseStock.currentStock}), 0)`,
      totalValue: sql<number>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`,
      totalRetail: sql<number>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0)), 0)`,
      lowStockCount: sql<number>`COUNT(CASE WHEN ${warehouseStock.available} <= ${products.reorderPoint} THEN 1 END)`,
    })
      .from(warehouseStock)
      .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
      .where(eq(warehouseStock.tenantId, tenantId))
      .groupBy(sql`COALESCE(${products.category}, 'Без категории')`)
      .orderBy(desc(sql`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`));

    return result;
  }),

  /** Stock movement trends — daily in/out for last N days */
  movementTrends: managementQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      const result = await db.select({
        date: sql<string>`DATE(${stockMovements.createdAt})`,
        inQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'in' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        outQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'out' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        adjustmentQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'adjustment' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        movements: sql<number>`COUNT(*)`,
      })
        .from(stockMovements)
        .where(and(
          eq(stockMovements.tenantId, tenantId),
          sql`${stockMovements.createdAt} >= ${cutoff}`,
        ))
        .groupBy(sql`DATE(${stockMovements.createdAt})`)
        .orderBy(sql`DATE(${stockMovements.createdAt})`);

      return result;
    }),

  /** Top products by inventory value */
  topByValue: operatorQuery
    .input(z.object({ limit: z.number().int().min(1).max(1000).default(10) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      return db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        category: products.category,
        unit: products.unit,
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
        costPrice: products.costPrice,
        unitPrice: products.unitPrice,
        costValue: sql<number>`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`,
        retailValue: sql<number>`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0), 0)`,
        margin: sql<number>`COALESCE(${warehouseStock.currentStock} * (COALESCE(${products.unitPrice}, 0) - COALESCE(${products.costPrice}, 0)), 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.currentStock} > 0`))
        .orderBy(desc(sql`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`))
        .limit(input?.limit ?? 10);
    }),

  /** Arrival logistics costs summary */
  arrivalCosts: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      const [summary] = await db.select({
        totalArrivals: sql<number>`COUNT(*)`,
        totalFuelCost: sql<number>`COALESCE(SUM(${arrivals.fuelCost}), 0)`,
        totalTollCost: sql<number>`COALESCE(SUM(${arrivals.tollCost}), 0)`,
        totalOtherCost: sql<number>`COALESCE(SUM(${arrivals.otherCost}), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
        totalUnits: sql<number>`COALESCE((SELECT SUM(${arrivalItems.quantity}) FROM ${arrivalItems} INNER JOIN ${arrivals} a ON ${arrivalItems.arrivalId} = a.id WHERE a.tenant_id = ${tenantId} AND a.created_at >= ${cutoff}), 0)`,
      })
        .from(arrivals)
        .where(and(
          eq(arrivals.tenantId, tenantId),
          sql`${arrivals.createdAt} >= ${cutoff}`,
        ));

      // Daily breakdown
      const daily = await db.select({
        date: sql<string>`DATE(${arrivals.createdAt})`,
        arrivals: sql<number>`COUNT(*)`,
        fuelCost: sql<number>`COALESCE(SUM(${arrivals.fuelCost}), 0)`,
        tollCost: sql<number>`COALESCE(SUM(${arrivals.tollCost}), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
      })
        .from(arrivals)
        .where(and(
          eq(arrivals.tenantId, tenantId),
          sql`${arrivals.createdAt} >= ${cutoff}`,
        ))
        .groupBy(sql`DATE(${arrivals.createdAt})`)
        .orderBy(sql`DATE(${arrivals.createdAt})`);

      return { summary, daily };
    }),

  /** Stock turnover — products sold vs avg inventory over period */
  turnover: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      // Продажи считаются ОДНИМ предварительным агрегатом и приджойниваются
      // как производная таблица.
      //
      // Раньше тот же SUM стоял коррелированным подзапросом дважды — в SELECT
      // и в ORDER BY, — а ORDER BY выполняется до LIMIT, то есть подзапрос
      // отрабатывал для КАЖДОЙ строки warehouse_stock, а не для двадцати
      // возвращаемых. При 3000 товарах на двух складах это 6000 строк × 2
      // подзапроса, и в каждом — обход idx_order_items_product плюс lookup в
      // orders по первичному ключу на каждую позицию. На реальной истории
      // заказов «Отчёты по складу» уходили в таймаут клиента, а сервер
      // продолжал крутить запрос. Агрегат по товарам считается один раз и
      // ложится в память целиком: строк в нём не больше, чем товаров.
      const soldByProduct = db.select({
        productId: orderItems.productId,
        sold: sql<string>`SUM(${orderItems.quantity})`.as("sold"),
      })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          ...revenueOrderConditions(tenantId),
          sql`${orders.createdAt} >= ${cutoff}`,
        ))
        .groupBy(orderItems.productId)
        .as("sold_by_product");

      const result = await db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        unit: products.unit,
        currentStock: warehouseStock.currentStock,
        soldQty: sql<number>`COALESCE(${soldByProduct.sold}, 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .leftJoin(soldByProduct, eq(soldByProduct.productId, warehouseStock.productId))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.currentStock} > 0`))
        .orderBy(desc(sql`COALESCE(${soldByProduct.sold}, 0)`))
        .limit(20);

      return result.map(r => {
        const stock = Number(r.currentStock ?? 0);
        const sold = Number(r.soldQty);
        const avgInventory = stock + sold / 2; // rough average
        const turnoverRate = avgInventory > 0 ? (sold / avgInventory).toFixed(2) : "0";
        const daysToSell = sold > 0 ? Math.round(stock / (sold / days)) : 999;
        return { ...r, turnoverRate, daysToSell };
      });
    }),

  /** Dynamic reorder point — calculates days until stockout based on sales velocity */
  reorderAlerts: supervisorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      // Get products with current stock and sales velocity
      const result = await db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        category: products.category,
        currentStock: warehouseStock.currentStock,
        reorderPoint: warehouseStock.reorderPoint,
        soldQty: sql<string>`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.deleted_at IS NULL AND o.status = 'delivered' AND o.created_at >= ${cutoff}), 0)`,
      })
        .from(warehouseStock)
        .innerJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(eq(warehouseStock.tenantId, tenantId))
        .orderBy(sql`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.deleted_at IS NULL AND o.status = 'delivered' AND o.created_at >= ${cutoff}), 0) DESC`)
        .limit(50);

      return result.map(r => {
        const stock = Number(r.currentStock ?? 0);
        const sold = Number(r.soldQty);
        const dailyVelocity = sold / days; // units per day
        const daysUntilStockout = dailyVelocity > 0 ? Math.round(stock / dailyVelocity) : 999;

        // Dynamic reorder point: velocity * lead time (assume 7 days lead time)
        const dynamicReorderPoint = Math.ceil(dailyVelocity * 7);

        // Alert levels
        let alertLevel: "ok" | "warning" | "critical" = "ok";
        if (daysUntilStockout <= 3) alertLevel = "critical";
        else if (daysUntilStockout <= 7) alertLevel = "warning";

        return {
          ...r,
          dailyVelocity: dailyVelocity.toFixed(2),
          daysUntilStockout,
          dynamicReorderPoint,
          alertLevel,
        };
      });
    }),
  /* ══════════════════════════════════════════════════════════════════════════
     ЧТО СГОРАЕТ

     ── Зачем ──────────────────────────────────────────────────────────────────

     Срок годности записывался на приёмке и там же и оставался: на остатке
     лежало одно число на товар, без памяти о том, какими партиями оно
     набралось. Ответить, что сгорит через неделю, было нечем — данные на входе
     есть, учёта нет. Кладовщик узнавал об этом, когда шёл списывать.

     Теперь остаток каждой партии живёт в stock_batches, и двигает его та же
     дверь, что и остаток (api/services/stock-ledger.ts).

     ── Про «уже просрочено» ───────────────────────────────────────────────────

     Просроченное — отдельное состояние, а не «минус три дня» в общем списке:
     это разные действия. По сгорающему ещё можно что-то сделать — сдвинуть в
     акцию, отгрузить ближнему магазину. Просроченное списывают. Одним списком
     человек их путает.
     ══════════════════════════════════════════════════════════════════════════ */
  expiring: operatorQuery
    .input(z.object({
      /** За сколько дней вперёд смотреть. */
      withinDays: z.number().int().min(1).max(365).default(30),
      warehouseId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const withinDays = input?.withinDays ?? 30;

      /*
        Граница считается по календарю сервера, а не через toISOString.

        Колонка expires_at — DATE, и сравнивается со строкой «ГГГГ-ММ-ДД».
        Печать через UTC при восточном смещении даёт вчерашний день, и партия,
        сгорающая сегодня, попала бы в «просроченные». Тот же случай, что с
        ключом месяца в api/lib/period.ts.
      */
      const today = dayKey(new Date());
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + withinDays);
      const until = dayKey(horizon);

      const conditions = [
        eq(stockBatches.tenantId, tenantId),
        // Партия с нулевым остатком уже ушла: показать её сгорающей значит
        // позвать человека списывать то, чего нет.
        gt(stockBatches.quantity, "0"),
        sql`${stockBatches.expiresAt} IS NOT NULL`,
        sql`${stockBatches.expiresAt} <= ${until}`,
      ];
      if (input?.warehouseId) conditions.push(eq(stockBatches.warehouseId, input.warehouseId));

      const rows = await db.select({
        batchId:       stockBatches.id,
        productId:     stockBatches.productId,
        productName:   products.name,
        productCode:   products.code,
        unit:          products.unit,
        warehouseId:   stockBatches.warehouseId,
        warehouseName: warehouses.name,
        batchNumber:   stockBatches.batchNumber,
        expiresAt:     stockBatches.expiresAt,
        quantity:      stockBatches.quantity,
        // Цена ЗАКУПКИ: столько денег сгорает вместе с товаром. Цена продажи
        // здесь ни при чём — непроданный товар выручки не приносил.
        costPrice:     products.costPrice,
        daysLeft:      sql`DATEDIFF(${stockBatches.expiresAt}, ${today})`.mapWith(Number),
      })
        .from(stockBatches)
        .innerJoin(products, and(eq(stockBatches.productId, products.id), eq(products.tenantId, tenantId)))
        .leftJoin(warehouses, and(eq(stockBatches.warehouseId, warehouses.id), eq(warehouses.tenantId, tenantId)))
        .where(and(...conditions))
        .orderBy(stockBatches.expiresAt)
        .limit(500);

      return rows.map(r => {
        const daysLeft = Number(r.daysLeft ?? 0);
        const quantity = Number(r.quantity ?? 0);
        return {
          ...r,
          quantity,
          daysLeft,
          value: Number((quantity * Number(r.costPrice ?? 0)).toFixed(2)),
          /*
            Три состояния, а не число дней: по ним принимают РАЗНЫЕ решения.
            Просроченное — списать, горящее — двигать сегодня, остальное —
            держать в виду.
          */
          state: daysLeft < 0 ? "expired" as const
               : daysLeft <= 7 ? "urgent" as const
               : "soon" as const,
        };
      });
    }),

  /** Свод по сгорающему — для плитки, чтобы не тянуть весь список. */
  expiringSummary: operatorQuery
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const withinDays = input?.withinDays ?? 30;
      const today = dayKey(new Date());
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + withinDays);
      const until = dayKey(horizon);

      const [row] = await db.select({
        expiredCount: sql`COUNT(CASE WHEN ${stockBatches.expiresAt} < ${today} THEN 1 END)`.mapWith(Number),
        expiredValue: sql`COALESCE(SUM(CASE WHEN ${stockBatches.expiresAt} < ${today} THEN ${stockBatches.quantity} * COALESCE(${products.costPrice}, 0) ELSE 0 END), 0)`.mapWith(Number),
        urgentCount:  sql`COUNT(CASE WHEN ${stockBatches.expiresAt} >= ${today} AND DATEDIFF(${stockBatches.expiresAt}, ${today}) <= 7 THEN 1 END)`.mapWith(Number),
        soonCount:    sql`COUNT(CASE WHEN DATEDIFF(${stockBatches.expiresAt}, ${today}) > 7 THEN 1 END)`.mapWith(Number),
        liveValue:    sql`COALESCE(SUM(CASE WHEN ${stockBatches.expiresAt} >= ${today} THEN ${stockBatches.quantity} * COALESCE(${products.costPrice}, 0) ELSE 0 END), 0)`.mapWith(Number),
      })
        .from(stockBatches)
        .innerJoin(products, and(eq(stockBatches.productId, products.id), eq(products.tenantId, tenantId)))
        .where(and(
          eq(stockBatches.tenantId, tenantId),
          gt(stockBatches.quantity, "0"),
          sql`${stockBatches.expiresAt} IS NOT NULL`,
          sql`${stockBatches.expiresAt} <= ${until}`,
        ));

      return {
        expiredCount: Number(row?.expiredCount ?? 0),
        expiredValue: Number(row?.expiredValue ?? 0),
        urgentCount:  Number(row?.urgentCount ?? 0),
        soonCount:    Number(row?.soonCount ?? 0),
        liveValue:    Number(row?.liveValue ?? 0),
      };
    }),

  /*
    Из чего сложился остаток одного товара.

    Открывается из карточки товара: «на складе 240, из них 90 сгорают через
    неделю». Без этого разреза общее число о риске не говорит ничего.

    Остаток БЕЗ партии показывается отдельной строкой, а не прячется: партии
    покрывают не всё — товар, лежавший до появления учёта, бытовая химия без
    срока и вернувшийся от магазина товар партии не имеют. Спрятать разницу
    значило бы показать на экране меньше, чем лежит на полке.
  */
  productBatches: operatorQuery
    .input(z.object({
      productId: z.number().int().positive(),
      warehouseId: z.number().int().positive().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const today = dayKey(new Date());

      const conditions = [
        eq(stockBatches.tenantId, tenantId),
        eq(stockBatches.productId, input.productId),
        gt(stockBatches.quantity, "0"),
      ];
      if (input.warehouseId) conditions.push(eq(stockBatches.warehouseId, input.warehouseId));

      const batches = await db.select({
        batchId:     stockBatches.id,
        warehouseId: stockBatches.warehouseId,
        batchNumber: stockBatches.batchNumber,
        expiresAt:   stockBatches.expiresAt,
        quantity:    stockBatches.quantity,
        receivedAt:  stockBatches.receivedAt,
        daysLeft:    sql`CASE WHEN ${stockBatches.expiresAt} IS NULL THEN NULL ELSE DATEDIFF(${stockBatches.expiresAt}, ${today}) END`.mapWith(Number),
      })
        .from(stockBatches)
        .where(and(...conditions))
        // Тот же порядок, в котором списывает FEFO: человек видит, что уйдёт
        // первым, ровно так же, как это решит система.
        .orderBy(sql`${stockBatches.expiresAt} IS NULL`, stockBatches.expiresAt, stockBatches.receivedAt);

      const stockConditions = [
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.productId, input.productId),
      ];
      if (input.warehouseId) stockConditions.push(eq(warehouseStock.warehouseId, input.warehouseId));

      const [total] = await db.select({
        onHand: sql`COALESCE(SUM(${warehouseStock.currentStock}), 0)`.mapWith(Number),
      }).from(warehouseStock).where(and(...stockConditions));

      const inBatches = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
      const onHand = Number(total?.onHand ?? 0);

      return {
        onHand,
        inBatches: Number(inBatches.toFixed(2)),
        /*
          Остаток, про срок которого сказать нечего. Отрицательным он быть не
          может — дверь не даёт партиям превысить остаток; нижняя граница стоит
          на случай строк, разъехавшихся до появления этой проверки.
        */
        untracked: Number(Math.max(0, onHand - inBatches).toFixed(2)),
        batches: batches.map(b => ({
          ...b,
          quantity: Number(b.quantity),
          daysLeft: b.daysLeft == null ? null : Number(b.daysLeft),
        })),
      };
    }),
});

import { z } from "zod";
import { createRouter, fieldSalesQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProductsBelongToTenant } from "./lib/tenant-refs";
import { returns, returnItems, orderItems, shops, users, products, orders, warehouseStock, warehouses } from "@db/schema";
import { eq, and, desc, sql, ne } from "drizzle-orm";
import { cache, CacheKeys } from "./lib/cache";
import { sanitizeString } from "./lib/sanitize";
import { recalcShopDebt } from "./services/shop-debt";
import { recordStockMovement } from "./services/stock-ledger";

import { affectedRows } from "./lib/db-rows";
export const returnsRouter = createRouter({
  // List returns
  list: fieldSalesQuery
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected", "completed"]).optional(),
      shopId: z.number().optional(),
      orderId: z.number().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(25),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(returns.tenantId, ctx.tenant.id)];
      if (input?.status) conditions.push(eq(returns.status, input.status));
      if (input?.shopId) conditions.push(eq(returns.shopId, input.shopId));
      if (input?.orderId) conditions.push(eq(returns.orderId, input.orderId));

      const [data, countResult] = await Promise.all([
        db.select({
          id: returns.id,
          returnNumber: returns.returnNumber,
          orderId: returns.orderId,
          shopId: returns.shopId,
          shopName: shops.name,
          status: returns.status,
          reason: returns.reason,
          notes: returns.notes,
          totalAmount: returns.totalAmount,
          createdAt: returns.createdAt,
        }).from(returns)
          .leftJoin(shops, eq(returns.shopId, shops.id))
          .where(and(...conditions))
          .orderBy(desc(returns.createdAt))
          .limit(input?.pageSize ?? 25)
          .offset(((input?.page ?? 1) - 1) * (input?.pageSize ?? 25)),
        db.select({ count: sql<number>`count(*)` }).from(returns).where(and(...conditions)),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0) };
    }),

  // Get return by ID with items
  getById: fieldSalesQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [ret] = await db.select({
        id: returns.id,
        returnNumber: returns.returnNumber,
        orderId: returns.orderId,
        shopId: returns.shopId,
        shopName: shops.name,
        agentId: returns.agentId,
        agentName: users.name,
        status: returns.status,
        reason: returns.reason,
        notes: returns.notes,
        totalAmount: returns.totalAmount,
        createdAt: returns.createdAt,
      }).from(returns)
        .leftJoin(shops, eq(returns.shopId, shops.id))
        .leftJoin(users, eq(returns.agentId, users.id))
        .where(and(eq(returns.id, input.id), eq(returns.tenantId, ctx.tenant.id)))
        .limit(1);

      if (!ret) return null;

      const items = await db.select({
        id: returnItems.id,
        productId: returnItems.productId,
        productName: products.name,
        productCode: products.code,
        quantity: returnItems.quantity,
        unitPrice: returnItems.unitPrice,
        subtotal: returnItems.subtotal,
        reason: returnItems.reason,
        condition: returnItems.condition,
      }).from(returnItems)
        .innerJoin(returns, eq(returnItems.returnId, returns.id))
        .leftJoin(products, and(eq(returnItems.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(returnItems.returnId, input.id), eq(returns.tenantId, ctx.tenant.id)));

      return { ...ret, items };
    }),

  // Create return
  create: fieldSalesQuery
    .input(z.object({
      orderId: z.number().optional(),
      shopId: z.number().int().positive(),
      reason: z.enum(["defect", "wrong_item", "expired", "damaged", "other"]),
      notes: z.string().optional(),
      items: z.array(z.object({
        productId: z.number(),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
        reason: z.string().optional(),
        condition: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Validate shop belongs to tenant
      const [shop] = await db.select({ id: shops.id }).from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id))).limit(1);
      if (!shop) throw new Error("Магазин не найден");

      // Товары проверяются ВСЕГДА, а не только когда указан заказ. Возврат без
      // заказа — обычный путь (брак, пересорт), и раньше он принимал любой
      // product_id, а чтение соединялось с products без границы организации и
      // отдавало чужие название и код. Причём путь открыт рядовому агенту, и
      // одобрение оператора для утечки не требовалось: хватало возврата в
      // статусе «на рассмотрении».
      await assertProductsBelongToTenant(db, ctx.tenant.id, input.items.map(i => i.productId));

      const raw = crypto.randomUUID().replace(/-/g, "");
      const returnNumber = `RET-${raw.slice(0, 12).toUpperCase()}`;

      // Validate items against original order if provided
      if (input.orderId) {
        const [order] = await db.select({ tenantId: orders.tenantId })
          .from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order || order.tenantId !== ctx.tenant.id) {
          throw new Error(`Заказ #${input.orderId} не найден`);
        }

        const orderItemsData = await db.select().from(orderItems)
          .where(and(eq(orderItems.orderId, input.orderId)))
          // Заказ выше уже проверен по организации, но соединение с общей
          // таблицей товаров всё равно несёт границу: цена одной забытой
          // проверки здесь — чужие название и код в ответе, а стоимость самого
          // условия нулевая, потому что для нормальных данных выборка та же.
          .leftJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, ctx.tenant.id)));

        // Sum quantities already returned for this order
        const existingReturns = await db.select({
          productId: returnItems.productId,
          totalReturned: sql<string>`COALESCE(SUM(${returnItems.quantity}), 0)`,
        }).from(returnItems)
          .innerJoin(returns, eq(returnItems.returnId, returns.id))
          // A rejected return never happened — the goods were never accepted
          // back, so it must not block a later, legitimate return of the same
          // item. Pending/approved/completed all still count: those returns
          // are expected to (or already did) bring the goods back.
          .where(and(eq(returns.orderId, input.orderId), eq(returns.tenantId, ctx.tenant.id), ne(returns.status, "rejected")))
          .groupBy(returnItems.productId);
        const returnedMap = new Map<number, number>();
        for (const er of existingReturns) returnedMap.set(er.productId, Number(er.totalReturned));

        for (const item of input.items) {
          const original = orderItemsData.find(o => o.order_items.productId === item.productId);
          if (!original) {
            throw new Error(`Товар ID ${item.productId} отсутствует в заказе #${input.orderId}`);
          }
          const alreadyReturned = returnedMap.get(item.productId) ?? 0;
          // Вернуть можно только то, что реально доехало до магазина.
          //
          // Сравнение шло с ЗАКАЗАННЫМ количеством. Курьер, отдавший 4 из 10 и
          // отметивший это как частичный возврат, уже вернул 6 единиц на склад
          // — но order_items.quantity остаётся десяткой, поэтому документ на
          // все 10 проходил проверку. При проведении те же 6 зачислялись на
          // склад второй раз, а из долга магазина вычиталась стоимость десяти
          // при заказе, стоящем как четыре. Инвариант склада при этом
          // сходится, так что сверка целостности молчала.
          //
          // deliveredQuantity пусто у заказов, доставленных без построчного
          // учёта, — там заказанное и есть отгруженное. Тот же COALESCE стоит
          // в deliveredQty() и в heldQuantity().
          const shipped = Number(original.order_items.deliveredQuantity ?? original.order_items.quantity);
          if (alreadyReturned + Number(item.quantity) > shipped) {
            throw new Error(`Количество возврата превышает доставленное для товара ID ${item.productId} (уже возвращено: ${alreadyReturned}, доставлено: ${shipped})`);
          }
        }
        // Use original order unit prices, not client-supplied
        input.items = input.items.map(item => {
          const original = orderItemsData.find(o => o.order_items.productId === item.productId);
          return {
            ...item,
            unitPrice: Number(original!.order_items.unitPrice),
          };
        });
      }

      const totalAmount = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

      // Use transaction for atomicity
      const returnId = await db.transaction(async (tx) => {
        const [result] = await tx.insert(returns).values({
          tenantId: ctx.tenant.id,
          orderId: input.orderId ?? null,
          shopId: input.shopId,
          agentId: ctx.user.id,
          returnNumber,
          reason: input.reason,
          notes: input.notes ? sanitizeString(input.notes) : null,
          totalAmount: totalAmount.toFixed(2),
          createdBy: ctx.user.id,
        });

        const id = Number(result.insertId);

        // Insert return items
        await tx.insert(returnItems).values(input.items.map(item => ({
          returnId: id,
          productId: item.productId,
          quantity: item.quantity.toFixed(2),
          unitPrice: item.unitPrice.toFixed(2),
          subtotal: (item.unitPrice * item.quantity).toFixed(2),
          reason: item.reason ? sanitizeString(item.reason) : null,
          condition: item.condition ? sanitizeString(item.condition) : null,
        })));

        return id;
      });

      cache.invalidate(CacheKeys.returns(ctx.tenant.id));
      return { id: returnId, returnNumber };
    }),

  // Update return status (operator only)
  updateStatus: operatorQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "approved", "rejected", "completed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Всё решение — чтение статуса, проверка связанного заказа, проверка
      // допустимости перехода и сама запись — происходит ВНУТРИ транзакции, под
      // блокировкой строки возврата.
      //
      // Раньше статус читался здесь, снаружи и без блокировки, транзакция
      // открывалась только ради движения остатка, а UPDATE статуса не имел
      // условия по прежнему значению. Поэтому двойной щелчок по «Завершить»
      // (или повтор запроса по таймауту) проходил дважды: оба вызова видели
      // approved, оба входили внутрь, оба выполняли прибавляющий UPDATE
      // остатка и оба писали completed. Возврат на 10 единиц против полки в 100
      // оставлял current_stock = 120: товар возникал из воздуха, и две записи в
      // журнале движений делали историю согласованной с испорченной цифрой.
      // Склад потом продавал 10 единиц, которых нет.
      //
      // Блокировка склада, что стояла ниже, помочь не могла: она запирает
      // warehouse_stock, а не строку возврата, и к моменту её взятия решение
      // «переводим в completed» уже было принято обоими вызовами.
      await db.transaction(async (tx) => {
      const [ret] = await tx.select({ status: returns.status, totalAmount: returns.totalAmount, shopId: returns.shopId, orderId: returns.orderId })
        .from(returns).where(and(eq(returns.id, input.id), eq(returns.tenantId, tenantId)))
        .for("update")
        .limit(1);
      if (!ret) throw new Error("Возврат не найден");

      // The order this return belongs to may itself already have been marked
      // cancelled/returned, which credits every one of its units back to stock
      // on its own. Completing the document too would put the same goods on
      // the shelf twice. Both return routes stay available — they just can't
      // both be applied to the same order.
      if (input.status === "completed" && ret.orderId) {
        const [linkedOrder] = await tx.select({ status: orders.status, orderNumber: orders.orderNumber })
          .from(orders)
          .where(and(eq(orders.id, ret.orderId), eq(orders.tenantId, tenantId)))
          .limit(1);
        if (linkedOrder && (linkedOrder.status === "cancelled" || linkedOrder.status === "returned")) {
          const label = linkedOrder.status === "cancelled" ? "отменён" : "возвращён";
          throw new Error(
            `Заказ ${linkedOrder.orderNumber} уже ${label} — товар по нему возвращён на склад целиком. ` +
            `Проведение этого возврата зачислило бы тот же товар второй раз.`);
        }
        // Обратная сторона той же ошибки: возврат по заказу, который со склада
        // ещё не уезжал. Товар в этом случае лежит в резерве, а не у магазина,
        // и зачисление на склад создало бы единицы из воздуха.
        if (linkedOrder && !["delivered", "completed"].includes(linkedOrder.status)) {
          throw new Error(
            `Заказ ${linkedOrder.orderNumber} ещё не доставлен (статус «${linkedOrder.status}») — ` +
            `возвращать с него нечего. Если заказ не нужен, его отменяют, а не возвращают.`);
        }
      }

      const validTransitions: Record<string, string[]> = {
        pending: ["approved", "rejected"],
        approved: ["completed"],
        rejected: [],
        completed: [],
      };
      const allowed = validTransitions[ret.status];
      if (!allowed || !allowed.includes(input.status)) {
        throw new Error(`Невозможно перевести из "${ret.status}" в "${input.status}"`);
      }

      // Only add stock on "completed" — never before approval
      if (input.status === "completed") {
        {
          // Returned goods land in one warehouse. Without this filter the quantity
          // was added to every warehouse holding the product, inflating stock by a
          // multiple of the return for multi-warehouse tenants.
          const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
            .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
          const whId = defaultWh?.id;
          if (!whId) throw new Error("Склад по умолчанию не найден");

          // Lock stock rows and add items back to inventory
          const items = await tx.select().from(returnItems).where(eq(returnItems.returnId, input.id));
          for (const item of items) {
            await tx.select({ id: warehouseStock.id }).from(warehouseStock)
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, whId)))
              .for("update");
          }
          if (items.length > 0) {
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET
                current_stock = current_stock + CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
                ), sql`\n`)} ELSE 0 END,
                available = available + CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
                ), sql`\n`)} ELSE 0 END
              WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
                AND tenant_id = ${tenantId}
                AND warehouse_id = ${whId}
            `);
            for (const item of items) {
              await recordStockMovement(tx, {
                tenantId, warehouseId: whId, productId: item.productId,
                type: "in", quantity: Number(item.quantity),
                reason: "return_completed", referenceId: input.id,
                notes: "Возврат принят на склад",
              });
            }
          }

          // Условие по прежнему статусу — вторая половина защиты. Даже если
          // блокировка выше почему-то не сработала, перевести возврат в
          // completed сможет только тот вызов, который застал его approved;
          // второй увидит ноль изменённых строк и откатит свою транзакцию
          // вместе с уже начисленным остатком.
          const done = affectedRows(await tx.update(returns).set({ status: input.status })
            .where(and(
              eq(returns.id, input.id),
              eq(returns.tenantId, tenantId),
              eq(returns.status, "approved"),
            )));
          if (done !== undefined && done !== 1) {
            throw new Error("Возврат уже проведён — повторное зачисление на склад отменено");
          }

          // A completed return is no longer owed for; re-derive the balance
          // now that the return's status is written.
          await recalcShopDebt(tx, tenantId, ret.shopId);
        }
      } else {
        // Прочие переходы тоже защищены прежним значением: два одновременных
        // вызова не должны, например, оба перевести pending в разные статусы.
        const done = affectedRows(await tx.update(returns)
          .set({ status: input.status })
          .where(and(
            eq(returns.id, input.id),
            eq(returns.tenantId, tenantId),
            eq(returns.status, ret.status),
          )));
        if (done !== undefined && done !== 1) {
          throw new Error("Статус возврата изменился — повторите операцию");
        }
      }
      });

      cache.invalidate(CacheKeys.returns(tenantId));
      return { success: true };
    }),

  // Returns summary by reason
  summary: operatorQuery.query(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    return db.select({
      reason: returns.reason,
      count: sql<number>`COUNT(*)`,
      totalAmount: sql<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
    }).from(returns)
      .where(and(
        eq(returns.tenantId, ctx.tenant.id),
        sql`${returns.createdAt} >= ${monthStart}`,
      ))
      .groupBy(returns.reason);
  }),
});

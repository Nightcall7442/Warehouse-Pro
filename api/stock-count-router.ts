import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, operatorQuery, can } from "./middleware";
import { products, stockCountItems, stockCounts, warehouseStock, warehouses, users } from "@db/schema";
import { recordStockMovement, setStock, StockBelowReserveError } from "./services/stock-ledger";
import { recordAudit } from "./services/audit-log";
import { cache } from "./lib/cache";
import { invalidateReports } from "./lib/report-cache";

type Db = ReturnType<typeof import("./queries/connection").getDb>;

/*
  Инвентаризация как документ.

  Пересчёт полки был кнопкой «Скорректировать» по одному товару: без
  «ожидалось / посчитано», без итога недостачи, без единого действия
  «применить». Здесь: черновик со снимком остатков склада, строка на товар
  с посчитанным числом (сканер прибавляет единицу), применение одним
  действием через дверь остатка — и в журнале движений «инвентаризация» по
  каждой разнице. Применённый документ не правится: он и есть акт.
*/

const money2 = (n: number) => n.toFixed(2);

async function loadCount(db: Db, tenantId: number, id: number) {
  const [count] = await db.select().from(stockCounts)
    .where(and(eq(stockCounts.id, id), eq(stockCounts.tenantId, tenantId))).limit(1);
  if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
  return count;
}

export const stockCountRouter = createRouter({
  list: operatorQuery
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const rows = await db.select({
        id: stockCounts.id, number: stockCounts.number, status: stockCounts.status,
        warehouseId: stockCounts.warehouseId, warehouseName: warehouses.name,
        createdAt: stockCounts.createdAt, appliedAt: stockCounts.appliedAt, notes: stockCounts.notes,
        createdByName: users.name,
        lines: sql<number>`(SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = ${stockCounts.id})`.mapWith(Number),
        counted: sql<number>`(SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = ${stockCounts.id} AND i.counted IS NOT NULL)`.mapWith(Number),
      }).from(stockCounts)
        .leftJoin(warehouses, eq(stockCounts.warehouseId, warehouses.id))
        .leftJoin(users, eq(stockCounts.createdBy, users.id))
        .where(eq(stockCounts.tenantId, ctx.tenant.id))
        .orderBy(desc(stockCounts.createdAt))
        .limit(input?.limit ?? 50);
      return rows;
    }),

  /**
   * Новый черновик: строка на каждый товар со строкой остатка на складе,
   * expected — учётный остаток на этот момент. Снимок нужен, чтобы «ожидалось»
   * не плыло, пока считают: продажи идут, а акт — про момент начала.
   */
  create: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({ warehouseId: z.number().int().positive(), notes: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.tenantId, ctx.tenant.id))).limit(1);
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });

      const [{ n }] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(stockCounts)
        .where(eq(stockCounts.tenantId, ctx.tenant.id));
      const number = `ИНВ-${n + 1}`;

      const id = await db.transaction(async (tx) => {
        const [r] = await tx.insert(stockCounts).values({
          tenantId: ctx.tenant.id, warehouseId: wh.id, number, notes: input.notes ?? null, createdBy: ctx.user.id,
        });
        const countId = Number(r.insertId);
        const rows = await tx.select({ productId: warehouseStock.productId, current: warehouseStock.currentStock })
          .from(warehouseStock)
          .innerJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id), eq(products.status, "active")))
          .where(and(eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, wh.id)));
        if (rows.length > 0) {
          await tx.insert(stockCountItems).values(rows.map(r => ({ countId, productId: r.productId, expected: String(r.current ?? "0.00") })));
        }
        return countId;
      });
      await recordAudit(db, { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: "stock_count.create", targetType: "stock_count", targetId: id, meta: { number, warehouseId: wh.id } });
      return { id, number };
    }),

  get: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const count = await loadCount(db, ctx.tenant.id, input.id);
      const items = await db.select({
        id: stockCountItems.id, productId: stockCountItems.productId, expected: stockCountItems.expected,
        counted: stockCountItems.counted, note: stockCountItems.note,
        productName: products.name, productCode: products.code, barcode: products.barcode, unit: products.unit, costPrice: products.costPrice,
      }).from(stockCountItems)
        .innerJoin(products, eq(stockCountItems.productId, products.id))
        .where(eq(stockCountItems.countId, count.id))
        .orderBy(products.name);
      return { ...count, items };
    }),

  /** Посчитанное по одному товару; сканер зовёт с delta: +1. */
  setCounted: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      id: z.number().int().positive(),
      productId: z.number().int().positive(),
      counted: z.number().min(0).max(1e9).nullable().optional(),
      delta: z.number().int().min(-1000).max(1000).optional(),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const count = await loadCount(db, ctx.tenant.id, input.id);
      if (count.status !== "draft") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Документ уже применён или отменён" });

      const [item] = await db.select({ id: stockCountItems.id }).from(stockCountItems)
        .where(and(eq(stockCountItems.countId, count.id), eq(stockCountItems.productId, input.productId))).limit(1);
      let itemId = item?.id;
      if (!itemId) {
        // Товар, которого в учёте на этом складе не было: ожидалось ноль.
        const [p] = await db.select({ id: products.id }).from(products)
          .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id))).limit(1);
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Товар не найден в вашей организации" });
        const [r] = await db.insert(stockCountItems).values({ countId: count.id, productId: p.id, expected: "0.00" });
        itemId = Number(r.insertId);
      }
      /*
        Учётный остаток в минуту первого счёта — book_at_count. По нему акт
        потом двигает остаток (applyCount), а не ставит «посчитано» поверх
        продаж и приходов, прошедших между счётом и применением.

        Прибавка сканера (+1) — одним UPDATE в базе, а не «прочитал — прибавил —
        записал»: два сканера на одном товаре теряли друг у друга прибавку.
      */
      const current = sql`(SELECT ws.current_stock FROM warehouse_stock ws
        WHERE ws.tenant_id = ${ctx.tenant.id} AND ws.warehouse_id = ${count.warehouseId} AND ws.product_id = ${input.productId} LIMIT 1)`;
      const note = input.note !== undefined ? { note: input.note } : {};
      if (input.delta != null) {
        await db.update(stockCountItems).set({
          counted: sql`GREATEST(0, COALESCE(${stockCountItems.counted}, 0) + ${input.delta})`,
          bookAtCount: sql`COALESCE(${stockCountItems.bookAtCount}, ${current}, 0)`,
          ...note,
        }).where(eq(stockCountItems.id, itemId));
      } else {
        const counted = input.counted ?? null;
        await db.update(stockCountItems).set({
          counted: counted == null ? null : money2(counted),
          // «Не считали» снова — и снимок забывается: посчитают заново — снимут заново.
          bookAtCount: counted == null ? null : sql`COALESCE(${stockCountItems.bookAtCount}, ${current}, 0)`,
          ...note,
        }).where(eq(stockCountItems.id, itemId));
      }
      const [after] = await db.select({ counted: stockCountItems.counted }).from(stockCountItems)
        .where(eq(stockCountItems.id, itemId)).limit(1);
      return { counted: after?.counted == null ? null : Number(after.counted) };
    }),

  /**
   * Применить: каждой посчитанной строке — setStock (дверь обрезает резерв и
   * подрезает партии), разница — в журнал движений. Непосчитанные строки не
   * трогаются: «не считали» — не «ноль».
   *
   * Остаток двигается на расхождение, найденное при счёте, — «посчитано»
   * минус учёт в ту минуту (book_at_count), — а не ставится равным
   * «посчитано». Стояло второе: посчитали 100, потом курьер увёз 20, акт
   * применили — снова 100 и «излишек 20» в журнале; приход после счёта
   * списывался как недостача (бизнес-аудит 19.11.2026, п. 3). Строки без
   * снимка (посчитаны до колонки) применяются по-старому.
   */
  // «apply» — служебное слово у tRPC (router({}) его не принимает), поэтому applyCount.
  applyCount: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const result = await db.transaction(async (tx) => {
        const [count] = await tx.select().from(stockCounts)
          .where(and(eq(stockCounts.id, input.id), eq(stockCounts.tenantId, ctx.tenant.id))).for("update").limit(1);
        if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
        if (count.status !== "draft") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Документ уже применён или отменён" });

        const items = await tx.select({ productId: stockCountItems.productId, counted: stockCountItems.counted, bookAtCount: stockCountItems.bookAtCount })
          .from(stockCountItems).where(eq(stockCountItems.countId, count.id));
        const toApply = items.filter(i => i.counted != null);
        if (toApply.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Ни одна строка не посчитана — применять нечего" });

        let surplus = 0, shortage = 0, changed = 0;
        for (const it of toApply) {
          const counted = Number(it.counted);
          const [row] = await tx.select({ current: warehouseStock.currentStock }).from(warehouseStock)
            .where(and(eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, count.warehouseId), eq(warehouseStock.productId, it.productId)))
            .for("update").limit(1);
          const current = Number(row?.current ?? 0);
          const target = it.bookAtCount != null
            ? Math.max(0, Math.round((current + counted - Number(it.bookAtCount)) * 100) / 100)
            : counted;
          const diff = target - current;
          if (Math.abs(diff) < 0.005) continue;
          try {
            await setStock(tx, { tenantId: ctx.tenant.id, warehouseId: count.warehouseId, productId: it.productId, quantity: target });
          } catch (e) {
            // На полке насчитали меньше, чем отложено под заказы. Дверь
            // отказывает числом — здесь называем товар: без имени отказ
            // читается как придирка к цифре. Акт не применяется целиком.
            if (!(e instanceof StockBelowReserveError)) throw e;
            const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, it.productId)).limit(1);
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `«${p?.name ?? `товар #${it.productId}`}»: после акта остаётся ${money2(target)}, а под заказы отложено ${money2(e.reserved)}. Сначала проведите или отмените заказы, занявшие резерв, — потом примените акт.`,
            });
          }
          await recordStockMovement(tx, {
            tenantId: ctx.tenant.id, warehouseId: count.warehouseId, productId: it.productId,
            type: diff > 0 ? "in" : "out", quantity: Math.abs(diff), reason: "inventory", referenceId: count.id,
            notes: it.bookAtCount != null
              ? `${count.number}: при счёте по учёту ${money2(Number(it.bookAtCount))}, на полке ${money2(counted)}`
              : `${count.number}: по учёту ${money2(current)}, на полке ${money2(counted)}`,
          });
          if (diff > 0) surplus += diff; else shortage += -diff;
          changed++;
        }
        await tx.update(stockCounts).set({ status: "applied", appliedBy: ctx.user.id, appliedAt: new Date() })
          .where(and(eq(stockCounts.id, count.id), eq(stockCounts.status, "draft")));
        return { number: count.number, applied: toApply.length, changed, surplus, shortage };
      });
      // Остатки живут в кэше списков товаров — после акта они другие.
      cache.invalidatePrefix(`products:${ctx.tenant.id}`);
      await invalidateReports(ctx.tenant.id, "stock_count.apply");
      await recordAudit(db, { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: "stock_count.apply", targetType: "stock_count", targetId: input.id, meta: result });
      return result;
    }),

  cancel: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const count = await loadCount(db, ctx.tenant.id, input.id);
      if (count.status !== "draft") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Отменить можно только черновик" });
      await db.update(stockCounts).set({ status: "cancelled" }).where(eq(stockCounts.id, count.id));
      await recordAudit(db, { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: "stock_count.cancel", targetType: "stock_count", targetId: count.id });
      return { success: true };
    }),
});

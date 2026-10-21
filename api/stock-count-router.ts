import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createRouter, operatorQuery, adminQuery, can } from "./middleware";
import { products, stockCountItems, stockCounts, warehouseStock, warehouses, users } from "@db/schema";
import { applyCountLines, approveCount, insertCount, rejectCount, submitCount } from "./services/stock-count";
import { recordAudit } from "./services/audit-log";
import { assertProductsBelongToTenant } from "./lib/tenant-refs";
import { cache } from "./lib/cache";
import { retryOnDeadlock } from "./lib/db-errors";
import { invalidateReports } from "./lib/report-cache";
import { extraBarcodesOf } from "./services/product-barcodes";

type Db = ReturnType<typeof import("./queries/connection").getDb>;

/*
  Инвентаризация как документ.

  Пересчёт полки был кнопкой «Скорректировать» по одному товару: без
  «ожидалось / посчитано», без итога недостачи, без единого действия
  «применить». Здесь: черновик со снимком остатков склада, строка на товар
  с посчитанным числом (сканер прибавляет единицу), применение одним
  действием через дверь остатка — и в журнале движений «инвентаризация» по
  каждой разнице. Применённый документ не правится: он и есть акт.

  Считать можно не весь склад: категорию или выбранные товары — полку, а не
  ангар. Оператор без права warehouse.apply не применяет, а отправляет
  директору (submitCount); утверждение и отказ — у директора. Как и почему
  утверждается разница, а не число, — в services/stock-count.ts.
*/

const money2 = (n: number) => n.toFixed(2);

/** Править можно только черновик; отправленный ждёт директора, применённый закрыт. */
function assertDraft(status: string) {
  if (status === "submitted") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Документ на утверждении у руководителя — править его нельзя" });
  if (status !== "draft") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Документ уже применён или отменён" });
}

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
        scope: stockCounts.scope, scopeCategory: stockCounts.scopeCategory,
        origin: stockCounts.origin, adjustType: stockCounts.adjustType,
        submittedAt: stockCounts.submittedAt, reviewNote: stockCounts.reviewNote,
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
   *
   * category — только товары этой категории; productIds — ровно выбранные
   * (товар без строки остатка на этом складе — ожидалось ноль). Без них —
   * весь склад, как было.
   */
  create: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      warehouseId: z.number().int().positive(),
      notes: z.string().max(500).optional(),
      category: z.string().trim().min(1).max(100).optional(),
      productIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;
      if (input.category && input.productIds) throw new TRPCError({ code: "BAD_REQUEST", message: "Выберите что-то одно: категорию или товары" });
      const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });
      // stock_count_items без tenant_id: чужой товар в строке документа
      // потом показал бы своё название и себестоимость.
      const picked = input.productIds ? [...new Set(input.productIds)] : null;
      if (picked) await assertProductsBelongToTenant(db, tenantId, picked);

      const scope = picked ? "items" : input.category ? "category" : "full";

      const { id, number } = await retryOnDeadlock(() => db.transaction(async (tx) => {
        const doc = await insertCount(tx, tenantId, {
          warehouseId: wh.id, notes: input.notes ?? null, createdBy: ctx.user.id,
          scope, scopeCategory: input.category ?? null,
        });
        const countId = doc.id;
        const rows = picked
          ? await tx.select({ productId: products.id, current: warehouseStock.currentStock })
            .from(products)
            .leftJoin(warehouseStock, and(eq(warehouseStock.productId, products.id), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, wh.id)))
            .where(and(eq(products.tenantId, tenantId), inArray(products.id, picked)))
          : await tx.select({ productId: warehouseStock.productId, current: warehouseStock.currentStock })
            .from(warehouseStock)
            .innerJoin(products, and(
              eq(warehouseStock.productId, products.id), eq(products.tenantId, tenantId), eq(products.status, "active"),
              ...(input.category ? [eq(products.category, input.category)] : []),
            ))
            .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, wh.id)));
        if (rows.length === 0 && input.category) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `В категории «${input.category}» на этом складе нет товаров` });
        }
        if (rows.length > 0) {
          await tx.insert(stockCountItems).values(rows.map(r => ({ countId, productId: r.productId, expected: String(r.current ?? "0.00") })));
        }
        return doc;
      }));
      await recordAudit(db, { tenantId, actorId: ctx.user.id, actorName: ctx.user.name, action: "stock_count.create", targetType: "stock_count", targetId: id, meta: { number, warehouseId: wh.id, scope, category: input.category, lines: picked?.length } });
      return { id, number };
    }),

  get: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const count = await loadCount(db, ctx.tenant.id, input.id);
      // current — учёт сейчас: директору при утверждении видно, во что
      // превратится остаток (сейчас + разница), а не только что было при отправке.
      const items = await db.select({
        id: stockCountItems.id, productId: stockCountItems.productId, expected: stockCountItems.expected,
        counted: stockCountItems.counted, note: stockCountItems.note, bookAtSubmit: stockCountItems.bookAtSubmit,
        current: warehouseStock.currentStock,
        productName: products.name, productCode: products.code, barcode: products.barcode, unit: products.unit, costPrice: products.costPrice,
      }).from(stockCountItems)
        .innerJoin(products, and(eq(stockCountItems.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .leftJoin(warehouseStock, and(
          eq(warehouseStock.productId, stockCountItems.productId), eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, count.warehouseId),
        ))
        .where(eq(stockCountItems.countId, count.id))
        .orderBy(products.name);
      // Сканер инвентаризации ищет строку и по дополнительным штрих-кодам:
      // на полке стоит та этикетка, что пришла, а не та, что в карточке.
      const extras = await extraBarcodesOf(db, ctx.tenant.id, items.map(i => Number(i.productId)));
      return { ...count, items: items.map(i => ({ ...i, barcodes: extras.get(Number(i.productId)) ?? [] })) };
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
      /*
        Под замком документа: отправка на утверждение снимает учёт с
        посчитанных строк, и строка, посчитанная в ту же секунду, осталась бы
        без него — утверждать её было бы не от чего. Заодно два скана подряд
        (+1, +1) не теряют единицу на чтении «было».
      */
      return ctx.db.transaction(async (tx) => {
        const [count] = await tx.select().from(stockCounts)
          .where(and(eq(stockCounts.id, input.id), eq(stockCounts.tenantId, ctx.tenant.id))).for("update").limit(1);
        if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
        assertDraft(count.status);

        const [item] = await tx.select({ id: stockCountItems.id, counted: stockCountItems.counted }).from(stockCountItems)
          .where(and(eq(stockCountItems.countId, count.id), eq(stockCountItems.productId, input.productId))).limit(1);
        let itemId = item?.id;
        if (!itemId) {
          // Товара нет в документе. Либо в учёте на этом складе его не было
          // (ожидалось ноль), либо документ на категорию или выбранные товары, а
          // этот товар за его рамкой — тогда ожидалось то, что в учёте сейчас.
          const [p] = await tx.select({ id: products.id }).from(products)
            .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenant.id))).limit(1);
          if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Товар не найден в вашей организации" });
          const [st] = await tx.select({ current: warehouseStock.currentStock }).from(warehouseStock)
            .where(and(eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, count.warehouseId), eq(warehouseStock.productId, p.id))).limit(1);
          const [r] = await tx.insert(stockCountItems).values({ countId: count.id, productId: p.id, expected: String(st?.current ?? "0.00") });
          itemId = Number(r.insertId);
        }
        const base = item?.counted != null ? Number(item.counted) : 0;
        const next = input.delta != null ? Math.max(0, base + input.delta) : input.counted ?? null;
        await tx.update(stockCountItems)
          .set({ counted: next == null ? null : money2(next), ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(eq(stockCountItems.id, itemId));
        return { counted: next };
      });
    }),

  /**
   * Применить: каждой посчитанной строке — setStock (дверь обрезает резерв и
   * подрезает партии), разница — в журнал движений. Непосчитанные строки не
   * трогаются: «не считали» — не «ноль». Ожидалось сверяется с ТЕКУЩИМ
   * остатком, а не со снимком: за время счёта могли продать, и движение
   * пишется от того, что в учёте сейчас. Цикл общий с утверждением
   * (services/stock-count.ts → applyCountLines).
   *
   * Оператору без права warehouse.apply закрыто: он отправляет на утверждение.
   * Возвращённая заявка проводится разницей, а не числом (см. ниже).
   */
  // «apply» — служебное слово у tRPC (router({}) его не принимает), поэтому applyCount.
  applyCount: operatorQuery.use(can("warehouse.adjust")).use(can("warehouse.apply"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      const result = await db.transaction(async (tx) => {
        const [count] = await tx.select().from(stockCounts)
          .where(and(eq(stockCounts.id, input.id), eq(stockCounts.tenantId, ctx.tenant.id))).for("update").limit(1);
        if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Инвентаризация не найдена" });
        assertDraft(count.status);

        const items = await tx.select({ productId: stockCountItems.productId, counted: stockCountItems.counted, expected: stockCountItems.expected, note: stockCountItems.note })
          .from(stockCountItems).where(eq(stockCountItems.countId, count.id));
        const toApply = items.filter(i => i.counted != null);
        if (toApply.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Ни одна строка не посчитана — применять нечего" });

        /*
          Черновиком бывает и заявка (правка, остатки из файла), которую
          директор вернул. Она — сдвиг от учёта в минуту заявки, а не число на
          полке: «списать 2», применённое числом после прихода 50, поставило
          бы старый остаток и списало 52. Заявка проводится разницей
          «посчитано − ожидалось» поверх текущего остатка — как при утверждении.
        */
        const request = count.origin !== "count";
        const applied = await applyCountLines(tx, ctx.tenant.id, count, toApply.map(i => ({
          productId: i.productId, counted: Number(i.counted), note: i.note, book: request ? Number(i.expected) : null,
        })), request ? "delta" : "absolute");
        await tx.update(stockCounts).set({ status: "applied", appliedBy: ctx.user.id, appliedAt: new Date() })
          .where(and(eq(stockCounts.id, count.id), eq(stockCounts.status, "draft")));
        return applied;
      });
      // Остатки живут в кэше списков товаров — после акта они другие.
      cache.invalidatePrefix(`products:${ctx.tenant.id}`);
      await invalidateReports(ctx.tenant.id, "stock_count.apply");
      await recordAudit(db, { tenantId: ctx.tenant.id, actorId: ctx.user.id, actorName: ctx.user.name, action: "stock_count.apply", targetType: "stock_count", targetId: input.id, meta: { ...result } });
      return result;
    }),

  /**
   * На утверждение директору: посчитанные строки запоминают учёт этой минуты,
   * документ закрывается для правки, директору — уведомление. Остаток не
   * меняется до «Утвердить».
   */
  submitCount: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => submitCount(ctx.db, ctx.tenant.id, { id: ctx.user.id, name: ctx.user.name }, input.id)),

  /** Утвердить — только директор: разница «посчитано − учёт при отправке» поверх текущего остатка. */
  approveCount: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => approveCount(ctx.db, ctx.tenant.id, { id: ctx.user.id, name: ctx.user.name }, input.id)),

  /** Вернуть на доработку — только директор и только со словами: «не так» без причины ничему не учит. */
  rejectCount: adminQuery
    .input(z.object({ id: z.number().int().positive(), note: z.string().trim().min(1, "Напишите, что исправить").max(500) }))
    .mutation(async ({ input, ctx }) => rejectCount(ctx.db, ctx.tenant.id, { id: ctx.user.id, name: ctx.user.name }, input.id, input.note)),

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

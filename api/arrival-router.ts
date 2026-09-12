import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { createArrival, updateArrival, deleteArrival } from "./services/arrival";
import { arrivals } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { decimalOrDefault } from "./lib/zod-decimal";
import { arrivalSupplyColumns } from "./supplier-router";
import { auditActor } from "./services/audit-log";

type ArrivalItemRow = {
  id:           number;
  productId:    number;
  quantity:     string;
  condition:    string | null;
  notes:        string | null;
  costPrice:    string | null;
  sellingPrice: string | null;
  productName:  string | null;
  productCode:  string | null;
  barcode:      string | null;
  expectedQuantity: string | null;
  batchNumber:  string | null;
  expiresAt:    string | null;
};

export const arrivalRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().int().min(1).max(10000).default(25),
      status:   z.enum(["pending", "unloading", "completed"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(arrivals.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(arrivals.status, input.status));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
          driverName: arrivals.driverName, status: arrivals.status,
          fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
          totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
          arrivalTime: arrivals.arrivalTime, createdAt: arrivals.createdAt,
          ...arrivalSupplyColumns,
        }).from(arrivals).where(where).limit(pageSize).offset(offset).orderBy(desc(arrivals.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(arrivals).where(where),
      ]);

      // Приход без поставщика — обычное дело, и подзапросы вернут по нему
      // NULL. Здесь это превращается в null и 0, чтобы клиенту не приходилось
      // отличать «поставщика нет» от «сумма не посчиталась».
      const withMoney = data.map(a => {
        const supplyAmount = a.supplyAmount == null ? null : Number(a.supplyAmount);
        const supplyPaid   = a.supplyAmount == null ? null : Number(a.supplyPaid ?? 0);
        return {
          ...a,
          goodsTotal:   Number(a.goodsTotal ?? 0),
          supplyAmount,
          supplyPaid,
          supplyDebt:   supplyAmount == null ? null : Math.round((supplyAmount - (supplyPaid ?? 0)) * 100) / 100,
        };
      });

      return { data: withMoney, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const [arrival] = await db.select({
        id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
        driverName: arrivals.driverName, driverPhone: arrivals.driverPhone, status: arrivals.status,
        fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
        totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
        arrivalTime: arrivals.arrivalTime, unloadingTime: arrivals.unloadingTime,
        notes: arrivals.notes, createdAt: arrivals.createdAt,
      }).from(arrivals)
        .where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId))).limit(1);
      if (!arrival) return null;

      // Always use raw SQL for items — avoids Drizzle referencing non-existent columns
      let items: Array<{ id: number; productId: number; quantity: number; expectedQuantity: number | null; condition: string; notes: string; productName: string; productCode: string; barcode: string | null; costPrice: string; sellingPrice: string; batchNumber: string | null; expiresAt: string | null }>;
      try {
        // p.barcode — для печати этикеток по приходу: на них штрих-код поставщика, если есть.
        const result = await db.execute(sql`SELECT ai.id, ai.product_id AS productId, ai.quantity, ai.expected_quantity AS expectedQuantity, ai.condition, ai.notes, ai.cost_price AS costPrice, ai.selling_price AS sellingPrice, ai.batch_number AS batchNumber, DATE_FORMAT(ai.expires_at, '%Y-%m-%d') AS expiresAt, p.name AS productName, p.code AS productCode, p.barcode AS barcode FROM arrival_items ai LEFT JOIN products p ON ai.product_id = p.id WHERE ai.arrival_id = ${arrival.id}`);
        const [rows] = result as unknown as [ArrivalItemRow[], unknown];
        items = Array.isArray(rows) ? rows.map(r => ({
          id: Number(r.id),
          productId: Number(r.productId),
          quantity: Number(r.quantity),
          expectedQuantity: r.expectedQuantity == null ? null : Number(r.expectedQuantity),
          condition: String(r.condition ?? ""),
          notes: String(r.notes ?? ""),
          productName: String(r.productName ?? ""),
          productCode: String(r.productCode ?? ""),
          barcode: r.barcode ?? null,
          costPrice: String(r.costPrice ?? "0.00"),
          sellingPrice: String(r.sellingPrice ?? "0.00"),
          // Пусто — это «не заполняли», а не пустая строка: у бытовой химии
          // срока годности нет вовсе, и экран должен различать эти два случая.
          batchNumber: r.batchNumber ?? null,
          expiresAt: r.expiresAt ?? null,
        })) : [];
      } catch {
        items = [];
      }

      return { ...arrival, items };
    }),

  create: operatorQuery
    .input(z.object({
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      arrivalDate: z.string(),
      fuelCost:    decimalOrDefault("0.00").default("0.00"),
      tollCost:    decimalOrDefault("0.00").default("0.00"),
      otherCost:   decimalOrDefault("0.00").default("0.00"),
      notes:       z.string().optional(),
      /*
        Партия и срок годности — необязательны и оба сразу.

        У бытовой химии и посуды срока нет вовсе, и требовать его — верный
        способ получить «01.01.2099» во всех строках. А там, где он есть, это
        единственный момент, когда его вообще можно записать: на остатке лежит
        одно число на товар, без памяти о том, какими партиями оно набралось.
      */
      items:       z.array(z.object({
        productId: z.number(),
        quantity: z.string().refine(v => Number(v) > 0, "Количество должно быть положительным"),
        // По накладной поставщика; необязательно. Ноль допустим: ждали, не приехало вовсе.
        expectedQuantity: z.string().regex(/^\d+(\.\d{1,2})?$/, "Ожидалось — число").optional(),
        costPrice: decimalOrDefault("0.00").optional(),
        sellingPrice: decimalOrDefault("0.00").optional(),
        condition: z.string().optional(),
        batchNumber: z.string().max(64).optional(),
        expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Срок годности задаётся как ГГГГ-ММ-ДД").optional(),
      })).optional(),
      // Долг перед поставщиком, привязанный к этому приходу. Опционален
      // целиком: обычный приход без учёта задолженности не заполняет это
      // поле вовсе. Ровно один способ назвать поставщика — supplierId ИЛИ
      // newSupplierName, — проверяется ниже в .refine, потому что zod не
      // выражает «одно из двух» на уровне схемы полей объекта.
      supplier: z.object({
        supplierId:      z.number().optional(),
        newSupplierName: z.string().min(1).max(255).optional(),
        amount:          decimalOrDefault("0.00").refine(v => Number(v) > 0, "Сумма поставки должна быть положительной"),
        currency:        z.enum(["UZS", "USD"]).default("UZS"),
        rateToUzs:       decimalOrDefault("0.00").optional(),
        dueDate:         z.string().optional(),
      }).refine(
        s => (s.supplierId != null) !== (s.newSupplierName != null && s.newSupplierName !== ""),
        "Выберите поставщика из списка либо укажите название нового — не оба сразу и не ни одного",
      ).optional(),
    }))
    .mutation(({ input, ctx }) => createArrival(ctx.db, ctx.tenant.id, ctx.user.id, input)),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      status:      z.enum(["pending", "unloading", "completed"]).optional(),
      warehouseId: z.number().optional(),
      fuelCost:    decimalOrDefault("0.00").optional(),
      tollCost:    decimalOrDefault("0.00").optional(),
      otherCost:   decimalOrDefault("0.00").optional(),
      notes:       z.string().optional(),
    }))
    .mutation(({ input, ctx }) => updateArrival(ctx.db, ctx.tenant.id, input, { id: ctx.user.id, name: ctx.user.name, ip: auditActor(ctx).ip })),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(({ input, ctx }) => deleteArrival(ctx.db, ctx.tenant.id, input.id)),
});

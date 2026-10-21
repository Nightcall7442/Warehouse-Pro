import { z } from "zod";
import { createRouter, operatorQuery, adminQuery, can } from "./middleware";
import { purchaseOrders, purchaseOrderItems, suppliers, warehouses, products, arrivals, users } from "@db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { decimalOrDefault } from "./lib/zod-decimal";
import { auditActor } from "./services/audit-log";
import {
  createPurchaseOrder, updatePurchaseOrder, submitPurchaseOrder, approvePurchaseOrder,
  rejectPurchaseOrder, cancelPurchaseOrder, receivePurchaseOrder, type PurchaseOrderActor,
} from "./services/purchase-order";
import { PO_STATUSES, MAX_ARRIVAL_COST, dueDateAfter } from "./services/purchase-order-receipt";
import { dateColumnDay } from "./lib/period";

/**
 * Заказы поставщикам — вкладка «Заказы поставщикам» на странице «Приходы»
 * и экран заказа (/purchase-orders/:id).
 *
 * Права — как у прихода: читают ceo и operator, пишут они же под
 * «Поставщики, поставки и оплаты им» (suppliers.manage). Согласует и
 * отклоняет только директор — adminQuery.
 *
 * Правила дела — в services/purchase-order.ts; здесь zod, права и чтение.
 * Долга заказ не создаёт (ADR 0013): плановые платежи в сводке — прогноз.
 *
 * Имена внешних таблиц в коррелирующих подзапросах — литералом: drizzle в
 * списке выборки печатает колонку без имени таблицы (см. paidSubquery в
 * supplier-router; страж supplier-sql-qualified).
 */

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата задаётся как ГГГГ-ММ-ДД");

const lineInput = z.object({
  productId: z.number().int().positive(),
  quantity:  z.string().regex(/^\d+(\.\d{1,2})?$/, "Количество — неотрицательное число")
    .refine(v => Number(v) > 0 && Number(v) <= 9_999_999, "Количество — больше нуля и не больше 9 999 999"),
  // Цена в валюте заказа; ноль — цену ещё не знают.
  unitPrice: decimalOrDefault("0.00").refine(v => Number(v) >= 0 && Number(v) <= MAX_ARRIVAL_COST, "Цена — от нуля до 99 999 999,99"),
  note:      z.string().max(255).nullable().optional(),
});

const orderInput = z.object({
  supplierId:       z.number().int().positive(),
  warehouseId:      z.number().int().positive().optional(),
  currency:         z.enum(["UZS", "USD"]).default("UZS"),
  // Пустое поле формы — «курс не указан», а не ноль.
  rateToUzs:        z.preprocess(v => (v === "" ? null : v), decimalOrDefault("0").nullable().optional()),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  expectedDate:     DAY.nullable().optional(),
  notes:            z.string().max(2000).nullable().optional(),
  items:            z.array(lineInput).min(1, "Добавьте в заказ хотя бы один товар").max(2000),
});

const actorOf = (ctx: { tenant: { id: number }; user: { id: number; name: string }; req?: Request }): PurchaseOrderActor =>
  ({ id: ctx.user.id, name: ctx.user.name, ip: auditActor(ctx).ip });

/** Сумма строк заказа и неполученный остаток в деньгах — по одному заказу. */
const totalSql = sql<string>`COALESCE((
  SELECT SUM(i.quantity * i.unit_price) FROM purchase_order_items i
  WHERE i.purchase_order_id = \`purchase_orders\`.\`id\`
), 0)`;
const remainingSql = sql<string>`COALESCE((
  SELECT SUM(GREATEST(i.quantity - i.received_qty, 0) * i.unit_price) FROM purchase_order_items i
  WHERE i.purchase_order_id = \`purchase_orders\`.\`id\`
), 0)`;
const linesSql = sql<number>`(
  SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = \`purchase_orders\`.\`id\`
)`;
const openArrivalsSql = sql<number>`(
  SELECT COUNT(*) FROM arrivals a
  WHERE a.purchase_order_id = \`purchase_orders\`.\`id\` AND a.status <> 'completed'
)`;

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export const purchaseOrderRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      status:     z.enum(PO_STATUSES).optional(),
      supplierId: z.number().int().positive().optional(),
      page:       z.number().int().min(1).default(1),
      pageSize:   z.number().int().min(1).max(200).default(25),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;

      const conditions = [eq(purchaseOrders.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(purchaseOrders.status, input.status));
      if (input?.supplierId) conditions.push(eq(purchaseOrders.supplierId, input.supplierId));
      const where = and(...conditions);

      /*
        Плитки — по всей организации, не по фильтру: «ждут согласования» и
        «ожидаемые платежи» директор читает как всё, что есть.

        Ожидаемые платежи — неполученный остаток открытых заказов по цене
        заказа, по валютам: прогноз, а не долг. Долг появится при приёмке, и
        на то количество, что на самом деле приедет.
      */
      const planned = (currency: "UZS" | "USD") => sql`COALESCE((
        SELECT SUM(GREATEST(i.quantity - i.received_qty, 0) * i.unit_price)
        FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.purchase_order_id
        WHERE p.tenant_id = ${tenantId} AND p.currency = ${currency} AND p.status IN ('approved', 'partially_received')
      ), 0)`;
      const [rows, [count], summaryResult] = await Promise.all([
        db.select({
          id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
          supplierId: purchaseOrders.supplierId, supplierName: suppliers.name,
          warehouseId: purchaseOrders.warehouseId, warehouseName: warehouses.name,
          currency: purchaseOrders.currency, expectedDate: purchaseOrders.expectedDate,
          paymentTermsDays: purchaseOrders.paymentTermsDays, source: purchaseOrders.source,
          createdAt: purchaseOrders.createdAt, updatedAt: purchaseOrders.updatedAt,
          total: totalSql, remaining: remainingSql, lines: linesSql, openArrivals: openArrivalsSql,
        })
          .from(purchaseOrders)
          .innerJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.tenantId, tenantId)))
          .innerJoin(warehouses, and(eq(warehouses.id, purchaseOrders.warehouseId), eq(warehouses.tenantId, tenantId)))
          .where(where)
          .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
          .limit(pageSize).offset((page - 1) * pageSize),
        db.select({ n: sql<number>`COUNT(*)` }).from(purchaseOrders).where(where),
        db.execute(sql`SELECT
          (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${tenantId} AND status = 'pending_approval') AS pendingApproval,
          (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${tenantId} AND status IN ('approved', 'partially_received')) AS openCount,
          ${planned("UZS")} AS plannedUzs,
          ${planned("USD")} AS plannedUsd`),
      ]);
      const [summaryRows] = summaryResult as unknown as [Array<Record<string, unknown>>, unknown];
      const s = summaryRows?.[0] ?? {};

      return {
        data: rows.map(r => {
          const expected = r.expectedDate == null ? null : dateColumnDay(r.expectedDate);
          return {
            ...r,
            expectedDate: expected,
            total: money(r.total), remaining: money(r.remaining),
            lines: Number(r.lines), openArrivals: Number(r.openArrivals),
            // Когда ждать счёт к оплате: день поставки плюс отсрочка — прогноз.
            expectedPaymentDate: expected ? dueDateAfter(expected, r.paymentTermsDays) : null,
          };
        }),
        total: Number(count?.n ?? 0), page, pageSize,
        summary: {
          pendingApproval: Number(s.pendingApproval ?? 0),
          open:            Number(s.openCount ?? 0),
          plannedUzs:      money(s.plannedUzs),
          plannedUsd:      money(s.plannedUsd),
        },
      };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;
      const [po] = await db.select({
        id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId, supplierName: suppliers.name, supplierPhone: suppliers.phone,
        warehouseId: purchaseOrders.warehouseId, warehouseName: warehouses.name,
        currency: purchaseOrders.currency, rateToUzs: purchaseOrders.rateToUzs,
        paymentTermsDays: purchaseOrders.paymentTermsDays, expectedDate: purchaseOrders.expectedDate,
        source: purchaseOrders.source, notes: purchaseOrders.notes, rejectNote: purchaseOrders.rejectNote,
        createdBy: purchaseOrders.createdBy, submittedAt: purchaseOrders.submittedAt,
        approvedBy: purchaseOrders.approvedBy, approvedAt: purchaseOrders.approvedAt, closedAt: purchaseOrders.closedAt,
        createdAt: purchaseOrders.createdAt,
        // Версия документа: с ней экран отдаёт правку в update.
        updatedAt: purchaseOrders.updatedAt,
      })
        .from(purchaseOrders)
        .innerJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.tenantId, tenantId)))
        .innerJoin(warehouses, and(eq(warehouses.id, purchaseOrders.warehouseId), eq(warehouses.tenantId, tenantId)))
        .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.tenantId, tenantId)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Заказ поставщику не найден" });

      const people = [po.createdBy, po.approvedBy].filter((v): v is number => v != null).map(Number);
      const [lines, linked, names, transitResult] = await Promise.all([
        db.select({
          id: purchaseOrderItems.id, productId: purchaseOrderItems.productId,
          quantity: purchaseOrderItems.quantity, unitPrice: purchaseOrderItems.unitPrice,
          receivedQty: purchaseOrderItems.receivedQty, note: purchaseOrderItems.note,
          productName: products.name, productCode: products.code, barcode: products.barcode,
          unit: products.unit, packSize: products.packSize, packLabel: products.packLabel,
        })
          .from(purchaseOrderItems)
          // Товар — только своей организации, даже если строка ссылается мимо.
          .innerJoin(products, and(eq(products.id, purchaseOrderItems.productId), eq(products.tenantId, tenantId)))
          .where(eq(purchaseOrderItems.purchaseOrderId, po.id))
          .orderBy(purchaseOrderItems.id),
        db.select({ id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, status: arrivals.status, arrivalDate: arrivals.arrivalDate })
          .from(arrivals)
          .where(and(eq(arrivals.purchaseOrderId, po.id), eq(arrivals.tenantId, tenantId)))
          .orderBy(desc(arrivals.id)),
        people.length === 0 ? Promise.resolve([]) : db.select({ id: users.id, name: users.name }).from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.id, people))),
        // В пути — строки непроведённых приходов по заказу: большее из «по накладной» и «пришло».
        db.execute(sql`
          SELECT ai.product_id AS productId, SUM(GREATEST(COALESCE(ai.expected_quantity, 0), ai.quantity)) AS qty
          FROM arrival_items ai JOIN arrivals a ON a.id = ai.arrival_id
          WHERE a.purchase_order_id = ${po.id} AND a.tenant_id = ${tenantId} AND a.status <> 'completed'
          GROUP BY ai.product_id`),
      ]);
      const [transitRows] = transitResult as unknown as [Array<{ productId: number; qty: string }>, unknown];
      const inTransit = new Map((transitRows ?? []).map(r => [Number(r.productId), Number(r.qty)]));
      const nameOf = new Map(names.map(u => [Number(u.id), u.name]));
      const expected = po.expectedDate == null ? null : dateColumnDay(po.expectedDate);

      return {
        ...po,
        expectedDate: expected,
        createdByName: po.createdBy == null ? null : nameOf.get(Number(po.createdBy)) ?? null,
        approvedByName: po.approvedBy == null ? null : nameOf.get(Number(po.approvedBy)) ?? null,
        expectedPaymentDate: expected ? dueDateAfter(expected, po.paymentTermsDays) : null,
        items: lines.map(l => {
          const quantity = Number(l.quantity);
          const received = Number(l.receivedQty);
          return {
            ...l,
            quantity, unitPrice: Number(l.unitPrice), receivedQty: received,
            remaining: Math.max(0, Math.round((quantity - received) * 100) / 100),
            // Излишек — сколько приняли сверх заказанного: показывается, а не прячется.
            over: Math.max(0, Math.round((received - quantity) * 100) / 100),
            inTransit: inTransit.get(Number(l.productId)) ?? 0,
            packSize: l.packSize == null ? null : String(l.packSize),
          };
        }),
        arrivals: linked.map(a => ({ ...a, arrivalDate: dateColumnDay(a.arrivalDate) })),
        total: money(lines.reduce((acc, l) => acc + Number(l.quantity) * Number(l.unitPrice), 0)),
      };
    }),

  create: operatorQuery.use(can("suppliers.manage"))
    .input(orderInput)
    .mutation(({ input, ctx }) => createPurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input)),

  /*
    Шапка и строки целиком. Согласованный заказ после правки — снова
    черновик: согласовывали другие числа.
  */
  update: operatorQuery.use(can("suppliers.manage"))
    .input(orderInput.extend({ id: z.number().int().positive(), updatedAt: z.date().optional() }))
    .mutation(({ input, ctx }) => {
      const { id, updatedAt, ...data } = input;
      return updatePurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), id, data, updatedAt);
    }),

  submit: operatorQuery.use(can("suppliers.manage"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input, ctx }) => submitPurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input.id)),

  // Согласие — директора: заказ — это деньги, которые организация обещает заплатить.
  approve: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input, ctx }) => approvePurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input.id)),

  reject: adminQuery
    .input(z.object({ id: z.number().int().positive(), note: z.string().trim().min(1, "Напишите, что поправить в заказе").max(500) }))
    .mutation(({ input, ctx }) => rejectPurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input.id, input.note)),

  /** Ничего не принято — отмена; принято частично — закрыть остаток. */
  cancel: operatorQuery.use(can("suppliers.manage"))
    .input(z.object({ id: z.number().int().positive(), reason: z.string().max(500).optional() }))
    .mutation(({ input, ctx }) => cancelPurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input.id, input.reason)),

  /** Завести приход по заказу — экран сразу открывает его. */
  receive: operatorQuery.use(can("suppliers.manage"))
    .input(z.object({ id: z.number().int().positive(), arrivalDate: DAY.optional() }))
    .mutation(({ input, ctx }) => receivePurchaseOrder(ctx.db, ctx.tenant.id, actorOf(ctx), input.id, input.arrivalDate)),
});

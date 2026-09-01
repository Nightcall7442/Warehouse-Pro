import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { suppliers, supplies, supplierPayments } from "@db/schema";
import { eq, and, sql, desc, like } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { decimalOrDefault } from "./lib/zod-decimal";
import { logger } from "./lib/logger";
import type { getDb } from "./queries/connection";

type Db = ReturnType<typeof getDb>;

/**
 * Расчёты с поставщиками: сколько мы должны заводу и за какую партию.
 *
 * Зеркало долга магазина: там считается, сколько должны НАМ (`shops.debt`),
 * здесь — обратная сторона, сколько должны МЫ. Живёт этот роутер отдельным
 * файлом по заведённому в проекте порядку — один файл на предметную область,
 * — но своей страницы или пункта меню у него нет: и создание поставщика, и
 * запись поставки, и оплата видны пользователю только внутри экрана «Приход»
 * (Arrivals.tsx). Оттого все процедуры на operatorQuery — том же уровне
 * доступа, что и у самого прихода (маршрут /arrivals в App.tsx открыт только
 * ceo и operator), без reportsQuery для остальных ролей: поставщика вне
 * прихода в интерфейсе просто нет, показывать некому.
 *
 * Сама поставка (кто, сколько, в какой валюте) заводится не здесь, а внутри
 * arrival.create — приход и долг перед поставщиком записываются одной формой,
 * одной транзакцией. Здесь — то, что происходит после: список поставщиков,
 * просмотр долга по конкретному приходу и платежи.
 *
 * Долг НЕ хранится полем, а вычисляется запросом: сумма поставки минус сумма
 * платежей по ней. У shops.debt ровно эта ловушка уже случалась — поле живёт
 * своей жизнью и рано или поздно расходится с фактическими платежами. У
 * поставки расходиться нечему.
 *
 * Валюта: часть товара ввозная, счёт бывает долларовым. Должны мы тогда
 * именно доллары, а не сумму по вчерашнему курсу, поэтому долг живёт в
 * валюте поставки, платёж указывается в ней же. Сколько сумов реально ушло
 * из кассы — отдельное поле paidUzs вместе с курсом; это для отчётности, на
 * долг оно не влияет.
 */

/** Проверить, что поставщик из запроса принадлежит этой организации. */
async function assertOwnSupplier(db: Db, tenantId: number, supplierId: number) {
  const [found] = await db.select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
    .limit(1);
  if (!found) {
    // Не «нет доступа», а «не найден»: иначе ответ подсказывает, что такой
    // идентификатор существует у кого-то другого.
    throw new Error("Поставщик не найден");
  }
}

/**
 * Долг по поставке = сумма поставки минус всё, что по ней уплачено.
 *
 * Подзапрос, а не соединение с группировкой: поставка без единого платежа
 * должна остаться в выборке с полным долгом, а не выпасть из неё.
 */
const paidSubquery = sql<string>`COALESCE((
  SELECT SUM(${supplierPayments.amount})
  FROM ${supplierPayments}
  WHERE ${supplierPayments.supplyId} = ${supplies.id}
), 0)`;

export const supplierRouter = createRouter({

  // ── Поставщики ─────────────────────────────────────────────────────────────

  /** Список для выпадающего списка в форме прихода и для общей сводки долга. */
  list: operatorQuery
    .input(z.object({
      search:          z.string().max(120).optional(),
      onlyDebtors:     z.boolean().optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;

      const conditions = [eq(suppliers.tenantId, tenantId)];
      if (input?.search) conditions.push(like(suppliers.name, `%${sanitizeSearch(input.search)}%`));
      if (!input?.includeInactive) conditions.push(eq(suppliers.status, "active"));

      // Долг сводится по валютам отдельно: складывать сумы с долларами нельзя,
      // а показать одно число «итого» — соврать.
      const rows = await db.select({
        id:           suppliers.id,
        name:         suppliers.name,
        contactName:  suppliers.contactName,
        phone:        suppliers.phone,
        inn:          suppliers.inn,
        status:       suppliers.status,
        debtUzs: sql<string>`COALESCE((
          SELECT SUM(s.amount - COALESCE((
            SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id
          ), 0))
          FROM supplies s
          WHERE s.supplier_id = ${suppliers.id} AND s.currency = 'UZS'
        ), 0)`,
        debtUsd: sql<string>`COALESCE((
          SELECT SUM(s.amount - COALESCE((
            SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id
          ), 0))
          FROM supplies s
          WHERE s.supplier_id = ${suppliers.id} AND s.currency = 'USD'
        ), 0)`,
        suppliesCount: sql<number>`(
          SELECT COUNT(*) FROM supplies s WHERE s.supplier_id = ${suppliers.id}
        )`,
      })
        .from(suppliers)
        .where(and(...conditions))
        .orderBy(suppliers.name);

      const withNumbers = rows.map(r => ({
        ...r,
        debtUzs:       Number(r.debtUzs),
        debtUsd:       Number(r.debtUsd),
        suppliesCount: Number(r.suppliesCount),
      }));

      return input?.onlyDebtors
        ? withNumbers.filter(r => r.debtUzs > 0 || r.debtUsd > 0)
        : withNumbers;
    }),

  /** Быстрое добавление поставщика прямо из формы прихода, без ухода со страницы. */
  create: operatorQuery
    .input(z.object({
      name:        z.string().min(1).max(255),
      contactName: z.string().max(255).optional(),
      phone:       z.string().max(32).optional(),
      inn:         z.string().max(32).optional(),
      address:     z.string().max(500).optional(),
      notes:       z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      try {
        const [result] = await db.insert(suppliers).values({
          tenantId:    ctx.tenant.id,
          name:        sanitizeString(input.name),
          contactName: input.contactName ? sanitizeString(input.contactName) : undefined,
          phone:       input.phone,
          inn:         input.inn,
          address:     input.address ? sanitizeString(input.address) : undefined,
          notes:       input.notes ? sanitizeString(input.notes) : undefined,
        });
        return { id: Number(result.insertId) };
      } catch (e) {
        // Уникальный индекс на (имя, организация). Сообщение вместо кода
        // ошибки базы: заводящий поставщика не должен разбирать ER_DUP_ENTRY.
        if (e instanceof Error && /Duplicate entry/i.test(e.message)) {
          throw new Error("Поставщик с таким названием уже заведён");
        }
        throw e;
      }
    }),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      name:        z.string().min(1).max(255).optional(),
      contactName: z.string().max(255).nullable().optional(),
      phone:       z.string().max(32).nullable().optional(),
      inn:         z.string().max(32).nullable().optional(),
      address:     z.string().max(500).nullable().optional(),
      notes:       z.string().max(2000).nullable().optional(),
      status:      z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db;
      await assertOwnSupplier(db, ctx.tenant.id, input.id);
      const { id, ...patch } = input;
      await db.update(suppliers)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // ── Поставка, привязанная к приходу ──────────────────────────────────────────

  /**
   * Долг и платежи по поставке конкретного прихода — для карточки прихода.
   * arrivalId, а не supplyId: клиент знает приход, которому принадлежит
   * поставка, а не служебный id самой поставки.
   */
  getSupplyByArrival: operatorQuery
    .input(z.object({ arrivalId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const [supply] = await db.select({
        id:           supplies.id,
        supplierId:   supplies.supplierId,
        supplierName: suppliers.name,
        supplyNumber: supplies.supplyNumber,
        amount:       supplies.amount,
        currency:     supplies.currency,
        rateToUzs:    supplies.rateToUzs,
        supplyDate:   supplies.supplyDate,
        dueDate:      supplies.dueDate,
        notes:        supplies.notes,
        paid:         paidSubquery,
      })
        .from(supplies)
        .innerJoin(suppliers, eq(supplies.supplierId, suppliers.id))
        .where(and(eq(supplies.arrivalId, input.arrivalId), eq(supplies.tenantId, ctx.tenant.id)))
        .limit(1);

      if (!supply) return null;

      const amount = Number(supply.amount);
      const paid   = Number(supply.paid);

      const payments = await db.select({
        id:            supplierPayments.id,
        amount:        supplierPayments.amount,
        paidUzs:       supplierPayments.paidUzs,
        rateToUzs:     supplierPayments.rateToUzs,
        paymentMethod: supplierPayments.paymentMethod,
        paidAt:        supplierPayments.paidAt,
        notes:         supplierPayments.notes,
      })
        .from(supplierPayments)
        .where(eq(supplierPayments.supplyId, supply.id))
        .orderBy(desc(supplierPayments.paidAt));

      return {
        ...supply,
        amount,
        paid,
        debt: Math.round((amount - paid) * 100) / 100,
        // Просрочка считается на сервере, а не на клиенте: у клиента свой
        // часовой пояс, и «просрочено» наступало бы у него на день раньше
        // или позже, чем на самом деле.
        overdue: !!supply.dueDate && amount - paid > 0
          && new Date(supply.dueDate) < new Date(new Date().toDateString()),
        payments,
      };
    }),

  // ── Платежи ────────────────────────────────────────────────────────────────

  pay: operatorQuery
    .input(z.object({
      supplyId:       z.number(),
      amount:         decimalOrDefault("0.00").refine(v => Number(v) > 0, "Сумма платежа должна быть положительной"),
      paidUzs:        decimalOrDefault("0.00").optional(),
      rateToUzs:      decimalOrDefault("0.00").optional(),
      paymentMethod:  z.enum(["cash", "card", "transfer"]).default("transfer"),
      notes:          z.string().max(2000).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const amount   = Number(input.amount);

      // Всё в одной сделке: между проверкой остатка и записью платежа не
      // должно быть окна, в которое пролезет второй такой же платёж.
      return await db.transaction(async (tx) => {
        const [supply] = await tx.select({
          id:         supplies.id,
          supplierId: supplies.supplierId,
          amount:     supplies.amount,
          currency:   supplies.currency,
          paid:       paidSubquery,
        })
          .from(supplies)
          .where(and(eq(supplies.id, input.supplyId), eq(supplies.tenantId, tenantId)))
          .limit(1);

        if (!supply) throw new Error("Поставка не найдена");

        const remaining = Number(supply.amount) - Number(supply.paid);

        // Переплата запрещена. Заплатить больше, чем должен, — это либо
        // опечатка в сумме, либо платёж не по той поставке; и то и другое
        // лучше поймать здесь, чем разбирать потом по выпискам.
        if (amount > remaining + 0.005) {
          throw new Error(`По этой поставке осталось ${remaining.toFixed(2)} — платёж больше остатка`);
        }

        try {
          const [result] = await tx.insert(supplierPayments).values({
            tenantId,
            supplierId:     supply.supplierId,
            supplyId:       input.supplyId,
            amount:         amount.toFixed(2),
            paidUzs:        input.paidUzs ? input.paidUzs : undefined,
            rateToUzs:      input.rateToUzs ? input.rateToUzs : undefined,
            paymentMethod:  input.paymentMethod,
            notes:          input.notes ? sanitizeString(input.notes) : undefined,
            createdBy:      ctx.user.id,
            idempotencyKey: input.idempotencyKey,
          });

          const debtAfter = Math.round((remaining - amount) * 100) / 100;
          logger.info("платёж поставщику", {
            supplyId: input.supplyId, amount, currency: supply.currency, debtAfter,
          });

          return { id: Number(result.insertId), debt: debtAfter };
        } catch (e) {
          // Повтор той же попытки — не ошибка пользователя, а сорванная
          // связь. Отвечаем как на успех: деньги уже записаны один раз.
          if (e instanceof Error && /Duplicate entry/i.test(e.message)) {
            const [already] = await tx.select({ id: supplierPayments.id })
              .from(supplierPayments)
              .where(and(
                eq(supplierPayments.idempotencyKey, input.idempotencyKey),
                eq(supplierPayments.tenantId, tenantId),
              ))
              .limit(1);
            return { id: Number(already?.id ?? 0), debt: remaining, duplicate: true };
          }
          throw e;
        }
      });
    }),
});

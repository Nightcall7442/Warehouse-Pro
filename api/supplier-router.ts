import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { suppliers, supplies, supplierPayments, users } from "@db/schema";
import { eq, and, sql, desc, like } from "drizzle-orm";
import { sanitizeString, sanitizeSearch } from "./lib/sanitize";
import { decimalOrDefault } from "./lib/zod-decimal";
import { logger } from "./lib/logger";
import { isDuplicateOf } from "./lib/db-errors";
import type { getDb } from "./queries/connection";

type Db = ReturnType<typeof getDb>;

/**
 * Расчёты с контрагентами: сколько мы должны заводу и за какую партию.
 *
 * Зеркало долга магазина: shops.debt считает, сколько должны НАМ, здесь —
 * обратная сторона, сколько должны МЫ. Живёт отдельным файлом по заведённому
 * в проекте порядку (один файл на предметную область), но своего пункта меню
 * не имеет: раздел «Контрагенты и долги» — вкладка внутри страницы «Приходы»
 * (src/pages/Arrivals.tsx). Оттуда и уровень доступа: всё на operatorQuery,
 * как у самого прихода (маршрут /arrivals открыт только ceo и operator).
 *
 * ── Долг вычисляется, а не хранится ──────────────────────────────────────────
 *
 * Ни у контрагента, ни у поставки нет колонки «долг». Он выводится запросом:
 * сумма поставки минус сумма платежей по ней. У shops.debt ровно эта ловушка
 * уже случалась — поле живёт своей жизнью и рано или поздно расходится с
 * фактическими платежами, достаточно одного отката. Здесь расходиться нечему.
 *
 * ── Валюта ───────────────────────────────────────────────────────────────────
 *
 * Часть товара ввозная, счёт бывает долларовым. Должны мы тогда именно
 * доллары, а не сумму по вчерашнему курсу, поэтому долг живёт в валюте
 * поставки и платёж указывается в ней же. Складывать сумы с долларами в одно
 * «итого» нельзя — это было бы просто неверное число, — поэтому все сводки
 * ниже разложены по валютам: debtUzs и debtUsd отдельными полями.
 */

/** Проверить, что контрагент из запроса принадлежит этой организации. */
async function assertOwnSupplier(db: Db, tenantId: number, supplierId: number) {
  const [found] = await db.select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)))
    .limit(1);
  if (!found) {
    // Не «нет доступа», а «не найден»: иначе ответ подсказывает, что такой
    // идентификатор существует у кого-то другого.
    throw new Error("Контрагент не найден");
  }
}

/**
 * Уплачено по поставке — подзапросом, а не соединением с группировкой.
 *
 * Поставка без единого платежа должна остаться в выборке с полным долгом, а
 * не выпасть из неё, как случилось бы при INNER JOIN по платежам.
 *
 * ── Почему имена таблиц написаны руками ──────────────────────────────────────
 *
 * Ссылка на внешнюю таблицу здесь — литерал \`supplies\`.\`id\`, а не
 * ${supplies.id}. В списке выборки (в отличие от WHERE) drizzle печатает
 * колонку БЕЗ имени таблицы — просто \`id\`. Внутри подзапроса своё \`id\` есть
 * и у supplier_payments, и MySQL разрешает неуточнённое имя в пользу
 * внутренней таблицы: условие тихо превращается в
 * \`supplier_payments.supply_id = supplier_payments.id\` и считает не то.
 *
 * Ошибки при этом нет — есть неверное число в графе «оплачено». В списке
 * приходов та же причина проявилась честнее (ER_NON_UNIQ_ERROR, «Column 'id'
 * in where clause is ambiguous»), и это единственная причина, по которой её
 * вообще заметили.
 */
const paidSubquery = sql<string>`COALESCE((
  SELECT SUM(p.amount) FROM supplier_payments p
  WHERE p.supply_id = \`supplies\`.\`id\`
), 0)`;

/** Долг контрагента в одной валюте: сумма непогашенных остатков по поставкам. */
const debtIn = (currency: "UZS" | "USD") => sql<string>`COALESCE((
  SELECT SUM(s.amount - COALESCE((
    SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id
  ), 0))
  FROM supplies s
  WHERE s.supplier_id = \`suppliers\`.\`id\` AND s.currency = ${currency}
), 0)`;

/**
 * Просрочка: срок оплаты в прошлом, а долг ещё остался.
 *
 * Считается на сервере, а не на клиенте: у клиента свой часовой пояс, и
 * «просрочено» наступало бы у него на день раньше или позже, чем на деле.
 * CURDATE() сравнивается с датой, а не с меткой времени, — срок «до 1 марта»
 * не должен истекать в полночь по Гринвичу.
 */
const overdueCount = sql<number>`(
  SELECT COUNT(*) FROM supplies s
  WHERE s.supplier_id = \`suppliers\`.\`id\`
    AND s.due_date IS NOT NULL
    AND s.due_date < CURDATE()
    AND s.amount > COALESCE((
      SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id
    ), 0)
)`;

export const supplierRouter = createRouter({

  // ── Сводка по разделу ──────────────────────────────────────────────────────

  /** Плитки KPI над разделом: сколько всего должны и сколько уже просрочено. */
  stats: operatorQuery
    .query(async ({ ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;

      // Сырой запрос, а не db.select(): нужна одна строка агрегатов, у
      // которой нет таблицы-источника. Выбирать из suppliers нельзя — у
      // организации без единого контрагента не вернулось бы ни строки, и
      // сводка оказалась бы пустой вместо нулевой.
      const debt = (currency: "UZS" | "USD") => sql`COALESCE((
        SELECT SUM(s.amount - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id), 0))
        FROM supplies s WHERE s.tenant_id = ${tenantId} AND s.currency = ${currency}
      ), 0)`;
      const overdue = (currency: "UZS" | "USD") => sql`COALESCE((
        SELECT SUM(s.amount - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id), 0))
        FROM supplies s WHERE s.tenant_id = ${tenantId} AND s.currency = ${currency}
          AND s.due_date IS NOT NULL AND s.due_date < CURDATE()
          AND s.amount > COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id), 0)
      ), 0)`;
      const paid30 = (currency: "UZS" | "USD") => sql`COALESCE((
        SELECT SUM(p.amount) FROM supplier_payments p
        JOIN supplies s ON s.id = p.supply_id
        WHERE p.tenant_id = ${tenantId} AND s.currency = ${currency} AND p.paid_at >= (NOW() - INTERVAL 30 DAY)
      ), 0)`;

      const result = await db.execute(sql`SELECT
        (SELECT COUNT(*) FROM suppliers WHERE tenant_id = ${tenantId} AND status = 'active') AS suppliersTotal,
        (SELECT COUNT(DISTINCT s.supplier_id) FROM supplies s
           WHERE s.tenant_id = ${tenantId}
             AND s.amount > COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.supply_id = s.id), 0)
        ) AS debtorsCount,
        ${debt("UZS")} AS debtUzs,
        ${debt("USD")} AS debtUsd,
        ${overdue("UZS")} AS overdueUzs,
        ${overdue("USD")} AS overdueUsd,
        ${paid30("UZS")} AS paid30Uzs,
        ${paid30("USD")} AS paid30Usd`);

      const [rows] = result as unknown as [Array<Record<string, unknown>>, unknown];
      const row = rows?.[0] ?? {};
      const num = (v: unknown) => Number(v ?? 0);

      return {
        suppliersTotal: num(row.suppliersTotal),
        debtorsCount:   num(row.debtorsCount),
        debtUzs:        num(row.debtUzs),
        debtUsd:        num(row.debtUsd),
        overdueUzs:     num(row.overdueUzs),
        overdueUsd:     num(row.overdueUsd),
        paid30Uzs:      num(row.paid30Uzs),
        paid30Usd:      num(row.paid30Usd),
      };
    }),

  // ── Контрагенты ────────────────────────────────────────────────────────────

  list: operatorQuery
    .input(z.object({
      search:          z.string().max(120).optional(),
      onlyDebtors:     z.boolean().optional(),
      onlyOverdue:     z.boolean().optional(),
      includeInactive: z.boolean().optional(),
      sortBy:          z.enum(["name", "debtDesc"]).default("name"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;

      const conditions = [eq(suppliers.tenantId, tenantId)];
      if (input?.search) conditions.push(like(suppliers.name, `%${sanitizeSearch(input.search)}%`));
      if (!input?.includeInactive) conditions.push(eq(suppliers.status, "active"));

      const rows = await db.select({
        id:            suppliers.id,
        name:          suppliers.name,
        contactName:   suppliers.contactName,
        phone:         suppliers.phone,
        inn:           suppliers.inn,
        address:       suppliers.address,
        notes:         suppliers.notes,
        status:        suppliers.status,
        debtUzs:       debtIn("UZS"),
        debtUsd:       debtIn("USD"),
        overdueCount,
        suppliesCount: sql<number>`(SELECT COUNT(*) FROM supplies s WHERE s.supplier_id = \`suppliers\`.\`id\`)`,
        lastPaymentAt: sql<string | null>`(
          SELECT MAX(p.paid_at) FROM supplier_payments p WHERE p.supplier_id = \`suppliers\`.\`id\`
        )`,
      })
        .from(suppliers)
        .where(and(...conditions))
        .orderBy(suppliers.name);

      let result = rows.map(r => ({
        ...r,
        debtUzs:       Number(r.debtUzs),
        debtUsd:       Number(r.debtUsd),
        overdueCount:  Number(r.overdueCount),
        suppliesCount: Number(r.suppliesCount),
      }));

      if (input?.onlyDebtors) result = result.filter(r => r.debtUzs > 0 || r.debtUsd > 0);
      if (input?.onlyOverdue) result = result.filter(r => r.overdueCount > 0);

      // Сортировка по долгу — в коде, а не в ORDER BY: долг у каждой строки
      // складывается из двух валют, которые нельзя сложить в одно число для
      // сравнения. Порядок задаётся сначала по долларам, потом по сумам —
      // валютный долг весомее и должен быть наверху.
      if (input?.sortBy === "debtDesc") {
        result = [...result].sort((a, b) => (b.debtUsd - a.debtUsd) || (b.debtUzs - a.debtUzs));
      }

      return result;
    }),

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
        // Через isDuplicateOf, а не проверкой текста ошибки: drizzle
        // заворачивает ошибку драйвера в свою, и «Duplicate entry» лежит не в
        // e.message, а в e.cause. Наивная проверка давала false ВСЕГДА —
        // поймано первым же прогоном real-db, см. api/lib/db-errors.ts.
        if (isDuplicateOf(e, "uq_supplier_name_tenant")) {
          throw new Error("Контрагент с таким названием уже заведён");
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
      try {
        await db.update(suppliers)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, ctx.tenant.id)));
      } catch (e) {
        if (isDuplicateOf(e, "uq_supplier_name_tenant")) {
          throw new Error("Контрагент с таким названием уже заведён");
        }
        throw e;
      }
      return { success: true };
    }),

  // ── Поставки (долги) ───────────────────────────────────────────────────────

  /**
   * Список поставок с остатком долга.
   *
   * Это же используется и для одного контрагента (supplierId), и для всего
   * раздела сразу — фильтры одни и те же, отдельная процедура ради «только
   * по одному» ничего бы не добавила.
   */
  supplies: operatorQuery
    .input(z.object({
      supplierId:  z.number().optional(),
      onlyUnpaid:  z.boolean().optional(),
      onlyOverdue: z.boolean().optional(),
      page:        z.number().min(1).default(1),
      pageSize:    z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 50;

      const conditions = [eq(supplies.tenantId, tenantId)];
      if (input?.supplierId) {
        await assertOwnSupplier(db, tenantId, input.supplierId);
        conditions.push(eq(supplies.supplierId, input.supplierId));
      }

      const rows = await db.select({
        id:            supplies.id,
        supplierId:    supplies.supplierId,
        supplierName:  suppliers.name,
        supplyNumber:  supplies.supplyNumber,
        arrivalId:     supplies.arrivalId,
        amount:        supplies.amount,
        currency:      supplies.currency,
        rateToUzs:     supplies.rateToUzs,
        supplyDate:    supplies.supplyDate,
        dueDate:       supplies.dueDate,
        notes:         supplies.notes,
        paid:          paidSubquery,
        arrivalNumber: sql<string | null>`(
          SELECT a.arrival_number FROM arrivals a WHERE a.id = \`supplies\`.\`arrival_id\`
        )`,
      })
        .from(supplies)
        .innerJoin(suppliers, eq(supplies.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(desc(supplies.supplyDate), desc(supplies.id));

      const today = new Date(new Date().toDateString());
      let mapped = rows.map(r => {
        const amount = Number(r.amount);
        const paid   = Number(r.paid);
        const debt   = Math.round((amount - paid) * 100) / 100;
        return {
          ...r,
          amount, paid, debt,
          overdue: !!r.dueDate && debt > 0 && new Date(r.dueDate) < today,
        };
      });

      if (input?.onlyUnpaid)  mapped = mapped.filter(r => r.debt > 0);
      if (input?.onlyOverdue) mapped = mapped.filter(r => r.overdue);

      // Отсев по остатку и просрочке считается в коде (см. выше — долг
      // вычисляемый), поэтому и страница нарезается здесь же: LIMIT в SQL
      // отрезал бы строки до фильтрации и total врал бы.
      const total = mapped.length;
      const data  = mapped.slice((page - 1) * pageSize, page * pageSize);
      return { data, total, page, pageSize };
    }),

  /** Долг и платежи по поставке конкретного прихода — для карточки прихода. */
  getSupplyByArrival: operatorQuery
    .input(z.object({ arrivalId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const [supply] = await db.select({
        id:           supplies.id,
        supplierId:   supplies.supplierId,
        supplierName: suppliers.name,
        supplierPhone: suppliers.phone,
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
        authorName:    users.name,
      })
        .from(supplierPayments)
        .leftJoin(users, eq(supplierPayments.createdBy, users.id))
        .where(eq(supplierPayments.supplyId, supply.id))
        .orderBy(desc(supplierPayments.paidAt));

      return {
        ...supply,
        amount,
        paid,
        debt: Math.round((amount - paid) * 100) / 100,
        overdue: !!supply.dueDate && amount - paid > 0
          && new Date(supply.dueDate) < new Date(new Date().toDateString()),
        payments,
      };
    }),

  // ── Платежи ────────────────────────────────────────────────────────────────

  /** История платежей — по контрагенту или по всему разделу. */
  payments: operatorQuery
    .input(z.object({
      supplierId: z.number().optional(),
      limit:      z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;

      const conditions = [eq(supplierPayments.tenantId, tenantId)];
      if (input?.supplierId) {
        await assertOwnSupplier(db, tenantId, input.supplierId);
        conditions.push(eq(supplierPayments.supplierId, input.supplierId));
      }

      const rows = await db.select({
        id:            supplierPayments.id,
        supplierId:    supplierPayments.supplierId,
        supplierName:  suppliers.name,
        supplyId:      supplierPayments.supplyId,
        supplyNumber:  supplies.supplyNumber,
        currency:      supplies.currency,
        amount:        supplierPayments.amount,
        paidUzs:       supplierPayments.paidUzs,
        paymentMethod: supplierPayments.paymentMethod,
        paidAt:        supplierPayments.paidAt,
        notes:         supplierPayments.notes,
        authorName:    users.name,
      })
        .from(supplierPayments)
        .innerJoin(supplies, eq(supplierPayments.supplyId, supplies.id))
        .innerJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
        .leftJoin(users, eq(supplierPayments.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(supplierPayments.paidAt))
        .limit(input?.limit ?? 50);

      return rows.map(r => ({ ...r, amount: Number(r.amount) }));
    }),

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

      // Одной сделки МАЛО. Она изолирует, но не запирает: два платежа,
      // пришедшие разом, оба читали остаток 300 000 000, оба проходили
      // проверку и оба записывались — долг уходил в минус. Поймано прогоном
      // real-db, на заглушке транзакция сквозная и гонки там нет вовсе.
      //
      // FOR UPDATE запирает строку поставки: второй платёж ждёт на этой
      // строке, пока первый не завершится, и читает остаток уже с учётом
      // его записи.
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
          .limit(1)
          .for("update");

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
          logger.info("платёж контрагенту", {
            supplyId: input.supplyId, amount, currency: supply.currency, debtAfter,
          });

          return { id: Number(result.insertId), debt: debtAfter };
        } catch (e) {
          // Повтор той же попытки — не ошибка пользователя, а сорванная
          // связь. Отвечаем как на успех: деньги уже записаны один раз.
          //
          // Именно этот индекс, а не «любой дубликат»: нарушение другого
          // означало бы иную беду, и молча выдавать за успех её нельзя.
          if (isDuplicateOf(e, "uq_supplier_payment_idem")) {
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

  // ── Акт сверки ─────────────────────────────────────────────────────────────

  /**
   * Взаиморасчёты с контрагентом одной лентой: поставки увеличивают долг,
   * платежи уменьшают, рядом — остаток после каждой строки.
   *
   * Это тот самый документ, который в жизни распечатывают и везут на завод
   * сверять. Поэтому важны две вещи, которых нет в обычном списке:
   *
   *   Входящий остаток. Лента почти всегда смотрится за период («за август»),
   *   и без долга на начало периода она не сходится: непонятно, откуда взялся
   *   остаток в первой же строке.
   *
   *   Разбивка по валютам. Сумы и доллары идут отдельными лентами со своими
   *   остатками — сложить их в одну колонку значит напечатать неверный
   *   документ и повезти его контрагенту.
   */
  reconciliation: operatorQuery
    .input(z.object({
      supplierId: z.number(),
      from:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      await assertOwnSupplier(db, tenantId, input.supplierId);

      const [supplier] = await db.select({
        id: suppliers.id, name: suppliers.name, inn: suppliers.inn,
        phone: suppliers.phone, address: suppliers.address,
      })
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, tenantId)))
        .limit(1);

      const supplyRows = await db.select({
        id:            supplies.id,
        supplyNumber:  supplies.supplyNumber,
        amount:        supplies.amount,
        currency:      supplies.currency,
        supplyDate:    supplies.supplyDate,
        arrivalNumber: sql<string | null>`(
          SELECT a.arrival_number FROM arrivals a WHERE a.id = \`supplies\`.\`arrival_id\`
        )`,
      })
        .from(supplies)
        .where(and(eq(supplies.supplierId, input.supplierId), eq(supplies.tenantId, tenantId)));

      const paymentRows = await db.select({
        id:            supplierPayments.id,
        supplyId:      supplierPayments.supplyId,
        supplyNumber:  supplies.supplyNumber,
        currency:      supplies.currency,
        amount:        supplierPayments.amount,
        paymentMethod: supplierPayments.paymentMethod,
        paidAt:        supplierPayments.paidAt,
      })
        .from(supplierPayments)
        .innerJoin(supplies, eq(supplierPayments.supplyId, supplies.id))
        .where(and(
          eq(supplierPayments.supplierId, input.supplierId),
          eq(supplierPayments.tenantId, tenantId),
        ));

      type Event = {
        date: Date; kind: "supply" | "payment"; docNumber: string;
        currency: string; debit: number; credit: number; note: string | null;
      };

      const events: Event[] = [
        ...supplyRows.map(s => ({
          date: new Date(s.supplyDate), kind: "supply" as const,
          docNumber: s.supplyNumber, currency: s.currency,
          debit: Number(s.amount), credit: 0,
          note: s.arrivalNumber,
        })),
        ...paymentRows.map(p => ({
          date: new Date(p.paidAt), kind: "payment" as const,
          docNumber: p.supplyNumber, currency: p.currency,
          debit: 0, credit: Number(p.amount),
          note: p.paymentMethod,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      const from = input.from ? new Date(input.from) : null;
      // Конец дня, а не полночь: иначе «по 31 августа» отсекает всё, что
      // случилось 31 августа после полуночи, то есть весь этот день целиком.
      const to   = input.to ? new Date(`${input.to}T23:59:59.999`) : null;

      const byCurrency = (["UZS", "USD"] as const).map(currency => {
        const all = events.filter(e => e.currency === currency);
        if (all.length === 0) return null;

        // Входящий остаток — всё, что случилось до начала периода.
        const opening = from
          ? all.filter(e => e.date < from).reduce((acc, e) => acc + e.debit - e.credit, 0)
          : 0;

        const inPeriod = all.filter(e =>
          (!from || e.date >= from) && (!to || e.date <= to),
        );

        let balance = opening;
        const rows = inPeriod.map(e => {
          balance += e.debit - e.credit;
          return {
            date: e.date, kind: e.kind, docNumber: e.docNumber,
            debit: e.debit, credit: e.credit, note: e.note,
            balance: Math.round(balance * 100) / 100,
          };
        });

        return {
          currency,
          opening:         Math.round(opening * 100) / 100,
          turnoverDebit:   Math.round(inPeriod.reduce((a, e) => a + e.debit, 0) * 100) / 100,
          turnoverCredit:  Math.round(inPeriod.reduce((a, e) => a + e.credit, 0) * 100) / 100,
          closing:         Math.round(balance * 100) / 100,
          rows,
        };
      }).filter(Boolean);

      return { supplier, from: input.from ?? null, to: input.to ?? null, byCurrency };
    }),
});

/**
 * Финансы поставки для строки прихода: сумма, оплачено, остаток.
 *
 * Живёт здесь, а не в arrival-router, потому что описывает поставку — но
 * нужен именно там, чтобы список приходов показывал деньги без второго
 * запроса на каждую строку.
 */
export const arrivalSupplyColumns = {
  supplyAmount: sql<string | null>`(
    SELECT s.amount FROM supplies s WHERE s.arrival_id = \`arrivals\`.\`id\` LIMIT 1
  )`,
  supplyCurrency: sql<string | null>`(
    SELECT s.currency FROM supplies s WHERE s.arrival_id = \`arrivals\`.\`id\` LIMIT 1
  )`,
  supplyPaid: sql<string | null>`(
    SELECT COALESCE(SUM(p.amount), 0) FROM supplier_payments p
    JOIN supplies s ON s.id = p.supply_id
    WHERE s.arrival_id = \`arrivals\`.\`id\`
  )`,
  supplierName: sql<string | null>`(
    SELECT sup.name FROM supplies s
    JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE s.arrival_id = \`arrivals\`.\`id\` LIMIT 1
  )`,
  /** Сумма товаров прихода — Σ(количество × себестоимость). */
  goodsTotal: sql<string>`COALESCE((
    SELECT SUM(ai.quantity * ai.cost_price) FROM arrival_items ai
    WHERE ai.arrival_id = \`arrivals\`.\`id\`
  ), 0)`,
};

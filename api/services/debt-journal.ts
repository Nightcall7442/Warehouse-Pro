import { and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import { shops, orders, payments, returns, users } from "@db/schema";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { getDb } from "../queries/connection";
import { orderIsOwed, obligationDate, type StatementKind } from "./shop-statement";

/* ═══════════════════════════════════════════════════════════════════════════
   Журнал задолженности: кто когда взял в долг и кто когда заплатил.

   ── Чего не было ────────────────────────────────────────────────────────────

   Про ОДИН магазин ответ появился — акт сверки в его карточке. Про все сразу
   ответа не было ни одного. «Долги магазинов» показывают остаток на сейчас,
   «Дебиторка» — его же по возрастам; оба отвечают на вопрос «сколько должны»,
   и ни один — на вопрос «когда это случилось».

   А спрашивают чаще второе: почему за месяц долг вырос на сорок миллионов, у
   какого агента точки уходят в долг чаще других, когда точка платила в последний
   раз. Чтобы это увидеть, приходилось открывать карточки по одной.

   ── Правила отбора здесь не свои ────────────────────────────────────────────

   Что считать движением, знает services/shop-statement.ts, и знает в одном
   экземпляре: orderIsOwed и obligationDate берутся оттуда. Своя копия условий
   означала бы две почти одинаковые формулы одного и того же — в этом коде так
   уже расходились расчёт долга и его объяснение.

   ── Почему без остатка ──────────────────────────────────────────────────────

   Столбца «остаток» здесь нет намеренно. Журнал ограничен периодом и пределом
   строк, и нарастающий итог по обрезанному набору — число, верное только
   иногда. Остаток отвечает за карточку магазина, где виден весь ряд движений
   целиком.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DebtJournalRow {
  date: Date;
  shopId: number;
  shopName: string;
  city: string | null;
  agentName: string | null;
  kind: StatementKind;
  /** Номер заказа или возврата; у ручной записи его нет. */
  doc: string | null;
  note: string | null;
  /** Плюс — долг вырос, минус — погашен. */
  amount: number;
}

export interface DebtJournalOptions {
  from?: Date;
  to?: Date;
  agentId?: number;
  territoryId?: number;
  /** Предел строк: журнал за год у крупной сети — это десятки тысяч движений. */
  limit?: number;
}

const money = (v: unknown) => Number(v ?? 0);

export async function debtJournal(
  tenantId: number,
  opts: DebtJournalOptions = {},
): Promise<{ rows: DebtJournalRow[]; truncated: boolean; totals: { taken: number; paid: number } }> {
  const db = getDb();
  const limit = opts.limit ?? 5000;

  /** Условия по самой точке — общие для всех четырёх источников. */
  const shopScope = [eq(shops.tenantId, tenantId)];
  if (opts.agentId)     shopScope.push(eq(shops.agentId, opts.agentId));
  if (opts.territoryId) shopScope.push(eq(shops.territoryId, opts.territoryId));

  const shopCols = {
    shopId: shops.id, shopName: shops.name, city: shops.city, agentName: users.name,
  };

  /*
    Отбор по дате идёт в базе, а не в памяти.

    У заказа дата обязательства — это created_at у долгового и delivered_at у
    обычного, поэтому одним условием их не отобрать: берём период по обеим
    датам с запасом и отбрасываем лишнее уже после вычисления. У остальных
    трёх источников дата одна, и условие точное.
  */
  const inPeriod = (col: AnyMySqlColumn) => {
    const c = [];
    if (opts.from) c.push(gte(col, opts.from));
    if (opts.to)   c.push(lte(col, opts.to));
    return c;
  };

  const orderRows = await db.select({
    ...shopCols,
    createdAt: orders.createdAt,
    deliveredAt: orders.deliveredAt,
    paymentMethod: orders.paymentMethod,
    doc: orders.orderNumber,
    total: orders.total,
  })
    .from(orders)
    .innerJoin(shops, and(eq(orders.shopId, shops.id), ...shopScope))
    .leftJoin(users, eq(shops.agentId, users.id))
    .where(and(eq(orders.tenantId, tenantId), orderIsOwed()))
    .orderBy(desc(orders.createdAt))
    .limit(limit * 2);

  const paymentRows = await db.select({
    ...shopCols,
    createdAt: payments.createdAt,
    type: payments.type,
    amount: payments.amount,
    note: payments.notes,
    orderId: payments.orderId,
    orderDeletedAt: orders.deletedAt,
  })
    .from(payments)
    .innerJoin(shops, and(eq(payments.shopId, shops.id), ...shopScope))
    .leftJoin(users, eq(shops.agentId, users.id))
    // Заказ подтягивается ради одного признака: удалён он или нет.
    .leftJoin(orders, eq(payments.orderId, orders.id))
    .where(and(eq(payments.tenantId, tenantId), ...inPeriod(payments.createdAt)))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  const returnRows = await db.select({
    ...shopCols,
    createdAt: returns.createdAt,
    doc: returns.returnNumber,
    amount: returns.totalAmount,
    note: returns.notes,
    orderId: returns.orderId,
  })
    .from(returns)
    .innerJoin(shops, and(eq(returns.shopId, shops.id), ...shopScope))
    .leftJoin(users, eq(shops.agentId, users.id))
    .where(and(eq(returns.tenantId, tenantId), eq(returns.status, "completed"), ...inPeriod(returns.createdAt)))
    .orderBy(desc(returns.createdAt))
    .limit(limit);

  // Возврат вычитается, только если его заказ ещё должен либо заказа нет.
  const owedIds = new Set<number>();
  const returnOrderIds = returnRows.map(r => r.orderId).filter((v): v is number => v !== null);
  if (returnOrderIds.length > 0) {
    const owed = await db.select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, returnOrderIds), orderIsOwed()));
    for (const o of owed) owedIds.add(o.id);
  }

  const base = (r: { shopId: number; shopName: string; city: string | null; agentName: string | null }) => ({
    shopId: r.shopId, shopName: r.shopName, city: r.city, agentName: r.agentName,
  });

  const rows: DebtJournalRow[] = [
    ...orderRows.map(o => ({
      ...base(o),
      date: obligationDate(o as { paymentMethod: string; createdAt: Date; deliveredAt: Date | null }),
      kind: "order" as const,
      doc: o.doc,
      note: null,
      amount: money(o.total),
    })),
    ...paymentRows
      // Платёж по удалённому заказу не считается: удаление значит «заказа не
      // было», а с ним не было и оплаты. Так же поступает recalcShopDebt.
      .filter(p => p.orderId === null || p.orderDeletedAt === null)
      // Ручное начисление — только без привязки к заказу: с заказом
      // обязательство уже учтено самим заказом.
      .filter(p => p.type === "payment" || p.orderId === null)
      .map(p => ({
        ...base(p),
        date: p.createdAt as Date,
        kind: (p.type === "payment" ? "payment" : "debt") as StatementKind,
        doc: null,
        note: p.note,
        amount: p.type === "payment" ? -money(p.amount) : money(p.amount),
      })),
    ...returnRows
      .filter(r => r.orderId === null || owedIds.has(r.orderId))
      .map(r => ({
        ...base(r),
        date: r.createdAt as Date,
        kind: "return" as const,
        doc: r.doc,
        note: r.note,
        amount: -money(r.amount),
      })),
  ]
    // Дата обязательства у заказов вычислена уже здесь, поэтому период
    // применяется к готовому ряду — иначе долговой и обычный заказ отбирались
    // бы по разным столбцам.
    .filter(r => (!opts.from || r.date >= opts.from) && (!opts.to || r.date <= opts.to))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const totals = rows.reduce(
    (acc, r) => (r.amount >= 0 ? { ...acc, taken: acc.taken + r.amount } : { ...acc, paid: acc.paid - r.amount }),
    { taken: 0, paid: 0 },
  );

  return {
    rows: rows.slice(0, limit),
    // Обрезанный журнал должен об этом сказать: молча укоротить список значит
    // соврать про период.
    truncated: rows.length > limit,
    totals,
  };
}


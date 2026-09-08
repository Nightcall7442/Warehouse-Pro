import { and, eq, gte, lte, like, desc } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { shops, orders, payments, returns, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { orderIsOwed, obligationDate, type StatementKind } from "./shop-statement";

/* ═══════════════════════════════════════════════════════════════════════════
   Полный архив задолженности: кто когда взял в долг и кто когда погасил.

   ── Чего не было ────────────────────────────────────────────────────────────

   Про ОДИН магазин ответ есть — акт сверки в его карточке. Про все сразу и за
   всё время не было ничего: «Долги магазинов» и «Дебиторка» показывают остаток
   на сейчас, и ни один отчёт не говорил, КОГДА это случилось. Чтобы увидеть,
   приходилось открывать карточки точек по одной.

   ── Почему четыре запроса, а не один UNION ──────────────────────────────────

   Промежуточный вариант собирал движения одним сырым запросом с UNION ALL и
   отдавал страницу средствами базы. В бою он падал:

       Illegal mix of collations for operation 'UNION'

   Причина не в синтаксисе, поэтому глазами она и не находилась. В объединении
   столбец «документ» собирался из orders.order_number, returns.return_number и
   заглушки CAST(NULL AS CHAR(1)), а столбец «примечание» — из notes и такой же
   заглушки. У столбцов сопоставление ТАБЛИЧНОЕ, у литерала — сопоставление
   СОЕДИНЕНИЯ, и MySQL отказывается сводить их в одну колонку. Проверить это
   без живой базы нечем: запрос синтаксически безупречен.

   Здесь тот же результат построителем запросов drizzle — тем путём, которым в
   этом коде читаются эти же таблицы везде, и который поэтому проверен.
   Сведение, сортировка и страница делаются в памяти, а поведение проверяется
   поведением, а не сверкой текста запроса глазами.

   Цена известна и ограничена: с каждого источника берётся не больше HARD_CAP
   движений, и если предел достигнут, ответ говорит об этом признаком
   truncated, а не молчит. Вернуться к запросу на стороне базы можно — но тогда
   заглушки придётся приводить к сопоставлению столбцов явным COLLATE, и это
   надо будет проверить на живой базе, а не на глаз.

   ── Правила отбора здесь не свои ────────────────────────────────────────────

   Что считать движением, знает services/shop-statement.ts: orderIsOwed и
   obligationDate берутся оттуда. Своя копия условий означала бы две почти
   одинаковые формулы одного и того же — в этом коде так уже расходились
   расчёт долга и его объяснение.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DebtJournalRow {
  date: Date;
  shopId: number;
  shopName: string;
  city: string | null;
  agentName: string | null;
  kind: StatementKind;
  /** Номер документа: заказа или возврата. У ручной записи его нет. */
  doc: string | null;
  /** Заказ, на который можно перейти. У ручной записи пуст. */
  orderId: number | null;
  note: string | null;
  /** Плюс — долг вырос, минус — погашен. */
  amount: number;
}

export interface DebtJournalQuery {
  from?: Date;
  to?: Date;
  agentId?: number;
  territoryId?: number;
  shopId?: number;
  /** Поиск по названию точки. */
  search?: string;
  kind?: StatementKind;
  page?: number;
  pageSize?: number;
}

export interface DebtJournalPage {
  rows: DebtJournalRow[];
  /** Сколько движений всего под этими фильтрами — не на странице. */
  total: number;
  page: number;
  pageSize: number;
  /** Итоги по всему набору под фильтрами. */
  totals: { taken: number; paid: number };
  /** Уперлись в предел: показано не всё, и об этом надо сказать вслух. */
  truncated: boolean;
}

const MAX_PAGE_SIZE = 500;
/** Предел выборки с каждого источника. */
const HARD_CAP = 20_000;

const money = (v: unknown) => Number(v ?? 0);

export async function debtJournal(tenantId: number, q: DebtJournalQuery = {}): Promise<DebtJournalPage> {
  const db = getDb();
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? 50));

  /** Условия по самой точке — общие для всех источников. */
  const shopScope = [eq(shops.tenantId, tenantId)];
  if (q.agentId)     shopScope.push(eq(shops.agentId, q.agentId));
  if (q.territoryId) shopScope.push(eq(shops.territoryId, q.territoryId));
  if (q.shopId)      shopScope.push(eq(shops.id, q.shopId));
  if (q.search?.trim()) shopScope.push(like(shops.name, `%${q.search.trim()}%`));

  const shopCols = {
    shopId: shops.id, shopName: shops.name, city: shops.city, agentName: users.name,
  };

  /*
    Отбор по дате — в базе, где дата у движения одна.

    У заказа их две: обязательство возникает с оформления у долгового и с
    отгрузки у обычного. Одним условием их не отобрать, поэтому заказы берутся
    целиком, а период применяется к вычисленной дате уже здесь.
  */
  const inPeriod = (col: AnyMySqlColumn) => {
    const c = [];
    if (q.from) c.push(gte(col, q.from));
    if (q.to)   c.push(lte(col, q.to));
    return c;
  };

  const wantKind = (k: StatementKind) => !q.kind || q.kind === k;

  const [orderRows, paymentRows, returnRows] = await Promise.all([
    wantKind("order")
      ? db.select({ ...shopCols, createdAt: orders.createdAt, deliveredAt: orders.deliveredAt,
                    paymentMethod: orders.paymentMethod, doc: orders.orderNumber,
                    total: orders.total, orderId: orders.id })
          .from(orders)
          .innerJoin(shops, and(eq(orders.shopId, shops.id), ...shopScope))
          .leftJoin(users, eq(shops.agentId, users.id))
          .where(and(eq(orders.tenantId, tenantId), orderIsOwed()))
          .orderBy(desc(orders.createdAt))
          .limit(HARD_CAP)
      : [],

    (wantKind("payment") || wantKind("debt"))
      ? db.select({ ...shopCols, createdAt: payments.createdAt, type: payments.type,
                    amount: payments.amount, note: payments.notes, orderId: payments.orderId,
                    orderDeletedAt: orders.deletedAt })
          .from(payments)
          .innerJoin(shops, and(eq(payments.shopId, shops.id), ...shopScope))
          .leftJoin(users, eq(shops.agentId, users.id))
          // Заказ подтягивается ради одного признака: удалён он или нет.
          .leftJoin(orders, eq(payments.orderId, orders.id))
          .where(and(eq(payments.tenantId, tenantId), ...inPeriod(payments.createdAt)))
          .orderBy(desc(payments.createdAt))
          .limit(HARD_CAP)
      : [],

    wantKind("return")
      ? db.select({ ...shopCols, createdAt: returns.createdAt, doc: returns.returnNumber,
                    amount: returns.totalAmount, note: returns.notes, orderId: returns.orderId })
          .from(returns)
          .innerJoin(shops, and(eq(returns.shopId, shops.id), ...shopScope))
          .leftJoin(users, eq(shops.agentId, users.id))
          .where(and(eq(returns.tenantId, tenantId), eq(returns.status, "completed"), ...inPeriod(returns.createdAt)))
          .orderBy(desc(returns.createdAt))
          .limit(HARD_CAP)
      : [],
  ]);

  /*
    Возврат вычитается, только если его заказ ещё должен либо заказа нет.

    Отменённый заказ и так даёт ноль; списание сверх него уносит те же деньги
    дважды, и у точки с другими открытыми заказами излишек съедает чужой долг.
  */
  const owedIds = new Set<number>();
  const returnOrderIds = returnRows.map(r => r.orderId).filter((v): v is number => v !== null);
  if (returnOrderIds.length > 0) {
    const owed = await db.select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), orderIsOwed()));
    for (const o of owed) if (returnOrderIds.includes(o.id)) owedIds.add(o.id);
  }

  const base = (r: { shopId: number; shopName: string; city: string | null; agentName: string | null }) => ({
    shopId: r.shopId, shopName: r.shopName, city: r.city, agentName: r.agentName,
  });

  const all: DebtJournalRow[] = [
    ...orderRows.map(o => ({
      ...base(o),
      date: obligationDate(o as { paymentMethod: string; createdAt: Date; deliveredAt: Date | null }),
      kind: "order" as const,
      doc: o.doc,
      orderId: o.orderId,
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
      .filter(p => wantKind(p.type === "payment" ? "payment" : "debt"))
      .map(p => ({
        ...base(p),
        date: p.createdAt as Date,
        kind: (p.type === "payment" ? "payment" : "debt") as StatementKind,
        doc: null,
        orderId: p.orderId,
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
        orderId: r.orderId,
        note: r.note,
        amount: -money(r.amount),
      })),
  ]
    // Период применяется к готовому ряду: у заказов дата вычислена уже здесь.
    .filter(r => (!q.from || r.date >= q.from) && (!q.to || r.date <= q.to))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const totals = all.reduce(
    (acc, r) => (r.amount >= 0
      ? { taken: acc.taken + r.amount, paid: acc.paid }
      : { taken: acc.taken, paid: acc.paid - r.amount }),
    { taken: 0, paid: 0 },
  );

  const offset = (page - 1) * pageSize;
  return {
    rows: all.slice(offset, offset + pageSize),
    total: all.length,
    page,
    pageSize,
    totals,
    truncated: orderRows.length >= HARD_CAP || paymentRows.length >= HARD_CAP || returnRows.length >= HARD_CAP,
  };
}


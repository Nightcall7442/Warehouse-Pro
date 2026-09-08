import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { rowsOf, firstRow } from "../lib/db-rows";
import { orderIsOwed, type StatementKind } from "./shop-statement";

/* ═══════════════════════════════════════════════════════════════════════════
   Полный архив задолженности: кто когда взял в долг и кто когда погасил.

   ── Чего не было ────────────────────────────────────────────────────────────

   Про ОДИН магазин ответ есть — акт сверки в его карточке. Про все сразу и за
   всё время не было ничего. «Долги магазинов» и «Дебиторка» показывают остаток
   на сейчас; ни один отчёт не говорил, КОГДА это случилось.

   Первая попытка отвечала на этот вопрос наполовину: четыре отдельных запроса,
   сведение и сортировка в памяти, предел строк и признак «показано не всё».
   Для месяца сойдёт, для архива — нет. Нужен ряд, по которому можно листать
   сколько угодно вглубь: кто когда взял долг и когда оплатил, даже годы спустя.
   Обрезанный список на такой вопрос отвечать не может в принципе — он отвечает
   «а дальше не знаю».

   ── Отсюда UNION и страницы ─────────────────────────────────────────────────

   Четыре источника сводятся ОДНИМ запросом, и сведение, сортировку и отбор
   страницы делает база. Это единственный способ листать вглубь честно: при
   сведении в памяти вторая страница требовала бы вычитать всё, что было до
   неё, а предел на каждый источник по отдельности врал бы тем сильнее, чем
   дальше человек листает.

   Итоги считаются по ВСЕМУ набору под фильтрами, а не по видимой странице:
   «взяли столько, погасили столько» — ответ про период, а не про пятьдесят
   строк, попавших на экран.

   ── Правила отбора здесь не свои ────────────────────────────────────────────

   Что считать движением, знает services/shop-statement.ts: orderIsOwed берётся
   оттуда и подставляется в запрос как есть. Своя копия условий означала бы две
   почти одинаковые формулы одного и того же — в этом коде так уже расходились
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
}

/**
 * Четыре источника движения долга одним набором строк.
 *
 * Имена столбцов задаёт первая ветвь — так устроен UNION в MySQL. NULL-ы
 * приводятся явно: без приведения тип столбца в объединении выводится по
 * первой ветви, и текстовое поле, начавшееся с NULL, обрезало бы остальные.
 */
function movementsUnion(tenantId: number): SQL {
  return sql`
    SELECT
      orders.shop_id AS shop_id,
      CASE
        WHEN orders.payment_method = 'debt' THEN orders.created_at
        ELSE COALESCE(orders.delivered_at, orders.created_at)
      END AS moved_at,
      'order' AS kind,
      orders.order_number AS doc,
      CAST(NULL AS CHAR(1)) AS note,
      CAST(orders.total AS DECIMAL(15,2)) AS amount,
      orders.id AS order_id
    FROM orders
    WHERE orders.tenant_id = ${tenantId} AND ${orderIsOwed()}

    UNION ALL

    SELECT
      payments.shop_id, payments.created_at, 'payment', CAST(NULL AS CHAR(1)),
      payments.notes, -CAST(payments.amount AS DECIMAL(15,2)), payments.order_id
    FROM payments
    WHERE payments.tenant_id = ${tenantId} AND payments.type = 'payment'
      AND (payments.order_id IS NULL OR EXISTS (
        SELECT 1 FROM orders WHERE orders.id = payments.order_id AND orders.deleted_at IS NULL
      ))

    UNION ALL

    SELECT
      payments.shop_id, payments.created_at, 'debt', CAST(NULL AS CHAR(1)),
      payments.notes, CAST(payments.amount AS DECIMAL(15,2)), payments.order_id
    FROM payments
    WHERE payments.tenant_id = ${tenantId} AND payments.type = 'debt' AND payments.order_id IS NULL

    UNION ALL

    SELECT
      returns.shop_id, returns.created_at, 'return', returns.return_number,
      returns.notes, -CAST(returns.total_amount AS DECIMAL(15,2)), returns.order_id
    FROM returns
    WHERE returns.tenant_id = ${tenantId} AND returns.status = 'completed'
      AND (returns.order_id IS NULL OR EXISTS (
        SELECT 1 FROM orders WHERE orders.id = returns.order_id AND ${orderIsOwed()}
      ))
  `;
}

/*
  Три условия внутри объединения повторяют правила, разобранные в
  services/shop-debt.ts, и стоят там же по тем же причинам:

  · платёж по УДАЛЁННОМУ заказу не считается — удаление это «заказа не было»,
    а с ним не было и оплаты; засчитать её значило бы выдать придуманный кредит;
  · ручное начисление считается только БЕЗ заказа — с заказом обязательство
    уже учтено самим заказом, иначе оно удваивается;
  · возврат по заказу, который и так ничего не должен, не вычитается — заказ
    уже даёт ноль, и списание сверх него уносит те же деньги дважды.
*/

/** Условия по точке и по периоду — одни и те же у страницы и у итогов. */
function filters(q: DebtJournalQuery): SQL[] {
  const c: SQL[] = [];
  if (q.from)        c.push(sql`m.moved_at >= ${q.from}`);
  if (q.to)          c.push(sql`m.moved_at <= ${q.to}`);
  if (q.agentId)     c.push(sql`s.agent_id = ${q.agentId}`);
  if (q.territoryId) c.push(sql`s.territory_id = ${q.territoryId}`);
  if (q.shopId)      c.push(sql`s.id = ${q.shopId}`);
  if (q.kind)        c.push(sql`m.kind = ${q.kind}`);
  if (q.search?.trim()) {
    // Экранируются служебные знаки самого LIKE: без этого «%», набранный
    // человеком, превращает поиск в «показать всё».
    const like = `%${q.search.trim().replace(/[\\%_]/g, ch => "\\" + ch)}%`;
    c.push(sql`s.name LIKE ${like}`);
  }
  return c;
}

const MAX_PAGE_SIZE = 500;

export async function debtJournal(tenantId: number, q: DebtJournalQuery = {}): Promise<DebtJournalPage> {
  const db = getDb();
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const where = filters(q);
  const whereSql = where.length ? sql` AND ${sql.join(where, sql` AND `)}` : sql``;

  const source = sql`
    FROM (${movementsUnion(tenantId)}) m
    JOIN shops s ON s.id = m.shop_id AND s.tenant_id = ${tenantId}
    LEFT JOIN users u ON u.id = s.agent_id
    WHERE 1 = 1${whereSql}
  `;

  const [pageResult, totalsResult] = await Promise.all([
    db.execute(sql`
      SELECT m.moved_at, m.kind, m.doc, m.note, m.amount, m.order_id,
             s.id AS shop_id, s.name AS shop_name, s.city, u.name AS agent_name
      ${source}
      ORDER BY m.moved_at DESC, m.kind ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    /*
      Итоги и счётчик — по всему набору, а не по странице.

      «Взяли столько, погасили столько» отвечает про период; посчитанное по
      пятидесяти видимым строкам это число означало бы совсем другое, а
      выглядело бы точно так же.
    */
    db.execute(sql`
      SELECT COUNT(*) AS n,
             COALESCE(SUM(CASE WHEN m.amount > 0 THEN m.amount ELSE 0 END), 0) AS taken,
             COALESCE(SUM(CASE WHEN m.amount < 0 THEN -m.amount ELSE 0 END), 0) AS paid
      ${source}
    `),
  ]);

  const totals = firstRow<{ n: number; taken: string; paid: string }>(totalsResult);

  return {
    rows: rowsOf<Record<string, unknown>>(pageResult).map(toRow),
    total: Number(totals?.n ?? 0),
    page,
    pageSize,
    totals: { taken: Number(totals?.taken ?? 0), paid: Number(totals?.paid ?? 0) },
  };
}

/**
 * Строка базы в строку журнала.
 *
 * Вынесено отдельно и без обращений к базе: именно здесь легко потерять знак
 * суммы или подставить не тот столбец, и проверять это надо без живой базы.
 */
export function toRow(r: Record<string, unknown>): DebtJournalRow {
  return {
    date: new Date(r.moved_at as string),
    shopId: Number(r.shop_id ?? 0),
    shopName: String(r.shop_name ?? ""),
    city: (r.city as string | null) ?? null,
    agentName: (r.agent_name as string | null) ?? null,
    kind: String(r.kind) as StatementKind,
    doc: (r.doc as string | null) ?? null,
    orderId: r.order_id == null ? null : Number(r.order_id),
    note: (r.note as string | null) ?? null,
    amount: Number(r.amount ?? 0),
  };
}

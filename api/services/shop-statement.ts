import { and, eq, isNull, or, inArray, notInArray } from "drizzle-orm";
import { shops, orders, payments, returns } from "@db/schema";
import { getDb } from "../queries/connection";

/* ═══════════════════════════════════════════════════════════════════════════
   Акт сверки с магазином: откуда взялось число долга.

   ── Чего не было ────────────────────────────────────────────────────────────

   Долг магазина хранится одним числом в shops.debt. Число это выводится, а не
   ведётся вручную (services/shop-debt.ts), и выводится оно правильно — но
   ПОКАЗАТЬ, из чего оно сложилось, было нечем. В карточке точки стоял блок
   «История платежей»: последние двадцать записей таблицы payments, из которых
   на экран попадали пять, без остатка после каждой строки, без отгрузок, без
   возвратов и без того, кто её внёс.

   То есть на вопрос владельца магазина «за что двенадцать миллионов?» ответить
   было нечем, кроме как назвать сумму ещё раз. Спор о долге решается бумагой,
   которую подписывают обе стороны, — и у поставщиков такая бумага в этой
   системе есть (CounterpartyDetail, «Акт сверки взаимных расчётов»). У
   магазинов, то есть у той стороны, где деньги нам должны, её не было.

   ── Что считается движением ─────────────────────────────────────────────────

   Ровно то же, из чего recalcShopDebt выводит само число. Условия здесь
   обязаны совпадать с тамошними дословно, а не «по смыслу»: две почти
   одинаковые формулы одного и того же — это два ответа на один вопрос, и рано
   или поздно они разойдутся.

     · отгрузка   (+) — заказ, ставший обязательством: не удалён, не отменён,
                        не возвращён, и либо продан в долг, либо доставлен;
     · оплата     (−) — платёж; кроме платежей по удалённому заказу: удаление
                        заказа значит «его не было», а с ним не было и оплаты;
     · начисление (+) — ручной долг, не привязанный к заказу;
     · возврат    (−) — завершённый возврат по заказу, который ещё должен, либо
                        возврат сам по себе.

   ── Расхождение ─────────────────────────────────────────────────────────────

   Сумма движений может НЕ совпасть с shops.debt, и это не ошибка расчёта.
   recalcShopDebt дважды ставит нижнюю границу по нулю: у каждого заказа
   отдельно (переплата по одному заказу не уходит в минус) и у всей суммы.
   Переплатили — движения дают меньше нуля, а долг равен нулю.

   Такую разницу видно отдельной строкой, а не прячут. Ноль в ней означает
   «бумага сходится с системой»; не ноль — либо переплата, либо повод
   разбираться, и лучше узнать об этом из акта, чем из спора с магазином.
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatementKind = "order" | "payment" | "debt" | "return";

/**
 * Дата, с которой заказ стал долгом.
 *
 * Заказ в долг должен с того дня, как выписан. Обычный — с того, как товар
 * уехал: до отгрузки магазин ничего не должен, что бы ни стояло в заказе.
 * deliveredAt бывает пустым у давних записей, там остаётся дата заказа: это
 * приближение, но оно честнее, чем не показать движение вовсе.
 */
export function obligationDate(o: { paymentMethod: string; createdAt: Date; deliveredAt: Date | null }): Date {
  return o.paymentMethod === "debt" ? o.createdAt : (o.deliveredAt ?? o.createdAt);
}

export interface StatementRow {
  date: Date;
  kind: StatementKind;
  /** Номер документа: заказа или возврата. У ручных записей его нет. */
  doc: string | null;
  note: string | null;
  /** Увеличивает долг. */
  debit: number;
  /** Уменьшает долг. */
  credit: number;
  /** Остаток после этой строки. */
  balance: number;
}

/**
 * Границы периода акта из двух дат «ГГГГ-ММ-ДД».
 *
 * Конец — последняя миллисекунда дня, а не полночь. Было `new Date(to)`, то
 * есть начало дня: акт «по 9 октября» терял всё, что случилось 9 октября, —
 * последний день периода выпадал целиком, а с ним и остаток на конец не
 * сходился с тем, что видел бухгалтер. В акте с поставщиком это поправлено
 * давно (supplier-router, statement), здесь — нет.
 *
 * Сутки — по UTC, как везде в системе (api/lib/date-range.ts: onDay).
 * Строку не той формы разбираем как раньше: молча терять период хуже.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function statementBounds(from?: string, to?: string): { from?: Date; to?: Date } {
  const parse = (v: string | undefined, edge: "start" | "end") => {
    if (!v) return undefined;
    const d = DAY_RE.test(v)
      ? new Date(`${v}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`)
      : new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return { from: parse(from, "start"), to: parse(to, "end") };
}

export interface ShopStatement {
  shop: { id: number; name: string; ownerName: string | null; phone: string | null; address: string | null; taxId: string | null };
  from: Date | null;
  to: Date | null;
  /** Остаток на начало периода. */
  opening: number;
  rows: StatementRow[];
  /** Остаток на конец периода: opening плюс движения. */
  closing: number;
  /** Долг, который система считает текущим (shops.debt). */
  debtNow: number;
  /**
   * debtNow − closing на открытом справа периоде. Ноль — бумага сходится.
   * Смысл ненулевого значения разобран в шапке файла.
   */
  discrepancy: number;
  totals: { debit: number; credit: number };
}

/** Движение до сведения в строки акта. */
interface Movement { date: Date; kind: StatementKind; doc: string | null; note: string | null; amount: number }

const money = (v: unknown) => Number(v ?? 0);

/**
 * Условие «заказ является обязательством».
 *
 * Дословно то же, что в recalcShopDebt: не удалён, не отменён и не возвращён,
 * и либо продан в долг, либо уже доставлен.
 *
 * Вывезено наружу нарочно: этими же правилами пользуется журнал задолженности
 * по всем точкам (services/debt-journal.ts). Две почти одинаковые формулы
 * одного и того же — это два ответа на один вопрос, и они однажды разойдутся;
 * в этом файле такое уже разбиралось про recalcShopDebt.
 */
export function orderIsOwed() {
  return and(
    isNull(orders.deletedAt),
    notInArray(orders.status, ["cancelled", "returned"]),
    or(eq(orders.paymentMethod, "debt"), eq(orders.status, "delivered")),
  );
}

export async function shopStatement(
  tenantId: number,
  shopId: number,
  from?: Date,
  to?: Date,
  now: Date = new Date(),
): Promise<ShopStatement | null> {
  const db = getDb();

  const [shop] = await db.select({
    id: shops.id, name: shops.name, ownerName: shops.ownerName,
    phone: shops.phone, address: shops.address, debt: shops.debt, taxId: shops.taxId,
  })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
    .limit(1);
  if (!shop) return null;

  const orderRows = await db.select({
    createdAt: orders.createdAt,
    deliveredAt: orders.deliveredAt,
    paymentMethod: orders.paymentMethod,
    number: orders.orderNumber,
    total: orders.total,
  })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.tenantId, tenantId), orderIsOwed()));

  const paymentRows = await db.select({
    createdAt: payments.createdAt,
    type: payments.type,
    amount: payments.amount,
    notes: payments.notes,
    orderId: payments.orderId,
  })
    .from(payments)
    .where(and(eq(payments.shopId, shopId), eq(payments.tenantId, tenantId)));

  /*
    Платежи по удалённому заказу не считаются.

    Удаление заказа — штатный способ исправить ошибку ВВОДА: заказа не было
    вовсе, значит не было и оплаты по нему. Засчитать её значило бы выдать
    магазину придуманный кредит. Так же поступает recalcShopDebt.
  */
  const orderIds = paymentRows.map(p => p.orderId).filter((v): v is number => v !== null);
  const liveOrderIds = new Set<number>();
  if (orderIds.length > 0) {
    const live = await db.select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds), isNull(orders.deletedAt)));
    for (const o of live) liveOrderIds.add(o.id);
  }

  const returnRows = await db.select({
    createdAt: returns.createdAt,
    number: returns.returnNumber,
    amount: returns.totalAmount,
    notes: returns.notes,
    orderId: returns.orderId,
  })
    .from(returns)
    .where(and(eq(returns.shopId, shopId), eq(returns.tenantId, tenantId), eq(returns.status, "completed")));

  // Возврат вычитается, если его заказ ещё должен, либо заказа нет вовсе.
  const returnOrderIds = returnRows.map(r => r.orderId).filter((v): v is number => v !== null);
  const owedOrderIds = new Set<number>();
  if (returnOrderIds.length > 0) {
    const owed = await db.select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, returnOrderIds), orderIsOwed()));
    for (const o of owed) owedOrderIds.add(o.id);
  }

  const movements: Movement[] = [
    ...orderRows.map(o => ({
      date: obligationDate(o as { paymentMethod: string; createdAt: Date; deliveredAt: Date | null }),
      kind: "order" as const,
      doc: o.number,
      note: null,
      amount: money(o.total),
    })),
    ...paymentRows
      .filter(p => p.orderId === null || liveOrderIds.has(p.orderId))
      // Ручное начисление считается только без привязки к заказу: с заказом
      // обязательство уже учтено самим заказом.
      .filter(p => p.type === "payment" || p.orderId === null)
      .map(p => ({
        date: p.createdAt as Date,
        kind: (p.type === "payment" ? "payment" : "debt") as StatementKind,
        doc: null,
        note: p.notes,
        amount: p.type === "payment" ? -money(p.amount) : money(p.amount),
      })),
    ...returnRows
      .filter(r => r.orderId === null || owedOrderIds.has(r.orderId))
      .map(r => ({
        date: r.createdAt as Date,
        kind: "return" as const,
        doc: r.number,
        note: r.notes,
        amount: -money(r.amount),
      })),
  ];

  movements.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Остаток на начало — всё, что случилось до периода.
  const before = from ? movements.filter(m => m.date < from) : [];
  const opening = before.reduce((s, m) => s + m.amount, 0);

  const inPeriod = movements.filter(m =>
    (!from || m.date >= from) && (!to || m.date <= to));

  let balance = opening;
  let debit = 0, credit = 0;
  const rows: StatementRow[] = inPeriod.map(m => {
    balance += m.amount;
    if (m.amount >= 0) debit += m.amount; else credit += -m.amount;
    return {
      date: m.date,
      kind: m.kind,
      doc: m.doc,
      note: m.note,
      debit: m.amount >= 0 ? m.amount : 0,
      credit: m.amount < 0 ? -m.amount : 0,
      balance,
    };
  });

  const debtNow = money(shop.debt);
  return {
    shop: { id: shop.id, name: shop.name, ownerName: shop.ownerName, phone: shop.phone, address: shop.address, taxId: shop.taxId ?? null },
    from: from ?? null,
    to: to ?? null,
    opening,
    rows,
    closing: balance,
    debtNow,
    // Считать расхождение имеет смысл только у периода, доведённого до сегодня:
    // на закрытом справа остаток и не обязан совпадать с текущим долгом.
    // «Этот месяц» и «с начала года» кончаются сегодняшним днём — для них
    // сверка с системой так же осмысленна, как для «всего времени».
    discrepancy: to && to.getTime() < now.getTime() ? 0 : debtNow - balance,
    totals: { debit, credit },
  };
}


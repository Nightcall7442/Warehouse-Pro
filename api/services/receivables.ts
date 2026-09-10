/**
 * Старение долга магазинов: сколько нам должны и КАК ДАВНО.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Наш долг перед поставщиком система знает подробно: у поставки есть срок
 * оплаты, и просрочка считается запросом (supplier-router). А долг магазинов
 * нам хранится одним числом в shops.debt — «двенадцать миллионов», и всё.
 *
 * Двенадцать миллионов недельного долга и двенадцать миллионов полугодового —
 * это две разные организации. В первой деньги в обороте, во второй их уже
 * почти нет. По одному числу отличить нельзя, а решение — кому звонить, кому
 * отгружать в долг, а кому перестать — принимается именно из этого различия.
 *
 * ── Почему не всё сходится к shops.debt, и что с этим делать ────────────────
 *
 * Долг магазина складывается из трёх слагаемых (см. services/shop-debt.ts):
 *
 *   1. неоплаченные заказы — у каждого есть дата, их и можно состарить;
 *   2. начисления и оплаты, записанные на магазин БЕЗ заказа, — у них своей
 *      даты обязательства нет;
 *   3. оформленные возвраты — они уменьшают долг.
 *
 * Состарить можно только первое. Поэтому сумма корзин меньше долга, и
 * замолчать эту разницу нельзя: отчёт, части которого не сходятся с итогом,
 * хуже отсутствующего — однажды это уже случилось с плиткой «мало стока»,
 * которая считала одно, а окно показывало другое.
 *
 * Разница возвращается отдельной величиной `unattributed` и показывается на
 * экране своей строкой. Тогда корзины плюс она дают ровно shops.debt, и
 * человек видит не только «сколько старого», но и «сколько вообще не
 * привязано к заказу» — а это, как правило, признак ручных правок, за
 * которыми стоит присмотреть.
 *
 * ── Почему границы именно такие ─────────────────────────────────────────────
 *
 * 7 / 30 / 60 дней — это не круглые числа ради круглоты. Неделя — обычная
 * отсрочка, в неё укладывается нормальная работа. Месяц — срок, после
 * которого агент едет разговаривать. Два месяца — деньги, которые уже принято
 * считать трудными.
 */
import { sql } from "drizzle-orm";

// Тот же приём, что у соседних служб: тип берётся у самого соединения.
type Db = ReturnType<typeof import("../queries/connection").getDb>;

export type AgeBucket = "d0_7" | "d8_30" | "d31_60" | "d60plus";

export const AGE_BUCKETS: AgeBucket[] = ["d0_7", "d8_30", "d31_60", "d60plus"];

export interface ShopAging {
  shopId: number;
  shopName: string;
  /*
    Телефон магазина и агент, за которым он числится.

    Без них список должников на телефоне — это список для чтения, а не для
    работы: супервайзер видит «Нодира MCHJ, 3 млн, 47 дней» и лезет искать
    номер в другой экран. Долг закрывается звонком, и номер должен лежать в
    той же строке.

    Агент — держатель магазина, а не тот, кто принял последний заказ: вопрос
    «на чьём маршруте висит» отвечается именно так (то же правило, что в
    analytics.debtReport).
  */
  phone: string | null;
  agentName: string | null;
  /** Долг магазина целиком — то же число, что на его карточке. */
  debt: number;
  /** Разбивка по возрасту неоплаченных заказов. */
  buckets: Record<AgeBucket, number>;
  /** Долг, не привязанный ни к одному заказу: ручные начисления и возвраты. */
  unattributed: number;
  /** Возраст самого старого неоплаченного заказа, дней. null — таких нет. */
  oldestDays: number | null;
}

export interface ReceivablesAging {
  totalDebt: number;
  buckets: Record<AgeBucket, number>;
  unattributed: number;
  debtorCount: number;
  shops: ShopAging[];
}

const emptyBuckets = (): Record<AgeBucket, number> =>
  ({ d0_7: 0, d8_30: 0, d31_60: 0, d60plus: 0 });

interface RawRow {
  shopId: number;
  shopName: string;
  /* Приходят левым соединением, поэтому их может не быть вовсе: у магазина
     бывает не заполнен телефон и не назначен агент. */
  phone?: string | null;
  agentName?: string | null;
  debt: number | string;
  bucket: AgeBucket | null;
  amount: number | string | null;
  oldestDays: number | string | null;
}

/**
 * Собирает строки запроса в отчёт.
 *
 * Вынесено из запроса отдельной функцией, потому что проверять надо именно
 * это: раскладку по корзинам, вычисление неотнесённого остатка и то, что
 * ничего не уходит в минус. Запрос сам по себе проверяется тем, что он
 * повторяет условия из shop-debt слово в слово.
 */
export function rollUp(rows: RawRow[]): ReceivablesAging {
  const byShop = new Map<number, ShopAging>();

  for (const row of rows) {
    let shop = byShop.get(row.shopId);
    if (!shop) {
      shop = {
        shopId: row.shopId,
        shopName: row.shopName,
        phone: row.phone ?? null,
        agentName: row.agentName ?? null,
        debt: Number(row.debt ?? 0),
        buckets: emptyBuckets(),
        unattributed: 0,
        oldestDays: null,
      };
      byShop.set(row.shopId, shop);
    }
    if (row.bucket && row.amount !== null) {
      shop.buckets[row.bucket] += Number(row.amount);
    }
    if (row.oldestDays !== null && row.oldestDays !== undefined) {
      const days = Number(row.oldestDays);
      shop.oldestDays = shop.oldestDays === null ? days : Math.max(shop.oldestDays, days);
    }
  }

  const shops: ShopAging[] = [];
  for (const shop of byShop.values()) {
    const attributed = AGE_BUCKETS.reduce((sum, b) => sum + shop.buckets[b], 0);
    /*
      Остаток может выйти и отрицательным: возврат уменьшает долг магазина
      целиком, а заказ, по которому он оформлен, продолжает висеть в своей
      корзине. Показывать «минус» в строке «не привязано к заказу» правильно —
      это и есть то, на что она указывает: долг закрыт не оплатой заказа.
    */
    shop.unattributed = Number((shop.debt - attributed).toFixed(2));
    shops.push(shop);
  }

  // Кому должны больше — тому и звонить первым.
  shops.sort((a, b) => b.debt - a.debt);

  const buckets = emptyBuckets();
  let totalDebt = 0;
  let unattributed = 0;
  for (const shop of shops) {
    totalDebt += shop.debt;
    unattributed += shop.unattributed;
    for (const b of AGE_BUCKETS) buckets[b] += shop.buckets[b];
  }

  return {
    totalDebt: Number(totalDebt.toFixed(2)),
    buckets,
    unattributed: Number(unattributed.toFixed(2)),
    debtorCount: shops.filter(s => s.debt > 0).length,
    shops,
  };
}

/**
 * Условия «что считается долгом» повторяют services/shop-debt.ts дословно.
 *
 * Два разных определения долга в одной системе — беда хуже отсутствия отчёта:
 * итог на карточке магазина и итог здесь разошлись бы, и верить нельзя было
 * бы ни одному. Поэтому здесь ровно та же ветка: заказ не отменён и не
 * возвращён, оплачивается в долг ЛИБО уже доставлен, и из суммы вычтено
 * оплаченное по нему.
 *
 * Возраст берётся от даты заказа, а не от даты доставки: обязательство
 * возникает, когда товар отгружен в долг, и именно с этого дня считают срок в
 * разговоре с магазином.
 *
 * ── Почему именно COALESCE(first_ordered_at, created_at) ────────────────────
 *
 * У заказа, который возвращали из архива в работу, `created_at` — дата
 * ТЕКУЩЕГО круга: её двигает services/order-reopen, чтобы выручка и комиссия
 * второго круга не падали в месяц первого. Долг так двигать нельзя. Товар
 * уехал в магазин в январе; правка статуса в марте не делает этот долг
 * мартовским, а по возрасту решают, кому звонить и кому перестать отгружать.
 * Полугодовой долг, помолодевший до недельного, — ровно та ошибка, ради
 * которой этот отчёт и написан.
 *
 * `first_ordered_at` заполнен только у таких заказов, у остальных пусто —
 * значит COALESCE у обычного заказа даёт то же самое, что и раньше.
 *
 * Направление выбрано в сторону осторожности сознательно: если два толкования
 * спорят, долг лучше показать более старым, чем более молодым. Первое зовёт
 * разобраться, второе прячет.
 */
export async function receivablesAging(db: Db, tenantId: number): Promise<ReceivablesAging> {
  const rows = await db.execute(sql`
    SELECT
      s.id                          AS shopId,
      s.name                        AS shopName,
      s.phone                       AS phone,
      u.name                        AS agentName,
      CAST(s.debt AS DECIMAL(15,2)) AS debt,
      d.bucket                      AS bucket,
      d.amount                      AS amount,
      d.oldestDays                  AS oldestDays
    FROM shops s
    LEFT JOIN (
      SELECT
        o.shop_id AS shop_id,
        CASE
          WHEN DATEDIFF(CURDATE(), DATE(COALESCE(o.first_ordered_at, o.created_at))) <= 7  THEN 'd0_7'
          WHEN DATEDIFF(CURDATE(), DATE(COALESCE(o.first_ordered_at, o.created_at))) <= 30 THEN 'd8_30'
          WHEN DATEDIFF(CURDATE(), DATE(COALESCE(o.first_ordered_at, o.created_at))) <= 60 THEN 'd31_60'
          ELSE 'd60plus'
        END AS bucket,
        SUM(GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE((
          SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
          WHERE p.order_id = o.id AND p.type = 'payment'
        ), 0))) AS amount,
        MAX(DATEDIFF(CURDATE(), DATE(COALESCE(o.first_ordered_at, o.created_at)))) AS oldestDays
      FROM orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_method = 'debt' OR o.status = 'delivered')
        AND CAST(o.total AS DECIMAL(15,2)) > COALESCE((
          SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
          WHERE p.order_id = o.id AND p.type = 'payment'
        ), 0)
      GROUP BY o.shop_id, bucket
    ) d ON d.shop_id = s.id
    /* Соединение ЛЕВОЕ и с проверкой организации: у магазина может не быть
       агента, и такой должник обязан остаться в списке — он-то и опаснее. */
    LEFT JOIN users u ON u.id = s.agent_id AND u.tenant_id = ${tenantId}
    WHERE s.tenant_id = ${tenantId}
      AND (CAST(s.debt AS DECIMAL(15,2)) > 0 OR d.amount IS NOT NULL)
  `);

  const list = (Array.isArray(rows) ? rows[0] : rows) as unknown as RawRow[];
  return rollUp(Array.isArray(list) ? list : []);
}

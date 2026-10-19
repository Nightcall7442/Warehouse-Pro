/* ═══════════════════════════════════════════════════════════════════════════
   База комиссии в разрезе ТОВАРОВ.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Процент у агента был один на всё, что он продал. Жалоба арендатора: товары
   у него с разной наценкой, и платить с них поровну он не хочет — «поставил
   разные проценты для разных товаров», а система такого не знает.

   Чтобы платить по-разному, продажи агента надо разложить по товарам. Это и
   делает этот файл.

   ── Главное свойство: пустая таблица ничего не меняет ───────────────────────

   Сумма разложенных частей РАВНА той самой salesAmount, которую экран уже
   показывает. Поэтому, пока ни у одного товара нет своей ставки, расчёт
   выдаёт ровно прежнее число — salesAmount × ставка / 100. Это не «почти
   столько же», а буквально то же самое, и на это стоит отдельная проверка.

   Свойство важнее удобства: включение раздела не должно менять зарплату
   людям, которым ничего не меняли.

   ── Формула одна ────────────────────────────────────────────────────────────

   Месячную строку комиссии пишут двое: «Рассчитать» и экран зарплаты. Оба
   зовут commissionFor ниже и больше ничего не умножают сами — иначе в
   ведомости оказывается то, что посчиталось последним.

   ── Как сходится сумма ──────────────────────────────────────────────────────

   Строк заказа и суммы заказа две разные величины: скидка живёт на заказе
   целиком (orders.discount), а не на строках, и вернувшееся считается
   документом возврата, а не правкой строк. Поэтому:

     1. по строкам считается доставленное: доставленное количество × цену;
     2. по строкам возвратов — вернувшееся, тем же правилом периода, что и
        везде (services/revenue-returns.ts): по дате ПРОВЕДЕНИЯ и только по
        заказам, которые сами считаются выручкой;
     3. чистое по товару = доставленное − вернувшееся, не ниже нуля;
     4. всё вместе подгоняется одним множителем под каноническую salesAmount.

   Множитель — это и есть скидка, размазанная по товарам пропорционально
   тому, сколько каждого продано. Иначе не выйдет: скидка дана на заказ, а не
   на позицию, и разложить её точнее нечем.

   А вот возвраты размазывать пропорционально БЫЛО БЫ НЕЛЬЗЯ, и поэтому они
   вычитаются по товарам до множителя. Продал агент на 10 млн товара со
   ставкой 10% и на 10 млн со ставкой 2%, и второй вернулся весь: при
   пропорциональном списании базы вышло бы по 5 млн на каждый и 600 тысяч
   комиссии вместо миллиона. Человек недосчитался бы 40%.
   ═══════════════════════════════════════════════════════════════════════════ */
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  orderItems, orders, returnItems, returns, commissionProductRates,
} from "@db/schema";
import { revenueOrderConditions, revenuePeriodConditions, deliveredQty } from "../lib/order-status";
import { sinceDay, untilDay } from "../lib/date-range";
import { returnsInPeriod, returnedByAgent, returnedOf } from "./revenue-returns";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/** Сколько продано каждого товара, в деньгах. */
export type SalesByProduct = Map<number, number>;

/**
 * Ставки по товарам этой организации: товар → процент.
 *
 * Пустая карта — обычное дело и не ошибка: значит, исключений не заводили и
 * всем товарам считается процент человека.
 */
export async function productRates(db: Db, tenantId: number): Promise<Map<number, number>> {
  const rows = await db.select({
    productId: commissionProductRates.productId,
    rate: commissionProductRates.rate,
  }).from(commissionProductRates)
    .where(eq(commissionProductRates.tenantId, tenantId));

  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.productId), Number(r.rate) || 0);
  return out;
}

/**
 * Разложить продажи агента за период по товарам.
 *
 * `salesAmount` — уже посчитанная каноническая сумма продаж (сумма заказов за
 * вычетом возвратов). Она здесь не пересчитывается, а служит итогом, под
 * который подгоняется разложение: два числа про одни и те же деньги на одном
 * экране расходиться не должны.
 */
export async function salesByProduct(
  db: Db,
  tenantId: number,
  agentId: number,
  fromDay: string,
  toDay: string,
  salesAmount: number,
): Promise<SalesByProduct> {
  // Нечего раскладывать — и запросов не нужно.
  if (salesAmount <= 0) return new Map();

  const soldRows = await db.select({
    productId: orderItems.productId,
    amount: sql<string>`COALESCE(SUM(${deliveredQty()} * ${orderItems.unitPrice}), 0)`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      ...revenueOrderConditions(tenantId),
      eq(orders.agentId, agentId),
      sinceDay(orders.createdAt, fromDay),
      untilDay(orders.createdAt, toDay),
    ))
    .groupBy(orderItems.productId);

  /*
    Вернувшееся — по дате ПРОВЕДЕНИЯ возврата и по агенту ЗАКАЗА.

    Оба правила не наши, а общие (services/revenue-returns.ts), и разойтись с
    ними здесь нельзя: там из salesAmount уже вычтено ровно это, и вычти мы
    другое, множитель ниже прикрыл бы расхождение, размазав его по товарам.
    Агент берётся из заказа, а не из документа: возврат мог оформить оператор,
    а продажу теряет тот, чью продажу вернули.
  */
  const returnedRows = await db.select({
    productId: returnItems.productId,
    amount: sql<string>`COALESCE(SUM(${returnItems.quantity} * ${returnItems.unitPrice}), 0)`,
  })
    .from(returnItems)
    .innerJoin(returns, eq(returns.id, returnItems.returnId))
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .where(and(
      eq(returns.tenantId, tenantId),
      eq(returns.status, "completed"),
      sinceDay(returns.createdAt, fromDay),
      untilDay(returns.createdAt, toDay),
      ...revenueOrderConditions(tenantId),
      eq(orders.agentId, agentId),
    ))
    .groupBy(returnItems.productId);

  const net = new Map<number, number>();
  for (const r of soldRows) net.set(Number(r.productId), Number(r.amount) || 0);
  for (const r of returnedRows) {
    const id = Number(r.productId);
    // Не ниже нуля по каждому товару: возврат может оказаться больше продажи
    // этого товара за период (продали в прошлом месяце, вернули в этом), и
    // отрицательная часть уехала бы вычетом в соседний товар с другой ставкой.
    net.set(id, Math.max(0, (net.get(id) ?? 0) - (Number(r.amount) || 0)));
  }

  const total = [...net.values()].reduce((s, v) => s + v, 0);
  // Строк нет, а продажи есть — так бывает у заказа без позиций. Раскладывать
  // нечем; вернём пусто, и вызывающий посчитает всё по ставке человека.
  if (total <= 0) return new Map();

  const factor = salesAmount / total;
  const out: SalesByProduct = new Map();
  for (const [id, amount] of net) {
    if (amount > 0) out.set(id, amount * factor);
  }
  return out;
}

/**
 * Комиссия по разложенным продажам.
 *
 * `defaultRate` — процент человека: он действует на всё, чему не назначили
 * своей ставки. Разложения нет (нет продаж, нет строк) — считается по нему же
 * от всей суммы, ровно как считалось до появления ставок по товарам.
 */
export function commissionOf(
  byProduct: SalesByProduct,
  rates: Map<number, number>,
  defaultRate: number,
  salesAmount: number,
): number {
  if (byProduct.size === 0) return Number((salesAmount * (defaultRate / 100)).toFixed(2));

  let sum = 0;
  for (const [productId, amount] of byProduct) {
    sum += amount * ((rates.get(productId) ?? defaultRate) / 100);
  }
  return Number(sum.toFixed(2));
}

/**
 * Сколько строк ставок стоит у товаров, участвовавших в продажах агента.
 *
 * Нужно экрану, чтобы объяснить, откуда взялась сумма: «процент 5%, но по
 * трём товарам стоят свои». Без этого человек видит комиссию, не совпадающую
 * с его же процентом от продаж, и считает это ошибкой.
 */
export function overridesUsed(byProduct: SalesByProduct, rates: Map<number, number>): number {
  let n = 0;
  for (const productId of byProduct.keys()) if (rates.has(productId)) n++;
  return n;
}

/** Комиссия человека за период — то, что пишется в строку commissions. */
export interface Commission {
  /** Продажи за вычетом возвратов — база комиссии. */
  salesAmount: number;
  commissionAmount: number;
  /** У скольких проданных товаров своя ставка — для подписи на экране зарплаты. */
  productRateCount: number;
}

/**
 * Комиссия человека за дни fromDay…toDay включительно, по Ташкенту.
 *
 * ОДНА формула на всё, что пишет месячную строку комиссии: и «Рассчитать»
 * (commission-router), и экран зарплаты (services/kpi.ts, calculateSalary).
 *
 * Аудит 19.10.2026, «Две формулы комиссии пишут в одну строку»: «Рассчитать»
 * умножал продажи на одну ставку человека, а экран зарплаты учитывал ставки
 * по товарам. Строка у них общая, и финансист утверждал то, что посчиталось
 * последним: у агента с продажами на 100 000 по ставке 10 % и на 200 000 по
 * 5 % «Рассчитать» писал 15 000, а открытый после него экран зарплаты —
 * 20 000. Оставлены ставки по товарам: их заводит арендатор, а без них этот
 * расчёт даёт ровно продажи × процент человека (см. commissionOf).
 *
 * `rates` — ставки по товарам, если вызывающий уже их прочитал: «Рассчитать»
 * считает строки всей организации разом, и читать одну и ту же таблицу на
 * каждого человека незачем.
 */
export async function commissionFor(
  db: Db,
  tenantId: number,
  agentId: number,
  fromDay: string,
  toDay: string,
  defaultRate: number,
  rates?: Map<number, number>,
): Promise<Commission> {
  const [sold] = await db.select({
    total: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
  }).from(orders).where(and(
    ...revenuePeriodConditions(tenantId, fromDay, toDay),
    eq(orders.agentId, agentId),
  ));

  // Возвраты — общим правилом (services/revenue-returns.ts): по дате
  // проведения и только по заказам, которые сами считаются выручкой.
  const returned = returnedOf(
    returnedByAgent(await returnsInPeriod(db, tenantId, fromDay, toDay)),
    agentId,
  );
  const salesAmount = Math.max(0, Number(sold?.total ?? 0) - returned.amount);

  const byRate = rates ?? await productRates(db, tenantId);
  const byProduct = byRate.size === 0
    // Ставок нет вовсе — раскладывать незачем: два запроса к order_items и
    // return_items на каждого человека за ответ, который и так известен.
    ? new Map<number, number>()
    : await salesByProduct(db, tenantId, agentId, fromDay, toDay, salesAmount);

  return {
    salesAmount,
    commissionAmount: commissionOf(byProduct, byRate, defaultRate, salesAmount),
    productRateCount: overridesUsed(byProduct, byRate),
  };
}

/**
 * Названия товаров для списка ставок.
 *
 * Отдельным запросом, потому что ставок единицы, а товаров у организации
 * тысячи: соединять таблицу ставок с товарами ради десятка строк незачем, а
 * список ставок нужен ровно на одном экране.
 */
export async function rateRows(db: Db, tenantId: number) {
  const rows = await db.select({
    productId: commissionProductRates.productId,
    rate: commissionProductRates.rate,
  }).from(commissionProductRates)
    .where(eq(commissionProductRates.tenantId, tenantId));

  if (rows.length === 0) return [];

  const { products } = await import("@db/schema");
  const names = await db.select({ id: products.id, name: products.name, code: products.code })
    .from(products)
    .where(and(
      eq(products.tenantId, tenantId),
      inArray(products.id, rows.map(r => Number(r.productId))),
    ));

  const byId = new Map(names.map(p => [Number(p.id), p]));
  return rows.map(r => ({
    productId: Number(r.productId),
    rate: Number(r.rate) || 0,
    productName: byId.get(Number(r.productId))?.name ?? "",
    code: byId.get(Number(r.productId))?.code ?? "",
  }));
}

/**
 * «Сроки» — рабочее место: какие партии не успеют продаться и что с ними делать.
 *
 * Правила (темп, FEFO, вердикт, скидка) — в contracts/expiry.ts, одним местом
 * для сервера, экрана и выгрузки. Здесь — только чтение из базы и сборка строк.
 *
 * ── Кто что видит ───────────────────────────────────────────────────────────
 *
 * Закупка и маржа — только директору, как P&L (financeQuery). Строки
 * считаются целиком один раз на организацию (кэш отчётов), а лишнее
 * срезается ПОСЛЕ кэша, по роли того, кто спросил (forViewer): иначе первый
 * открывший экран директор заполнил бы кэш закупкой для всех операторов.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { orderItems, orders, products, stockBatches, warehouses } from "@db/schema";
import {
  EXPIRY_RULES, forecastBatches, salesPace, discountPctFor, discountedPrice, discountMoney,
  type ExpiryVerdict, type DiscountMoney,
} from "@contracts/expiry";
import { revenueOrderConditions } from "../lib/order-status";
import { dayKey } from "../lib/period";
import { returnedQtyByProduct } from "./revenue-returns";
import { activeMarkdowns } from "./markdown";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface ExpiryRow {
  batchId: number;
  productId: number;
  productName: string | null;
  productCode: string | null;
  unit: string | null;
  warehouseId: number;
  warehouseName: string | null;
  /** Партия на основном складе — только оттуда продают. */
  onDefault: boolean;
  batchNumber: string | null;
  /** Годен до, «ГГГГ-ММ-ДД». */
  expiresAt: string;
  daysLeft: number;
  quantity: number;
  /** Прежние три состояния экрана — для открытых до обновления вкладок. */
  state: "expired" | "urgent" | "soon";
  verdict: ExpiryVerdict;
  /** Продаётся в день: доставлено минус возвращено за окно / окно. */
  pacePerDay: number;
  sold: number;
  unsold: number;
  sellOutDays: number | null;
  /** Цена карточки. */
  price: number;
  /** Непроданное к сроку по цене продажи. */
  atRiskSale: number;
  /** Подсказка: скидка и цена после неё. Только «не успеет» и «нет продаж». */
  advice: { pct: number; price: number } | null;
  /** Цена подсказки ниже закупки — уценку на неё ставит директор. */
  needsDirector: boolean;
  /** Уценка товара, если уже поставлена. */
  markdown: { price: number; endsOn: string; batchId: number } | null;
  // ── только директору (forViewer обнуляет остальным) ──
  /** Закупка единицы: партии, а без неё — карточки. */
  costPrice: number | null;
  /** Весь остаток партии по закупке (прежнее поле экрана). */
  value: number | null;
  /** Непроданное к сроку по закупке — столько сгорит. */
  atRiskCost: number | null;
  /** Деньги подсказки: маржа после скидки, ниже ли закупки, что вернётся. */
  adviceMoney: DiscountMoney | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Начало дня ГГГГ-ММ-ДД по местному календарю сервера (как dayKey). */
function startOfDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Продано штук по товарам за окно [from, to) — доставленные, не удалённые. */
async function soldQtyByProduct(db: Db, tenantId: number, from: Date, to: Date, productIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (productIds.length === 0) return out;
  const rows = await db.select({
    productId: orderItems.productId,
    quantity:  sql<string>`SUM(${orderItems.quantity})`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      ...revenueOrderConditions(tenantId),
      sql`${orders.createdAt} >= ${from}`,
      sql`${orders.createdAt} < ${to}`,
      inArray(orderItems.productId, productIds),
    ))
    .groupBy(orderItems.productId);
  for (const r of rows) out.set(Number(r.productId), Number(r.quantity) || 0);
  return out;
}

/**
 * Партии со сроком до горизонта (и просроченные) — с прогнозом, подсказкой
 * и деньгами. Полные строки, с закупкой: срезает forViewer.
 */
export async function expiryPlan(
  db: Db, tenantId: number, opts: { withinDays: number; today?: string },
): Promise<ExpiryRow[]> {
  const today = opts.today ?? dayKey(new Date());
  /*
    Горизонт — по календарю сервера, не через toISOString: колонка DATE, и
    печать через UTC при восточном смещении дала бы вчерашний день (тот же
    случай, что с ключом месяца в api/lib/period.ts).
  */
  const horizon = startOfDay(today);
  horizon.setDate(horizon.getDate() + opts.withinDays);
  const until = dayKey(horizon);

  const batches = await db.select({
    batchId:       stockBatches.id,
    productId:     stockBatches.productId,
    productName:   products.name,
    productCode:   products.code,
    unit:          products.unit,
    unitPrice:     products.unitPrice,
    warehouseId:   stockBatches.warehouseId,
    warehouseName: warehouses.name,
    isDefault:     warehouses.isDefault,
    batchNumber:   stockBatches.batchNumber,
    expiresAt:     sql<string>`DATE_FORMAT(${stockBatches.expiresAt}, '%Y-%m-%d')`,
    quantity:      stockBatches.quantity,
    // Закупка ЭТОЙ партии (карточка — только у партий без своей): столько
    // денег сгорает вместе с товаром.
    costPrice:     sql<string>`COALESCE(${stockBatches.costPrice}, ${products.costPrice})`,
  })
    .from(stockBatches)
    .innerJoin(products, and(eq(stockBatches.productId, products.id), eq(products.tenantId, tenantId)))
    .leftJoin(warehouses, and(eq(stockBatches.warehouseId, warehouses.id), eq(warehouses.tenantId, tenantId)))
    .where(and(
      eq(stockBatches.tenantId, tenantId),
      // Опустевшая партия — не на полке: звать её продавать незачем.
      gt(stockBatches.quantity, "0"),
      sql`${stockBatches.expiresAt} IS NOT NULL`,
      sql`${stockBatches.expiresAt} <= ${until}`,
    ))
    // Порядок списания FEFO (consumeBatches): срок, приход, id. Прогноз
    // делит спрос в этом же порядке.
    .orderBy(stockBatches.expiresAt, stockBatches.receivedAt, stockBatches.id)
    .limit(2000);

  if (batches.length === 0) return [];

  const ids = [...new Set(batches.map(b => Number(b.productId)))];
  /*
    Окно темпа — целые прошедшие дни, без сегодняшнего: [сегодня − 28, сегодня).
    Неполный сегодняшний день занижал бы темп утром и завышал вечером, а кэш
    отчёта живёт по дню.
  */
  const to = startOfDay(today);
  const from = new Date(to);
  from.setDate(from.getDate() - EXPIRY_RULES.PACE_WINDOW_DAYS);
  const [sold, returned, marks] = await Promise.all([
    soldQtyByProduct(db, tenantId, from, to, ids),
    returnedQtyByProduct(db, tenantId, from, to, ids),
    activeMarkdowns(db, tenantId, ids, today),
  ]);
  const pace = new Map(ids.map(id => [id, salesPace(sold.get(id) ?? 0, returned.get(id) ?? 0)]));

  const forecast = forecastBatches(
    batches.map(b => ({
      batchId: Number(b.batchId),
      productId: Number(b.productId),
      // Склад без строки (чужой или удалённый) основным не считается.
      onDefault: Boolean(b.isDefault),
      expiresAt: String(b.expiresAt),
      quantity: Number(b.quantity),
    })),
    id => pace.get(id) ?? 0,
    today,
  );

  return batches.map(b => {
    const f = forecast.get(Number(b.batchId))!;
    const price = Number(b.unitPrice) || 0;
    const cost = Number(b.costPrice) || 0;
    const quantity = Number(b.quantity) || 0;
    const advice = f.verdict === "short" || f.verdict === "no_sales"
      ? { pct: discountPctFor(f.daysLeft), price: 0 }
      : null;
    if (advice) advice.price = discountedPrice(price, advice.pct);
    const money = advice ? discountMoney(advice.price, cost, f.unsold) : null;
    const mark = marks.get(Number(b.productId));
    return {
      batchId: Number(b.batchId),
      productId: Number(b.productId),
      productName: b.productName,
      productCode: b.productCode,
      unit: b.unit,
      warehouseId: Number(b.warehouseId),
      warehouseName: b.warehouseName,
      onDefault: Boolean(b.isDefault),
      batchNumber: b.batchNumber,
      expiresAt: String(b.expiresAt),
      daysLeft: f.daysLeft,
      quantity,
      state: f.daysLeft < 0 ? "expired" : f.daysLeft <= 7 ? "urgent" : "soon",
      verdict: f.verdict,
      pacePerDay: Math.round((pace.get(Number(b.productId)) ?? 0) * 1000) / 1000,
      sold: f.sold,
      unsold: f.unsold,
      sellOutDays: f.sellOutDays,
      price,
      atRiskSale: round2(f.unsold * price),
      advice,
      needsDirector: money?.belowCost ?? false,
      markdown: mark ? { price: Number(mark.price), endsOn: mark.endsOn, batchId: mark.batchId } : null,
      costPrice: cost,
      value: round2(quantity * cost),
      atRiskCost: round2(f.unsold * cost),
      adviceMoney: money,
    } satisfies ExpiryRow;
  });
}

/** Закупку и маржу — только директору; остальным те же строки без них. */
export function seesCost(role: string): boolean {
  return role === "ceo";
}

export function forViewer(rows: readonly ExpiryRow[], role: string): ExpiryRow[] {
  if (seesCost(role)) return [...rows];
  return rows.map(r => ({ ...r, costPrice: null, value: null, atRiskCost: null, adviceMoney: null }));
}

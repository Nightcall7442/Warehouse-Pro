/**
 * Черновик повтора заказа и подсказка «как в прошлый раз».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Телефонный заказ дистрибьютору почти всегда звучит «как в прошлый раз», а
 * оператор набирал 10–30 позиций заново: из карточки заказа повторить было
 * нечем, из карточки магазина нельзя было даже начать новый заказ. Агент в
 * мастере тоже набирал по памяти — сколько магазин брал, нигде не видно.
 *
 * ── Что здесь ───────────────────────────────────────────────────────────────
 *
 * Только ЧЕРНОВИК: товар и количество. Заказ из него идёт той же дорогой
 * order.create со всеми проверками — кредитный лимит, остаток, порог скидки,
 * тариф. Своего создания у повтора нет намеренно: вторая дорога к заказу
 * рано или поздно разошлась бы с первой в одной из проверок.
 *
 * Цены — ТЕКУЩИЕ и той же функцией, что каталог и заказ (resolvePrices: списки
 * магазина, ступень по количеству строки, правило «к карточке»). Старая цена
 * из прошлого заказа была бы обещанием, которое сервер при создании не
 * сдержит. Остаток — по основному складу: продают только с него (решение
 * владельца), и сумма по всем складам обещала бы то, чего заказ не даст.
 *
 * Товар, снятый с продажи, в черновик не попадает, а называется отдельным
 * списком: молча выкинутая строка — это магазин, которому не довезли и не
 * сказали почему.
 *
 * ── Чьё ─────────────────────────────────────────────────────────────────────
 *
 * Правило то же, что у карточки заказа (viewerScope): офис видит любой заказ
 * организации, агент — только оформленные им. Отсюда и «последний заказ
 * магазина» у агента — последний СВОЙ: чужой состав ему не показывают в
 * карточке, не покажет и повтор. У двух агентов на одной точке обычно разные
 * линейки товара, и «как в прошлый раз» агента напитков — его напитки, а не
 * чужое печенье.
 */
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { orders, orderItems, products, shops, warehouses, warehouseStock } from "@db/schema";
import { resolvePrices } from "./price-resolver";
import { orderAccessError, viewerScope, type Db, type Tx } from "./order-shared";

/** Кто спрашивает — роль решает, чьи заказы видны. */
export type RepeatViewer = { userId: number; userRole: string };

/**
 * Заказы, которые считаются «что магазин брал».
 *
 * Отменённый и возвращённый целиком магазин не брал: отменяют ошибки и дубли,
 * возврат — это товар, который вернулся на склад. Повторять их состав значило
 * бы повторять ошибку.
 */
const NOT_TAKEN = ["cancelled", "returned"] as const;

/** Сколько последних заказов усредняет подсказка. */
export const LAST_TIME_ORDERS = 3;

/**
 * Единицы, которые не дробятся.
 *
 * Среднее 10 и 11 штук — 10,5, а заказа на десять с половиной бутылок не
 * бывает: сервер такое количество примет (колонка десятичная), и на складе
 * начнутся полбутылки. Штуки, коробки, пачки и блоки округляются до целого,
 * вес, объём и длина — до сотых, как хранит база.
 */
const WHOLE_UNITS = new Set(["pcs", "box", "pack", "block"]);

export function roundLastTime(avg: number, unit: string): string {
  if (WHOLE_UNITS.has(unit)) return String(Math.max(1, Math.round(avg)));
  return String(Math.max(0.01, Math.round(avg * 100) / 100));
}

export interface RepeatLine {
  productId: number;
  name: string;
  code: string;
  unit: string;
  quantity: string;
  /** Цена строки при ЭТОМ количестве — как посчитает заказ. */
  unitPrice: string;
  /** Свободно на основном складе. */
  available: string;
}

export interface RepeatDraft {
  shop: { id: number; name: string };
  /** Какой заказ повторяем; null — у магазина (для этого человека) заказов ещё не было. */
  source: { id: number; orderNumber: string; createdAt: Date } | null;
  lines: RepeatLine[];
  /** Товары прошлого заказа, которых больше не продают, — по именам. */
  skipped: Array<{ productId: number; name: string; quantity: string }>;
  /** «В прошлый раз»: среднее по последним LAST_TIME_ORDERS заказам магазина. */
  lastTime: Array<{ productId: number; quantity: string; orders: number }>;
}

/** Условия «заказ этого магазина, который магазин взял, и виден спрашивающему». */
function takenOrdersOf(tenantId: number, shopId: number, viewer: RepeatViewer) {
  return and(
    eq(orders.tenantId, tenantId),
    eq(orders.shopId, shopId),
    isNull(orders.deletedAt),
    notInArray(orders.status, [...NOT_TAKEN]),
    ...viewerScope(viewer),
  );
}

export async function repeatDraft(
  db: Db, tenantId: number, input: { orderId?: number; shopId?: number }, viewer: RepeatViewer,
): Promise<RepeatDraft> {
  // ── Какой заказ повторяем ──
  let source: { id: number; orderNumber: string; createdAt: Date; shopId: number } | null = null;
  let shopId: number;

  if (input.orderId != null) {
    const [row] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt, shopId: orders.shopId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...viewerScope(viewer)))
      .limit(1);
    // Чужой заказ — «оформил другой сотрудник», несуществующий или другой
    // организации — «не найден»: тот же ответ, что у карточки заказа.
    if (!row) throw await orderAccessError(db as unknown as Tx, tenantId, input.orderId, "Повторить");
    source = row;
    shopId = row.shopId;
  } else if (input.shopId != null) {
    shopId = input.shopId;
    const [row] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt, shopId: orders.shopId })
      .from(orders)
      .where(takenOrdersOf(tenantId, shopId, viewer))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(1);
    source = row ?? null;
  } else {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Укажите заказ или магазин" });
  }

  const [shop] = await db.select({ id: shops.id, name: shops.name, status: shops.status }).from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
  if (!shop) throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден" });
  /*
    Точке в архиве заказ не оформляют: выбор магазина в окне и в мастере
    показывает только действующие, кнопок заказа в карточке архивного
    магазина нет. А «Повторить» в карточке старого заказа открывал окно с
    этой точкой, уже выбранной, — и order.create, который статус магазина не
    проверяет, оформлял ей заказ в обход всех трёх. Отказ называет выход.
  */
  if (shop.status !== "active") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Магазин «${shop.name}» в архиве. Верните его в работу, чтобы оформить заказ.`,
    });
  }

  // ── Состав повторяемого заказа ──
  const rows = source
    ? await db.select({
        productId: orderItems.productId, quantity: orderItems.quantity,
        name: products.name, code: products.code, unit: products.unit,
        status: products.status, cardPrice: products.unitPrice,
      })
        .from(orderItems)
        .innerJoin(products, and(eq(products.id, orderItems.productId), eq(products.tenantId, tenantId)))
        .where(eq(orderItems.orderId, source.id))
        .orderBy(orderItems.id)
    : [];
  const alive = rows.filter(r => r.status === "active");
  const skipped = rows.filter(r => r.status !== "active")
    .map(r => ({ productId: Number(r.productId), name: r.name, quantity: String(r.quantity) }));

  // Цена строки — при её количестве, тем же resolvePrices, что и order.create
  // без выбранного списка: списки магазина, иначе карточка.
  const priced = await resolvePrices(db, tenantId, { shopId, priceListId: null },
    alive.map(r => ({ productId: Number(r.productId), quantity: r.quantity })),
    new Map(alive.map(r => [Number(r.productId), String(r.cardPrice)])));

  // Остаток — основного склада; без него продавать неоткуда, и честный ответ — ноль.
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  const stock = new Map<number, string>();
  if (wh && alive.length > 0) {
    const s = await db.select({ productId: warehouseStock.productId, available: warehouseStock.available })
      .from(warehouseStock)
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, wh.id),
        inArray(warehouseStock.productId, alive.map(r => Number(r.productId))),
      ));
    for (const r of s) stock.set(Number(r.productId), String(r.available));
  }

  const lines: RepeatLine[] = alive.map(r => ({
    productId: Number(r.productId),
    name: r.name,
    code: r.code,
    unit: r.unit,
    quantity: String(r.quantity),
    unitPrice: priced.get(Number(r.productId))?.price ?? String(r.cardPrice),
    available: stock.get(Number(r.productId)) ?? "0",
  }));

  /*
    «В прошлый раз» — одним запросом к order_items.

    Три последних заказа магазина — производной таблицей с LIMIT, строки —
    соединением с ней. Среднее — по тем из трёх, где товар был: магазин,
    который брал 12 бутылок раз в две поставки, берёт по 12, а не по 4.
    Снятые с продажи в подсказку не идут — в каталоге их нет, показать не
    на чем, а «как в прошлый раз» положило бы их в корзину мимо каталога.
  */
  const lastOrders = db.select({ id: orders.id }).from(orders)
    .where(takenOrdersOf(tenantId, shopId, viewer))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(LAST_TIME_ORDERS)
    .as("last_orders");
  const hints = await db.select({
    productId: orderItems.productId,
    unit: products.unit,
    avg: sql<string>`AVG(${orderItems.quantity})`,
    times: sql<number>`COUNT(*)`,
  })
    .from(orderItems)
    .innerJoin(lastOrders, eq(lastOrders.id, orderItems.orderId))
    .innerJoin(products, and(eq(products.id, orderItems.productId), eq(products.tenantId, tenantId), eq(products.status, "active")))
    .groupBy(orderItems.productId, products.unit);

  return {
    shop: { id: Number(shop.id), name: shop.name },
    source: source ? { id: Number(source.id), orderNumber: source.orderNumber, createdAt: source.createdAt } : null,
    lines,
    skipped,
    lastTime: hints.map(h => ({
      productId: Number(h.productId),
      quantity: roundLastTime(Number(h.avg), h.unit),
      orders: Number(h.times),
    })),
  };
}

import { sql } from "drizzle-orm";
import { stockMovements } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Movements are normally written inside the transaction that moved the stock,
 * so the two commit together. A few callers (the spreadsheet import) run
 * statement-by-statement without one and pass the connection directly.
 */
type LedgerWriter = Tx | Db;

/**
 * Why a movement is being recorded. Keeping these as one list means the
 * history reads consistently no matter which part of the system moved the
 * goods, and makes it obvious when a new flow needs a new entry here rather
 * than a free-text note.
 */
export type StockMovementReason =
  | "arrival"            // goods received from a supplier
  | "order_delivery"     // goods handed to a shop
  | "order_return"       // goods came back from a shop
  | "order_edit"         // a delivered order's lines were corrected after the fact
  | "return_completed"   // a formal return was approved and restocked
  | "transfer_out"       // left this warehouse for another
  | "transfer_in"        // arrived here from another warehouse
  | "manual_adjustment"  // a person corrected the count
  | "import"             // set by a spreadsheet import
  | "onec_sync";         // set by the 1C integration

/**
 * Records one movement of physical goods.
 *
 * Only changes to `current_stock` belong here: reserving stock for an open
 * order shuffles `reserved` and `available` but moves nothing, so it is not a
 * movement. That distinction is what makes the ledger meaningful — the sum of
 * a product's movements is what has actually entered and left the warehouse.
 *
 * `quantity` is always positive; direction lives in `type`. Callers pass the
 * magnitude of the change they are about to make (or just made) to
 * `current_stock`, in the same transaction, so the two can never disagree.
 */
export async function recordStockMovement(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    productId: number;
    /** "in" = current_stock rose, "out" = it fell, "adjustment" = set outright. */
    type: "in" | "out" | "adjustment";
    quantity: number | string;
    reason: StockMovementReason;
    /** The order, arrival, transfer or return this movement came from. */
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const magnitude = Math.abs(Number(entry.quantity));
  // A zero-quantity movement records nothing and only clutters the history.
  if (!Number.isFinite(magnitude) || magnitude === 0) return;

  await tx.insert(stockMovements).values({
    tenantId: entry.tenantId,
    warehouseId: entry.warehouseId,
    productId: entry.productId,
    type: entry.type,
    quantity: magnitude.toFixed(2),
    referenceType: entry.reason,
    referenceId: entry.referenceId ?? null,
    notes: entry.notes ?? null,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   ДВЕРЬ ДЛЯ ОСТАТКА

   ── Что было ────────────────────────────────────────────────────────────────

   warehouse_stock меняли девятнадцать мест сырым SQL в двенадцати файлах.
   Единой двери не было; StockService.reserve/release/deduct — три операции,
   ради которых служба и писалась, — не вызывал никто. Каждый путь считал
   остаток сам, и каждый по-своему.

   ── Что оказалось на самом деле ─────────────────────────────────────────────

   Выглядело это как шесть разных операций с шестью разными формулами: где
   LEAST(q, reserved), где GREATEST(0, reserved − q), где разница
   GREATEST(0, reserved + Δ) − reserved. Но все они сохраняют ОДНО И ТО ЖЕ:

       available = current_stock − reserved

   То есть available хранится ИЗБЫТОЧНО, а вся гимнастика с ограничителями
   существовала лишь затем, чтобы поддерживать эту избыточность вручную — в
   девятнадцати местах, каждое из которых могло ошибиться по-своему. Так и
   появлялись беды вида «резерв упёрся в ноль, а свободное прибавило всю
   величину»: это ровно рассинхронизация трёх чисел, из которых независимы
   только два.

   Поэтому примитив здесь ОДИН. Меняются два числа — сколько лежит на складе и
   сколько отложено; available не поддерживается, а выводится на каждой записи.
   Ошибиться в нём больше негде, а строка, уже разъехавшаяся в базе, следующей
   же записью приходит в согласие.

   ── Порядок присвоений ──────────────────────────────────────────────────────

   MySQL вычисляет SET слева направо, и правые части видят УЖЕ обновлённые
   колонки. Раньше это было ловушкой: available стоял ПЕРВЫМ и обязан был
   успеть прочитать старый резерв — перестановка двух строк тихо ломала деньги.
   Теперь наоборот и очевидно: available стоит ПОСЛЕДНИМ и читает новые
   current_stock и reserved, иначе он их попросту не выведет.

   ── Почему движение и остаток пишутся вместе ────────────────────────────────

   Раньше это были два вызова подряд, и второй можно было забыть: журнал
   движений тогда расходится с остатком, а разошедшийся журнал не проверяет уже
   ничего. Здесь их не разнять.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Строка «товар — количество». */
export interface StockItem {
  productId: number;
  quantity: number | string;
}

/**
 * Привести список к виду, в котором его можно отдать одним запросом.
 *
 * Товары СКЛАДЫВАЮТСЯ: запрос строится через CASE, а `CASE WHEN product_id = 7
 * THEN 2 WHEN product_id = 7 THEN 3 END` берёт ПЕРВУЮ совпавшую ветку — тройка
 * потерялась бы молча. `product_id IN (7, 7)` тоже схлопывается.
 *
 * Отрицательное количество — отказ, а не «сделаем наоборот». Направление задаёт
 * имя вызываемой функции; знак в количестве — ошибка вызывающего, и о ней надо
 * сказать вслух. Раньше здесь стоял Math.abs: передай кто-нибудь знаковую
 * дельту, и операция молча выполнилась бы В ОБРАТНУЮ СТОРОНУ.
 */
function normalize(items: StockItem[], op: string): Array<{ productId: number; quantity: number }> {
  const merged = new Map<number, number>();
  for (const item of items) {
    const q = Number(item.quantity);
    if (!Number.isFinite(q)) {
      throw new Error(`${op}: количество товара ${item.productId} не число (${String(item.quantity)})`);
    }
    if (q < 0) {
      throw new Error(`${op}: отрицательное количество ${q} у товара ${item.productId} — направление задаёт вызываемая функция, а не знак`);
    }
    if (q === 0) continue;
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + q);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Что меняется на ЕДИНИЦУ товара. */
export interface StockShift {
  /** current_stock: +1 пришло, −1 уехало, 0 не двигалось. */
  onHand: number;
  /** reserved: +1 отложили, −1 вернули из резерва, 0 не трогали. */
  held: number;
}

/**
 * Единственное место, где меняется остаток.
 *
 * Ограничитель остался ровно один — на резерве: снять больше, чем там лежит,
 * нельзя, а отрицательный резерв в боевой базе встречается. available от него
 * и считается, поэтому подстраивается сам.
 */
async function shiftStock(
  tx: LedgerWriter,
  tenantId: number,
  warehouseId: number,
  rows: Array<{ productId: number; onHand: number; held: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  if (rows.every(r => r.onHand === 0 && r.held === 0)) return;

  const ids = sql.join(rows.map(r => sql`${r.productId}`), sql`, `);
  const onHand = sql.join(rows.map(r => sql`WHEN product_id = ${r.productId} THEN ${r.onHand}`), sql` `);
  const held = sql.join(rows.map(r => sql`WHEN product_id = ${r.productId} THEN ${r.held}`), sql` `);

  await tx.execute(sql`
    UPDATE warehouse_stock
    SET current_stock = current_stock + CASE ${onHand} ELSE 0 END,
        reserved      = GREATEST(0, reserved + CASE ${held} ELSE 0 END),
        available     = current_stock - reserved
    WHERE product_id IN (${ids})
      AND tenant_id = ${tenantId}
      AND warehouse_id = ${warehouseId}
  `);
}

/** Список товаров с одинаковым сдвигом на единицу. */
const uniform = (items: Array<{ productId: number; quantity: number }>, shift: StockShift) =>
  items.map(i => ({ productId: i.productId, onHand: shift.onHand * i.quantity, held: shift.held * i.quantity }));

/**
 * Товар пришёл на склад: приход, возврат от магазина, оприходование.
 *
 * Резерв не трогается — отложенное под чужой заказ остаётся отложенным.
 *
 * Строки остатка может ещё не быть, и она заводится. Это не мелочь: в
 * возвратах стоял голый UPDATE, и на товаре, которого не было на этом складе,
 * он не совпадал ни с одной строкой. Возврат принимали, с магазина списывали, а
 * на склад он не попадал — молча. Одним запросом, а не «поискать и вставить»:
 * INSERT .. ON DUPLICATE KEY UPDATE атомарен на уровне строки, и два
 * одновременных прихода складываются, а не перетирают друг друга.
 */
export async function receiveStock(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    productId: number;
    quantity: number | string;
    reason: StockMovementReason;
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const [item] = normalize([{ productId: entry.productId, quantity: entry.quantity }], "приход");
  if (!item) return;

  await tx.execute(sql`
    INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
    VALUES (${entry.tenantId}, ${entry.warehouseId}, ${item.productId}, ${item.quantity}, 0, ${item.quantity})
    ON DUPLICATE KEY UPDATE
      current_stock = current_stock + ${item.quantity},
      available     = current_stock - reserved
  `);

  await recordStockMovement(tx, {
    tenantId: entry.tenantId,
    warehouseId: entry.warehouseId,
    productId: item.productId,
    type: "in",
    quantity: item.quantity,
    reason: entry.reason,
    referenceId: entry.referenceId ?? null,
    notes: entry.notes ?? null,
  });
}

/**
 * Отложить товар под заказ.
 *
 * Товар никуда не уехал, поэтому current_stock не меняется и в журнал движений
 * это НЕ пишется: сумма движений обязана оставаться тем, что физически вошло и
 * вышло со склада.
 *
 * Проверку «хватает ли свободного» дверь не делает намеренно: у вызывающих она
 * разная — восстановление заказа отказывает с именем товара и числами,
 * оформление отказывает раньше, на сборке корзины. И если решение принимается
 * по прочитанному значению, читать его надо под блокировкой: дверь берёт только
 * те замки, что берёт сам UPDATE.
 */
export async function reserveStock(
  tx: LedgerWriter,
  entry: { tenantId: number; warehouseId: number; items: StockItem[] },
): Promise<void> {
  const items = normalize(entry.items, "резерв");
  await shiftStock(tx, entry.tenantId, entry.warehouseId, uniform(items, { onHand: 0, held: 1 }));
}

/**
 * Вернуть товар из резерва в свободный остаток.
 *
 * Снять можно ровно столько, сколько там лежало: ограничитель не даёт резерву
 * уйти ниже нуля, а available выводится от нового резерва — то есть в свободное
 * вернётся ровно снятое, ни единицей больше.
 */
export async function releaseStock(
  tx: LedgerWriter,
  entry: { tenantId: number; warehouseId: number; items: StockItem[] },
): Promise<void> {
  const items = normalize(entry.items, "снятие резерва");
  await shiftStock(tx, entry.tenantId, entry.warehouseId, uniform(items, { onHand: 0, held: -1 }));
}

/** Строка отгрузки: сколько держал заказ и сколько уехало на самом деле. */
export interface ShipItem {
  productId: number;
  /** Сколько держал заказ. С резерва снимается это. */
  orderedQuantity: number | string;
  /** Сколько уехало со склада. На это падает остаток. */
  deliveredQuantity: number | string;
}

/**
 * Товар уехал к магазину.
 *
 * Две величины, и при частичной доставке они РАЗНЫЕ: с резерва снимается всё,
 * что заказ держал, а со склада уходит только увезённое. Невывезенная часть
 * возвращается в свободный остаток — и это выходит само собой, потому что
 * available считается от новых current_stock и reserved. Прежде это писали
 * выражением `available − увезено + LEAST(отложено, reserved)`, и каждое место
 * писало его заново.
 *
 * Движение пишется на увезённое: в журнал попадает то, что физически покинуло
 * склад, а не то, что было обещано.
 */
export async function shipStock(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    items: ShipItem[];
    reason: StockMovementReason;
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const ordered = normalize(entry.items.map(i => ({ productId: i.productId, quantity: i.orderedQuantity })), "отгрузка (отложено)");
  const delivered = normalize(entry.items.map(i => ({ productId: i.productId, quantity: i.deliveredQuantity })), "отгрузка (увезено)");

  const byProduct = new Map<number, { onHand: number; held: number }>();
  for (const d of delivered) byProduct.set(d.productId, { onHand: -d.quantity, held: 0 });
  for (const o of ordered) {
    const cur = byProduct.get(o.productId) ?? { onHand: 0, held: 0 };
    byProduct.set(o.productId, { onHand: cur.onHand, held: -o.quantity });
  }

  await shiftStock(
    tx, entry.tenantId, entry.warehouseId,
    [...byProduct].map(([productId, v]) => ({ productId, ...v })),
  );

  for (const d of delivered) {
    await recordStockMovement(tx, {
      tenantId: entry.tenantId,
      warehouseId: entry.warehouseId,
      productId: d.productId,
      type: "out",
      quantity: d.quantity,
      reason: entry.reason,
      referenceId: entry.referenceId ?? null,
      notes: entry.notes ?? null,
    });
  }
}

/**
 * Применить последствие смены статуса заказа.
 *
 * Статус решает, где лежит товар: «в работе» держит его в резерве, «доставлен»
 * убирает со склада, «отменён» не держит ничего. Переход применяет РАЗНИЦУ двух
 * последствий, поэтому работает в любую сторону, включая откат назад.
 *
 * Вызывающий обязан заранее проверить, что ни одна колонка не уйдёт в минус, и
 * отказать с именем товара: тихо подрезать до нуля значило бы потерять единицы
 * без следа. Ограничитель на резерве здесь всё же есть — он общий для двери и
 * лечит уже разъехавшуюся строку, а не прикрывает непроверенный вход.
 */
export async function applyStockEffect(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    items: StockItem[];
    shift: StockShift;
    reason: StockMovementReason;
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const items = normalize(entry.items, "смена статуса");
  await shiftStock(tx, entry.tenantId, entry.warehouseId, uniform(items, entry.shift));

  // Движение — только когда товар правда двигался. Статус, который лишь
  // откладывает или освобождает, перекладывает два числа и в журнал не идёт.
  if (entry.shift.onHand === 0) return;
  for (const item of items) {
    await recordStockMovement(tx, {
      tenantId: entry.tenantId,
      warehouseId: entry.warehouseId,
      productId: item.productId,
      type: entry.shift.onHand > 0 ? "in" : "out",
      quantity: item.quantity,
      reason: entry.reason,
      referenceId: entry.referenceId ?? null,
      notes: entry.notes ?? null,
    });
  }
}

/**
 * Назначить остаток числом — импорт из файла и обмен, где приходит не движение,
 * а итог.
 *
 * Резерв обрезается по новому остатку: зарезервировать больше, чем лежит на
 * полке, нельзя. available, как и везде, выводится.
 */
export async function setStock(
  tx: LedgerWriter,
  entry: { tenantId: number; warehouseId: number; productId: number; quantity: number | string },
): Promise<void> {
  const q = Number(entry.quantity);
  if (!Number.isFinite(q) || q < 0) {
    throw new Error(`установка остатка: негодное количество ${String(entry.quantity)} у товара ${entry.productId}`);
  }
  await tx.execute(sql`
    UPDATE warehouse_stock
    SET current_stock = ${q},
        reserved      = LEAST(reserved, ${q}),
        available     = current_stock - reserved
    WHERE product_id = ${entry.productId}
      AND tenant_id = ${entry.tenantId}
      AND warehouse_id = ${entry.warehouseId}
  `);
}

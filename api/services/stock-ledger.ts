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

   warehouse_stock меняют девятнадцать мест сырым SQL в двенадцати файлах.
   Единой двери нет; StockService.reserve/release/deduct — три операции, ради
   которых служба и писалась, — не вызывает НИКТО. Каждый путь считает остаток
   сам, и каждый по-своему: где-то available правится, где-то нет, где-то
   строку остатка сначала ищут и вставляют, если не нашли, а где-то нет — и
   тогда движение товара пропадает молча.

   Отсюда же невозможность учёта по партиям: пристроить его к девятнадцати
   разным записям значит завести второй источник правды о деньгах.

   ── Почему по одной операции ────────────────────────────────────────────────

   Дверь строится не разом. Каждая операция появляется здесь ВМЕСТЕ со своим
   вызовом — иначе это будет ещё один StockService: пять функций, ноль
   вызовов. Ratchet в api/__tests__/arrival-batch-expiry.test.ts держит число
   оставшихся сырых UPDATE и опускается по мере переноса.

   ── Почему движение и остаток пишутся вместе ───────────────────────────────

   Раньше это были два вызова подряд, и второй можно было забыть: журнал
   движений тогда расходится с остатком, а разошедшийся журнал не проверяет
   уже ничего. Здесь их не разнять.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Товар пришёл на склад.
 *
 * Приход, возврат от магазина, оприходование — всё, что УВЕЛИЧИВАЕТ остаток на
 * складе. Резерв не трогается: отложенное под чужой заказ остаётся отложенным.
 *
 * Строки остатка может ещё не быть — тогда она заводится. Это не мелочь: в
 * возвратах стоял голый UPDATE, и на товаре, которого не было на этом складе,
 * он не совпадал ни с одной строкой. Возврат принимали, товар списывали с
 * магазина, а на склад он не попадал — молча.
 *
 * Одним запросом, а не «поискать и вставить»: INSERT .. ON DUPLICATE KEY
 * UPDATE атомарен на уровне строки, и два одновременных прихода одного товара
 * складываются, а не перетирают друг друга.
 */
export async function receiveStock(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    productId: number;
    /** Сколько пришло. Положительное; ноль ничего не делает. */
    quantity: number | string;
    reason: StockMovementReason;
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const qty = Math.abs(Number(entry.quantity));
  if (!Number.isFinite(qty) || qty === 0) return;

  await tx.execute(sql`
    INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
    VALUES (${entry.tenantId}, ${entry.warehouseId}, ${entry.productId}, ${qty}, 0, ${qty})
    ON DUPLICATE KEY UPDATE
      current_stock = current_stock + ${qty},
      available     = available + ${qty}
  `);

  await recordStockMovement(tx, {
    tenantId: entry.tenantId,
    warehouseId: entry.warehouseId,
    productId: entry.productId,
    type: "in",
    quantity: qty,
    reason: entry.reason,
    referenceId: entry.referenceId ?? null,
    notes: entry.notes ?? null,
  });
}

/** Строка «товар — количество» для резерва и снятия резерва. */
export interface StockItem {
  productId: number;
  quantity: number | string;
}

/**
 * Привести список к виду, в котором его можно отдать в один запрос.
 *
 * ── Почему товары СКЛАДЫВАЮТСЯ, а не идут как есть ──────────────────────────
 *
 * Запрос строится через CASE, и `CASE WHEN product_id = 7 THEN 2 WHEN
 * product_id = 7 THEN 3 END` берёт ПЕРВУЮ совпавшую ветку: тройка теряется
 * молча. `product_id IN (7, 7)` тоже схлопывается. То есть один товар,
 * попавший в список дважды, зарезервировался бы не полностью — без ошибки и
 * без следа. Прежние места писали такой же CASE и имели ту же дыру.
 *
 * ── Почему отрицательное — отказ, а не «сделаем наоборот» ───────────────────
 *
 * Сначала здесь стоял Math.abs. Это худшее из возможных: передай кто-нибудь
 * знаковую дельту (а именно так устроен applyStockDelta в order.ts),
 * reserveStock молча выполнил бы операцию В ОБРАТНУЮ СТОРОНУ. Уменьшение
 * позиции на три превратилось бы в резерв ещё трёх, ошибка в шесть единиц, и
 * ни одного признака сбоя. Направление задаёт имя функции; знак в количестве —
 * это ошибка вызывающего, и о ней надо сказать вслух.
 *
 * NaN — тоже отказ. Раньше он уходил в запрос и ронял его; тихо отбрасывать
 * такую строку значит менять шумный сбой на пропавший резерв.
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

/**
 * Общая форма для резерва и снятия: сдвиг резерва на знаковую величину.
 *
 * ── Ограничитель применяется к ОБЕИМ колонкам ───────────────────────────────
 *
 * Считается ФАКТИЧЕСКИ применённое изменение: `GREATEST(0, reserved + Δ) −
 * reserved`. В обычном случае это ровно Δ, а при упоре в ноль — только то, что
 * действительно лежало в резерве. available двигается на ту же величину, и
 * тождество available + reserved = current_stock сохраняется.
 *
 * Наивная запись `reserved = GREATEST(0, reserved + Δ), available -= Δ`
 * разъезжается ровно тогда, когда ограничитель срабатывает: резерв упирается в
 * ноль, а свободное прибавляет всю величину. Остаток становится больше
 * физического, и система разрешает продать то, чего нет. Без всякой ошибки.
 *
 * ── ПОРЯДОК ПРИСВОЕНИЙ НЕСУЩИЙ ──────────────────────────────────────────────
 *
 * MySQL вычисляет SET слева направо и в правых частях видит УЖЕ обновлённые
 * колонки. available обязан считаться первым, пока reserved хранит старое
 * значение; поменяй местами — разница посчитается от самой себя и выйдет
 * нулём.
 *
 * Форма взята из order.ts:365 не случайно: там она и была выведена, там же
 * разобрано, почему иначе нельзя. Остальные шесть мест писали её частные
 * случаи (available += LEAST(q, reserved) — это она же при Δ < 0), и теперь
 * все семь считают одним выражением.
 */
async function shiftReserved(
  tx: LedgerWriter,
  tenantId: number,
  warehouseId: number,
  items: Array<{ productId: number; quantity: number }>,
  sign: 1 | -1,
): Promise<void> {
  if (items.length === 0) return;

  const delta = sql.join(
    items.map(i => sql`WHEN product_id = ${i.productId} THEN ${sign * i.quantity}`),
    sql` `,
  );
  const ids = sql.join(items.map(i => sql`${i.productId}`), sql`, `);

  await tx.execute(sql`
    UPDATE warehouse_stock
    SET available = available - (GREATEST(0, reserved + CASE ${delta} ELSE 0 END) - reserved),
        reserved  = GREATEST(0, reserved + CASE ${delta} ELSE 0 END)
    WHERE product_id IN (${ids})
      AND tenant_id = ${tenantId}
      AND warehouse_id = ${warehouseId}
  `);
}

/**
 * Отложить товар под заказ.
 *
 * Резерв растёт, свободное падает; сам остаток на складе не меняется — товар
 * никуда не уехал. Поэтому в журнал движений это НЕ пишется: сумма движений
 * должна оставаться тем, что физически вошло и вышло со склада.
 *
 * Проверку «хватает ли свободного» дверь не делает намеренно: у вызывающих она
 * разная. Восстановление заказа отказывает с именем товара и числами,
 * оформление отказывает раньше, на сборке корзины. Спрятать её сюда значит
 * заменить осмысленный отказ безымянным. Вызывающий обязан проверить сам — и,
 * если решение принимается по прочитанному значению, прочитать его под
 * блокировкой: дверь берёт только те замки, что берёт сам UPDATE.
 */
export async function reserveStock(
  tx: LedgerWriter,
  entry: { tenantId: number; warehouseId: number; items: StockItem[] },
): Promise<void> {
  await shiftReserved(tx, entry.tenantId, entry.warehouseId, normalize(entry.items, "резерв"), 1);
}

/**
 * Вернуть товар из резерва в свободный остаток.
 *
 * Вернуть можно ровно столько, сколько там лежало: при Δ < 0 общая форма даёт
 * `available += min(количество, reserved)`. Прибавляя полное количество при
 * просевшем резерве, мы дописывали бы в свободный остаток единицы, которых на
 * складе нет.
 */
export async function releaseStock(
  tx: LedgerWriter,
  entry: { tenantId: number; warehouseId: number; items: StockItem[] },
): Promise<void> {
  await shiftReserved(tx, entry.tenantId, entry.warehouseId, normalize(entry.items, "снятие резерва"), -1);
}

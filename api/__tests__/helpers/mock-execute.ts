// Поддельный execute() для складских запросов в тестах.

import { deriveShopDebt, isShopDebtRecalc, type DebtTables } from "./shop-debt-recalc";

interface StockRow {
  productId: number;
  tenantId: number;
  currentStock?: string;
  reserved: string;
  available: string;
}

interface ShopRow {
  id: number;
  tenantId: number;
  debt: string;
}

/**
 * Pass `debt` when the code under test can move what a shop owes. Without it
 * the recalculation statement is silently swallowed and the balance never
 * changes — which reads as a product bug rather than a gap in the harness.
 */
interface ExecuteMockOptions {
  debt?: { shops: ShopRow[]; tables: () => DebtTables };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ТРИ ФОРМЫ, И БОЛЬШЕ НИКАКИХ

   ── Что здесь было ──────────────────────────────────────────────────────────

   Девятнадцать мест меняли warehouse_stock сырым SQL, каждое своей формулой, и
   подделка угадывала операцию по обрывкам текста: «есть ли reserved = reserved
   +», «есть ли current_stock = CASE», «сколько раз встретилось LEAST». Четыре
   опознавателя, три из которых выводили ЗНАК операции из текста запроса. Каждый
   новый путь в продакшене требовал нового опознавателя, а промах опознавателя
   не ронял ни один тест — он делал их зелёными на чём угодно.

   ── Что стало ───────────────────────────────────────────────────────────────

   Остаток меняет одна дверь (api/services/stock-ledger.ts), и форм у неё ровно
   три: пакетный сдвиг, приход строкой и установка числом. Угадывать больше
   нечего — формы сверяются целиком. Незнакомая запись в warehouse_stock роняет
   стенд: молча проглотить складскую правку значит подтвердить проверку, которая
   ничего не проверила.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Пакетный сдвиг: shiftStock. Два числа задаются, третье выводится. */
const DOOR_SHIFT = /SET current_stock = current_stock \+ CASE ELSE 0 END, reserved = GREATEST\(0, reserved \+ CASE ELSE 0 END\), available = current_stock - reserved/;

/** Установка абсолютным числом: setStock. */
const DOOR_SET = /SET current_stock = , reserved = LEAST\(reserved, \), available = current_stock - reserved/;

/** Приход: заводит строку, если её нет. */
const DOOR_RECEIVE = /INSERT INTO warehouse_stock .*ON DUPLICATE KEY UPDATE current_stock = current_stock \+ , available = current_stock - reserved/;

interface SqlObj { strings: string[]; values: unknown[] }
interface JoinObj { __kind: string; chunks: unknown[] }

const isJoin = (v: unknown): v is JoinObj =>
  !!v && typeof v === "object" && (v as JoinObj).__kind === "sql_join" && Array.isArray((v as JoinObj).chunks);

/** Ветки `WHEN product_id = ${id} THEN ${delta}` → пары «товар → величина». */
function branches(join: JoinObj): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const chunk of join.chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const c = chunk as { __kind: string; values: unknown[] };
    if (c.__kind !== "sql" || c.values.length < 2) continue;
    out.push([Number(c.values[0]), Number(c.values[c.values.length - 1])]);
  }
  return out;
}

// Generic so each test file's own Fake* row type (which typically has no
// index signature) is accepted without needing to add one just for this mock.
export function createExecuteMock<T extends StockRow>(stockTable: T[], options: ExecuteMockOptions = {}) {
  return (sqlObj: unknown) => {
    if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
    const s = sqlObj as SqlObj;
    const fullSql = s.strings.join("");

    // Shop debt is derived rather than nudged: the statement binds only
    // [shopId, tenantId] and recomputes the balance from the shop's records.
    if (options.debt && isShopDebtRecalc(fullSql)) {
      const [shopId, tenantId] = s.values.filter((v): v is number => typeof v === "number");
      for (const shop of options.debt.shops) {
        if (shop.id === shopId && shop.tenantId === tenantId) {
          shop.debt = deriveShopDebt(tenantId, shopId, options.debt.tables());
        }
      }
      return Promise.resolve();
    }

    if (!fullSql.includes("warehouse_stock")) return Promise.resolve();
    const norm = fullSql.replace(/\s+/g, " ").trim();

    if (DOOR_SHIFT.test(norm)) {
      const [onHandJoin, heldJoin] = s.values.filter(isJoin);
      const shifts = new Map<number, { onHand: number; held: number }>();
      const put = (id: number, key: "onHand" | "held", v: number) => {
        const cur = shifts.get(id) ?? { onHand: 0, held: 0 };
        cur[key] = v;
        shifts.set(id, cur);
      };
      if (onHandJoin) for (const [id, v] of branches(onHandJoin)) put(id, "onHand", v);
      if (heldJoin) for (const [id, v] of branches(heldJoin)) put(id, "held", v);
      return applyShift(shifts, s, stockTable);
    }

    if (DOOR_SET.test(norm)) {
      // Подстановки: [количество, то же количество (в LEAST), товар, орг., склад].
      const quantity = Number(s.values[0]);
      return applyAbsolute(quantity, s, stockTable);
    }

    if (DOOR_RECEIVE.test(norm)) {
      // Подстановки: [орг., склад, товар, кол-во, кол-во (available), кол-во].
      const [tenantId, , productId, quantity] = s.values.map(Number);
      return applyReceive(tenantId, productId, Number(quantity), stockTable);
    }

    throw new Error(
      "Подделка склада не узнала запрос к warehouse_stock:\n" +
      `  ${norm.slice(0, 200)}\n` +
      "Остаток меняет одна дверь (api/services/stock-ledger.ts), и форм у неё\n" +
      "три. Появилась четвёртая — либо ведите её через дверь, либо научите\n" +
      "стенд. Проглотить складскую правку молча нельзя: проверка останется\n" +
      "зелёной, ничего не проверив.",
    );
  };
}

/**
 * Достать значение подстановки, стоящей сразу после `<колонка> = `.
 *
 * ── Что здесь было ───────────────────────────────────────────────────────────
 *
 * Организация определялась так:
 *
 *     const tenantId = s.values.filter(v => typeof v !== "object").pop();
 *
 * то есть «последнее не-объектное значение запроса». А запрос кончается так:
 *
 *     WHERE product_id IN (…) AND tenant_id = ${tenantId} AND warehouse_id = ${whId}
 *
 * Последнее значение здесь — идентификатор СКЛАДА. Дальше строка остатка
 * отбиралась сравнением `row.tenantId === <warehouseId запроса>`. В стендах
 * организация 1 и склад 1 совпадают числом, поэтому всё сходилось — и сходилось
 * бы даже если бы из продакшена убрали фильтр по организации целиком.
 *
 * Теперь значение ищется по имени колонки перед ним: строки шаблона и
 * подстановки идут вперемежку, и текст, стоящий непосредственно перед
 * значением, — это strings[i].
 */
function bound(s: SqlObj, column: string): unknown {
  const re = new RegExp(`\\b${column}\\s*=\\s*$`);
  for (let i = 0; i < s.values.length; i++) {
    const before = s.strings[i] ?? "";
    if (re.test(before)) return s.values[i];
  }
  return undefined;
}

function tenantOf(s: SqlObj): unknown {
  const tenantId = bound(s, "tenant_id");
  if (tenantId === undefined) {
    throw new Error(
      "Подделка склада не нашла в запросе `tenant_id = ?`.\n" +
      "Без него правка применилась бы ко всем организациям сразу, и стенд " +
      "подтвердил бы отсутствие утечки, которой не проверял.",
    );
  }
  return tenantId;
}

const rowsFor = <T extends StockRow>(table: T[], tenantId: unknown, productId: number) =>
  table.filter(r => String(r.productId) === String(productId) && String(r.tenantId) === String(tenantId));

const money = (n: number) => n.toFixed(2);

/**
 * Сдвиг двумя числами — ровно то, что делает UPDATE двери.
 *
 * Ограничитель на резерве повторён как в SQL, а свободный остаток ВЫВОДИТСЯ, а
 * не правится: иначе стенд считал бы по другому правилу, чем база, и расхождение
 * всплыло бы не здесь.
 *
 * Строка без current_stock — обычное дело в стендах, которым физический остаток
 * не нужен. Вывести available от него тогда нельзя, и он двигается на
 * эквивалентную величину: `+ onHand − фактически снятое с резерва`. Пока строка
 * сходится, это то же самое число.
 */
function applyShift<T extends StockRow>(
  shifts: Map<number, { onHand: number; held: number }>,
  s: SqlObj,
  stockTable: T[],
) {
  const tenantId = tenantOf(s);
  for (const [productId, shift] of shifts) {
    for (const row of rowsFor(stockTable, tenantId, productId)) {
      const wasReserved = Number(row.reserved);
      const nowReserved = Math.max(0, wasReserved + shift.held);
      row.reserved = money(nowReserved);

      if (row.currentStock === undefined) {
        row.available = money(Number(row.available) + shift.onHand - (nowReserved - wasReserved));
        continue;
      }
      const nowCurrent = Number(row.currentStock) + shift.onHand;
      row.currentStock = money(nowCurrent);
      row.available = money(nowCurrent - nowReserved);
    }
  }
  return Promise.resolve();
}

/** Установка числом: резерв обрезается по новому остатку. */
function applyAbsolute<T extends StockRow>(quantity: number, s: SqlObj, stockTable: T[]) {
  const tenantId = tenantOf(s);
  const productId = Number(bound(s, "product_id"));
  for (const row of rowsFor(stockTable, tenantId, productId)) {
    const nowReserved = Math.min(Number(row.reserved), quantity);
    row.currentStock = money(quantity);
    row.reserved = money(nowReserved);
    row.available = money(quantity - nowReserved);
  }
  return Promise.resolve();
}

/**
 * Приход. Строки может не быть — и это не мелочь: в возвратах стоял голый
 * UPDATE, который на новом для склада товаре не совпадал ни с одной строкой.
 * Возврат принимали, с магазина списывали, а на склад он не попадал — молча.
 */
function applyReceive<T extends StockRow>(
  tenantId: number, productId: number, quantity: number, stockTable: T[],
) {
  const rows = rowsFor(stockTable, tenantId, productId);
  if (rows.length === 0) {
    stockTable.push({
      productId, tenantId,
      currentStock: money(quantity), reserved: "0.00", available: money(quantity),
    } as unknown as T);
    return Promise.resolve();
  }
  for (const row of rows) {
    const nowCurrent = Number(row.currentStock ?? 0) + quantity;
    row.currentStock = money(nowCurrent);
    row.available = money(nowCurrent - Number(row.reserved));
  }
  return Promise.resolve();
}

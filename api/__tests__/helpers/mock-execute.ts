// Shared execute mock for handling batch CASE/WHEN SQL queries in tests

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

/** Имена колонок остатка → поля поддельной строки. */
const COLUMN_TO_FIELD: Record<string, string> = {
  current_stock: "currentStock",
  reserved: "reserved",
  available: "available",
};

// Generic so each test file's own Fake* row type (which typically has no
// index signature) is accepted without needing to add one just for this mock.
export function createExecuteMock<T extends StockRow>(stockTable: T[], options: ExecuteMockOptions = {}) {
  return (sqlObj: unknown) => {
    if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
    const s = sqlObj as { strings: string[]; values: unknown[] };
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

    if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

    const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];

    /*
      ── Простая правка одного товара ─────────────────────────────────────────

      Не всякая правка склада написана через CASE/WHEN. Восстановление
      удалённого заказа, например, пишет по строке на товар:

          UPDATE warehouse_stock
          SET available = available - ${qty}, reserved = reserved + ${qty}
          WHERE product_id = ${productId} AND tenant_id = ${t} AND warehouse_id = ${w}

      Разбора для такой формы здесь не было. Три опознавателя ниже смотрят на
      «reserved = reserved +» и на «available = available -», и restore()
      попадал под «создание заказа» — но искали в нём куски sql_join, которых в
      простой форме нет вовсе. Список правок оставался пустым, склад не
      двигался, и проверка «после восстановления товар снова зарезервирован»
      прошла бы при любом коде.
    */
    if (!fullSql.includes("CASE")) {
      if (/LEAST\(|GREATEST\(/i.test(fullSql)) {
        throw new Error(
          "Подделка склада не разбирает LEAST/GREATEST в SET.\n" +
          "Посчитать половину выражения и умолчать об этом нельзя: остаток в " +
          "стенде разошёлся бы с настоящим, а тест продолжил бы подтверждать.\n" +
          "Такие пути проверяются набором real-db, где база настоящая.",
        );
      }

      const productId = bound(s, "product_id");
      // Каждая подстановка, перед которой стоит «колонка = колонка ±».
      const delta = /(\w+)\s*=\s*\1\s*([+-])\s*$/;
      for (let i = 0; i < s.values.length; i++) {
        const m = delta.exec((s.strings[i] ?? "").trim());
        if (!m) continue;
        const field = COLUMN_TO_FIELD[m[1]];
        if (!field) continue;
        updates.push({ productId: Number(productId), field, op: m[2], amount: Number(s.values[i]) });
      }

      if (updates.length > 0) return applyUpdates(updates, s, stockTable);
      // Ни одной понятой правки — дальше пробуют опознаватели CASE-форм.
    }

    // OrderService.updateStatus writes one uniform statement — every column is
    // "col = col + <signed delta>" — so the field order alone identifies it and
    // the sign already lives in the value. Handled first, since the heuristics
    // below guess the operator from the SQL text and would misread it.
    const isDeltaPattern = fullSql.includes("current_stock = CASE")
      && fullSql.includes("reserved = CASE")
      && fullSql.includes("available = CASE");
    if (isDeltaPattern) {
      const fields = ["currentStock", "reserved", "available"];
      let idx = 0;
      for (const val of s.values) {
        if (!val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        if (obj.__kind !== "sql_join" || !Array.isArray(obj.chunks)) continue;
        const field = fields[idx];
        if (field) {
          for (const chunk of obj.chunks) {
            if (!chunk || typeof chunk !== "object") continue;
            const c = chunk as { __kind: string; values: unknown[] };
            if (c.__kind !== "sql") continue;
            // values are [productId, <raw column marker>, delta] — the column
            // name is interpolated as an object, so take the delta from the end.
            updates.push({
              productId: Number(c.values[0]),
              field,
              op: "+",
              amount: Number(c.values[c.values.length - 1]),
            });
          }
        }
        idx++;
      }
      return applyUpdates(updates, s, stockTable);
    }

    const isCreatePattern = fullSql.includes("reserved = reserved +") || fullSql.includes("available = available -");
    const isCompletePattern = fullSql.includes("current_stock = CASE") && !fullSql.includes("reserved = reserved +");

    let caseIndex = 0;
    for (const val of s.values) {
      if (!val || typeof val !== "object") continue;
      const obj = val as Record<string, unknown>;

      if (obj.__kind === "sql_join" && Array.isArray(obj.chunks)) {
        if (caseIndex < 2) {
          let field: string;
          if (isCompletePattern) {
            field = caseIndex === 0 ? "currentStock" : "reserved";
          } else if (caseIndex === 0) {
            field = "reserved";
          } else {
            field = "available";
          }

          let op: string;
          if (isCreatePattern) {
            op = caseIndex === 0 ? "+" : "-";
          } else if (isCompletePattern) {
            op = "-";
          } else {
            op = caseIndex === 0 ? "-" : "+";
          }

          for (const chunk of obj.chunks) {
            if (!chunk || typeof chunk !== "object") continue;
            const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
            if (c.__kind !== "sql") continue;

            const productId = Number(c.values[0]);
            const amount = Number(c.values[1]);
            updates.push({ productId, field, op, amount });
          }
        }
        caseIndex++;
      }
    }

    return applyUpdates(updates, s, stockTable);
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
function bound(s: { strings: string[]; values: unknown[] }, column: string): unknown {
  const re = new RegExp(`\\b${column}\\s*=\\s*$`);
  for (let i = 0; i < s.values.length; i++) {
    const before = s.strings[i] ?? "";
    if (re.test(before)) return s.values[i];
  }
  return undefined;
}

function applyUpdates(
  updates: Array<{ productId: number; field: string; op: string; amount: number }>,
  s: { strings: string[]; values: unknown[] },
  stockTable: StockRow[],
) {
  const tenantId = bound(s, "tenant_id");
  if (tenantId === undefined) {
    throw new Error(
      "Подделка склада не нашла в запросе `tenant_id = ?`.\n" +
      "Без него правка применилась бы ко всем организациям сразу, и стенд " +
      "подтвердил бы отсутствие утечки, которой не проверял.",
    );
  }

  for (const u of updates) {
    for (const row of stockTable) {
      if (String(row.productId) === String(u.productId) && String(row.tenantId) === String(tenantId) && u.field) {
        const cur = Number((row as unknown as Record<string, string>)[u.field]);
        (row as unknown as Record<string, string>)[u.field] = (u.op === "+" ? cur + u.amount : cur - u.amount).toFixed(2);
      }
    }
  }

  return Promise.resolve();
}

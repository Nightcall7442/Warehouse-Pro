// Shared execute mock for handling batch CASE/WHEN SQL queries in tests

interface StockRow {
  productId: number;
  tenantId: number;
  currentStock?: string;
  reserved: string;
  available: string;
}

// Generic so each test file's own Fake* row type (which typically has no
// index signature) is accepted without needing to add one just for this mock.
export function createExecuteMock<T extends StockRow>(stockTable: T[]) {
  return (sqlObj: unknown) => {
    if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
    const s = sqlObj as { strings: string[]; values: unknown[] };
    const fullSql = s.strings.join("");
    if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

    const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];

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

function applyUpdates(
  updates: Array<{ productId: number; field: string; op: string; amount: number }>,
  s: { values: unknown[] },
  stockTable: StockRow[],
) {
  const tenantId = s.values.filter(v => typeof v !== "object" || v === null).pop();

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

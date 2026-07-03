// Shared execute mock for handling batch CASE/WHEN SQL queries in tests

interface StockRow {
  productId: number;
  tenantId: number;
  currentStock?: string;
  reserved: string;
  available: string;
  [key: string]: unknown;
}

export function createExecuteMock(stockTable: StockRow[]) {
  return (sqlObj: unknown) => {
    if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
    const s = sqlObj as { strings: string[]; values: unknown[] };
    const fullSql = s.strings.join("");
    if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

    const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];

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

    const tenantId = s.values.filter(v => typeof v !== "object" || v === null).pop();

    for (const u of updates) {
      for (const row of stockTable) {
        if (String(row.productId) === String(u.productId) && String(row.tenantId) === String(tenantId) && u.field) {
          const cur = Number((row as Record<string, string>)[u.field]);
          (row as Record<string, string>)[u.field] = (u.op === "+" ? cur + u.amount : cur - u.amount).toFixed(2);
        }
      }
    }

    return Promise.resolve();
  };
}

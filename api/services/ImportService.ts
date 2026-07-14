import { getDb } from "../queries/connection";
import { products, shops, warehouseStock, warehouses } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { cache, CacheKeys } from "../lib/cache";

type ParsedRow = Record<string, string | number | null>;

const PRODUCT_COLUMNS: Record<string, string> = {
  "код": "code", "code": "code", "артикул": "code",
  "название": "name", "name": "name", "наименование": "name",
  "категория": "category", "category": "category",
  "цена": "unitPrice", "price": "unitPrice", "unitprice": "unitPrice",
  "мин. остаток": "reorderPoint", "reorder": "reorderPoint", "reorderpoint": "reorderPoint",
  "описание": "description", "description": "description",
};

const SHOP_COLUMNS: Record<string, string> = {
  "название": "name", "name": "name",
  "владелец": "ownerName", "owner": "ownerName", "ownername": "ownerName",
  "телефон": "phone", "phone": "phone",
  "город": "city", "city": "city",
  "район": "district", "district": "district",
  "адрес": "address", "address": "address",
};

const PRODUCT_HEADERS = ["Код", "Название", "Категория", "Цена", "Мин. остаток", "Описание"];
const SHOP_HEADERS = ["Название", "Владелец", "Телефон", "Город", "Район", "Адрес"];

const PRODUCT_EXAMPLES = [["TOM-001", "Помидоры свежие", "Овощи", "4500", "50", "Первый сорт"]];
const SHOP_EXAMPLES = [["Зелёный рынок", "Иванов И.И.", "+998901234567", "Ташкент", "Чиланзар", "ул. Чиланзарская 1"]];

function mapColumns(headers: string[], mapping: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    const field = mapping[key];
    if (field) result[field] = i;
  });
  return result;
}

function parseRow(cells: (string | number | null)[], colMap: Record<string, number>): ParsedRow {
  const row: ParsedRow = {};
  for (const [field, idx] of Object.entries(colMap)) {
    row[field] = cells[idx] ?? null;
  }
  return row;
}

export const ImportService = {
  parseCSV(csvText: string, type: "products" | "shops"): { headers: string[]; rows: ParsedRow[] } {
    const lines = csvText.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
    const firstLine = lines[0].replace(/^\uFEFF/, "");
    const headers = firstLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));

    const mapping = type === "products"
      ? mapColumns(headers, PRODUCT_COLUMNS)
      : mapColumns(headers, SHOP_COLUMNS);

    const rows = lines.slice(1).map(line => {
      const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      return parseRow(cells, mapping);
    });

    return { headers, rows };
  },

  async importProducts(tenantId: number, rows: ParsedRow[]) {
    const db = getDb();
    const success = { count: 0 };
    const errors: string[] = [];
    const skipped: string[] = [];

    const parsedRows: Array<{ rowNum: number; name: string; code: string; category?: string; unitPrice: string; reorderPoint: string; description?: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const name = String(row.name ?? "").trim();
      const code = String(row.code ?? `IMPORT-${rowNum}`).trim();
      if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }
      parsedRows.push({
        rowNum, name, code,
        category: String(row.category ?? "").trim() || undefined,
        unitPrice: String(Number(String(row.unitPrice ?? "0").replace(/\s/g, "")) || 0),
        reorderPoint: String(Number(row.reorderPoint ?? 10) || 10),
        description: String(row.description ?? "").trim() || undefined,
      });
    }

    const codes = parsedRows.map(r => r.code);
    if (codes.length === 0) return { success: 0, errors, skipped, total: rows.length };

    const existingRows = await db.select({ code: products.code })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.code, codes[0])))
      .limit(1000);
    const existingCodes = new Set(existingRows.map(r => r.code));

    const toInsert = parsedRows.filter(r => {
      if (existingCodes.has(r.code)) { skipped.push(`${r.code} — уже существует`); return false; }
      return true;
    });

    await db.transaction(async (tx) => {
      // Get default warehouse for tenant
      const [defaultWarehouse] = await tx.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
        .limit(1);

      if (!defaultWarehouse) {
        return { success: 0, errors: ["Не найден склад по умолчанию"], skipped: [], total: rows.length };
      }

      for (const row of toInsert) {
        try {
          const [r] = await tx.insert(products).values({
            tenantId, code: row.code, name: row.name,
            category: row.category, unitPrice: row.unitPrice,
            reorderPoint: row.reorderPoint, description: row.description,
            status: "active",
          });
          await tx.insert(warehouseStock).values({
            tenantId, warehouseId: defaultWarehouse.id,
            productId: Number(r.insertId),
            currentStock: "0.00", reserved: "0.00", available: "0.00",
          });
          success.count++;
        } catch (err: unknown) {
          errors.push(`Строка ${row.rowNum}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    cache.invalidatePrefix(CacheKeys.productList(tenantId, 0).split(":")[0]);
    return { success: success.count, errors, skipped, total: rows.length };
  },

  async importShops(tenantId: number, rows: ParsedRow[]) {
    const db = getDb();
    const success = { count: 0 };
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      try {
        const name = String(row.name ?? "").trim();
        if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }
        await db.insert(shops).values({
          tenantId, name,
          ownerName: String(row.ownerName ?? "").trim() || undefined,
          phone: String(row.phone ?? "").trim() || undefined,
          city: String(row.city ?? "").trim() || undefined,
          district: String(row.district ?? "").trim() || undefined,
          debt: "0.00", status: "active",
        });
        success.count++;
      } catch (err: unknown) {
        errors.push(`Строка ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    cache.invalidatePrefix(CacheKeys.shopList(tenantId, 0).split(":")[0]);
    return { success: success.count, errors, total: rows.length };
  },

  getTemplate(type: "products" | "shops") {
    const headers = type === "products" ? PRODUCT_HEADERS : SHOP_HEADERS;
    const examples = type === "products" ? PRODUCT_EXAMPLES : SHOP_EXAMPLES;
    const csv = "\uFEFF" + [headers, ...examples].map(r => r.join(",")).join("\n");
    return { csv, filename: `template-${type}.csv` };
  },
};

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, shops, warehouseStock } from "@db/schema";
import { eq, and, inArray } from "drizzle-orm";

type ParsedRow = Record<string, string | number | null>;

// ── Column mappings (all supported columns) ──────────────────────────────────
const PRODUCT_COLUMNS: Record<string, string> = {
  "код": "code", "code": "code", "артикул": "code",
  "название": "name", "name": "name", "наименование": "name",
  "категория": "category", "category": "category",
  "цена продажи": "unitPrice", "цена": "unitPrice", "price": "unitPrice", "unitprice": "unitPrice", "продажа": "unitPrice",
  "себестоимость": "costPrice", "cost": "costPrice", "costprice": "costPrice", "себестоимость (сум)": "costPrice",
  "ед. измерения": "unit", "unit": "unit", "единица": "unit",
  "вес (кг)": "unitWeight", "weight": "unitWeight", "unitweight": "unitWeight", "вес": "unitWeight",
  "штрихкод": "barcode", "barcode": "barcode", "баркод": "barcode",
  "мин. остаток": "reorderPoint", "reorder": "reorderPoint", "reorderpoint": "reorderPoint", "остаток": "reorderPoint",
  "описание": "description", "description": "description",
  "фото": "photoUrl", "photo": "photoUrl", "photoUrl": "photoUrl", "фото url": "photoUrl", "image": "photoUrl", "картинка": "photoUrl",
};

const SHOP_COLUMNS: Record<string, string> = {
  "название": "name", "name": "name",
  "владелец": "ownerName", "owner": "ownerName", "ownername": "ownerName",
  "телефон": "phone", "phone": "phone",
  "город": "city", "city": "city",
  "район": "district", "district": "district",
  "адрес": "address", "address": "address",
  "долг": "debt", "debt": "debt",
  "широта": "gpsLat", "lat": "gpsLat", "gpslat": "gpsLat",
  "долгота": "gpsLng", "lng": "gpsLng", "gpslng": "gpsLng",
  "примечания": "notes", "notes": "notes",
};

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

/** Parse file (CSV or XLSX) into headers + rows */
function parseFile(base64: string, filename: string): { headers: string[]; rows: (string | number | null)[][] } {
  const isXlsx = filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls");

  if (isXlsx) {
    // XLSX — use xlsx library (dynamic import for server)
    const XLSX = require("xlsx");
    const buf = Buffer.from(base64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (data.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Файл пуст" });
    const headers = data[0].map((h: any) => String(h ?? "").trim());
    const rows = data.slice(1).filter((r: any[]) => r.some(c => c !== null && c !== ""));
    return { headers, rows };
  }

  // CSV
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  const lines = decoded.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Файл пуст" });
  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const headers = firstLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(line => line.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  return { headers, rows };
}

export const importRouter = createRouter({
  /** Download template as base64 CSV */
  downloadTemplate: operatorQuery
    .input(z.object({ type: z.enum(["products", "shops"]) }))
    .query(({ input }) => {
      const headers = input.type === "products"
        ? ["Код", "Штрихкод", "Название", "Категория", "Себестоимость (сум)", "Цена продажи (сум)", "Ед. измерения", "Вес (кг)", "Мин. остаток", "Описание", "Фото URL"]
        : ["Название", "Владелец", "Телефон", "Город", "Район", "Адрес", "Долг", "Широта", "Долгота", "Примечания"];

      const examples = input.type === "products"
        ? [
            ["TOM-001", "4780123456789", "Помидоры свежие", "Овощи", "8500", "12000", "kg", "1.000", "50", "Первый сорт", ""],
            ["OGU-001", "4780123456790", "Огурцы тепличные", "Овощи", "7200", "10500", "kg", "1.000", "40", "Свежие", ""],
            ["MLK-001", "4780123456800", "Молоко Eataly 1л", "Молочные продукты", "8200", "11500", "pcs", "1.030", "50", "Свежее молоко 2.5%", ""],
          ]
        : [
            ["Олтин Дала", "Эркаев Дилшод", "+998911000001", "Ташкент", "Юнусабад", "Беруни кўчаси 22", "0", "41.3603", "69.2853", ""],
            ["Барока Market", "Юсупова Дилноза", "+998911000002", "Ташкент", "Шайхонтохур", "Амир Темур 5", "850000", "41.3111", "69.2797", "Постоянный клиент"],
          ];

      const csv = "\uFEFF" + [headers, ...examples].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
      return { csv, filename: `template-${input.type}.csv` };
    }),

  /** Preview first 5 rows without importing */
  previewImport: operatorQuery
    .input(z.object({
      type: z.enum(["products", "shops"]),
      base64: z.string(),
      filename: z.string(),
    }))
    .mutation(({ input }) => {
      try {
        const { headers, rows } = parseFile(input.base64, input.filename);
        const mapping = input.type === "products"
          ? mapColumns(headers, PRODUCT_COLUMNS)
          : mapColumns(headers, SHOP_COLUMNS);

        const preview = rows.slice(0, 5).map(cells => parseRow(cells, mapping));
        return { headers, preview, totalRows: rows.length };
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e.message || "Не удалось прочитать файл." });
      }
    }),

  /** Execute import in transaction */
  executeImport: operatorQuery
    .input(z.object({
      type: z.enum(["products", "shops"]),
      base64: z.string(),
      filename: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const db = getDb();

      const { headers, rows: dataRows } = parseFile(input.base64, input.filename);
      const mapping = input.type === "products"
        ? mapColumns(headers, PRODUCT_COLUMNS)
        : mapColumns(headers, SHOP_COLUMNS);

      let success = 0;
      const errors: string[] = [];
      const skipped: string[] = [];

      if (input.type === "products") {
        const parsedRows: Array<{
          rowNum: number; name: string; code: string; barcode?: string;
          category?: string; costPrice: string; unitPrice: string; unit: string;
          unitWeight: string; reorderPoint: string; description?: string; photoUrl?: string;
        }> = [];

        for (let i = 0; i < dataRows.length; i++) {
          const rowNum = i + 2;
          const row = parseRow(dataRows[i], mapping);
          const name = String(row.name ?? "").trim();
          const code = String(row.code ?? `IMPORT-${rowNum}`).trim();
          if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }

          const rawPrice = String(row.unitPrice ?? "0").replace(/\s/g, "").replace(/[^\d.]/g, "");
          const rawCost = String(row.costPrice ?? "0").replace(/\s/g, "").replace(/[^\d.]/g, "");
          const validUnits = ["kg", "l", "pcs", "box", "pack", "m"];
          const rawUnit = String(row.unit ?? "pcs").trim().toLowerCase();
          const unit = validUnits.includes(rawUnit) ? rawUnit : "pcs";

          parsedRows.push({
            rowNum, name, code,
            barcode: String(row.barcode ?? "").trim() || undefined,
            category: String(row.category ?? "").trim() || undefined,
            costPrice: String(Number(rawCost) || 0),
            unitPrice: String(Number(rawPrice) || 0),
            unit,
            unitWeight: String(Number(String(row.unitWeight ?? "0").replace(/[^\d.]/g, "")) || 0),
            reorderPoint: String(Number(row.reorderPoint ?? 10) || 10),
            description: String(row.description ?? "").trim() || undefined,
            photoUrl: String(row.photoUrl ?? "").trim() || undefined,
          });
        }

        // Check existing codes
        const codes = parsedRows.map(r => r.code);
        const existingRows = await db.select({ code: products.code })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), inArray(products.code, codes)));
        const existingCodes = new Set(existingRows.map(r => r.code));

        const toInsert = parsedRows.filter(r => {
          if (existingCodes.has(r.code)) { skipped.push(`${r.code} — уже существует`); return false; }
          return true;
        });

        await db.transaction(async (tx) => {
          for (const row of toInsert) {
            try {
              const [r] = await tx.insert(products).values({
                tenantId, code: row.code, name: row.name, barcode: row.barcode,
                category: row.category, costPrice: row.costPrice, unitPrice: row.unitPrice,
                unit: row.unit as any, unitWeight: row.unitWeight,
                reorderPoint: row.reorderPoint, description: row.description,
                photoUrl: row.photoUrl, status: "active",
              });
              await tx.insert(warehouseStock).values({
                tenantId, productId: Number(r.insertId),
                currentStock: "0.00", reserved: "0.00", available: "0.00",
              });
              success++;
            } catch (err: unknown) {
              errors.push(`Строка ${row.rowNum}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        });
      } else {
        // Shops import
        for (let i = 0; i < dataRows.length; i++) {
          const rowNum = i + 2;
          const row = parseRow(dataRows[i], mapping);
          try {
            const name = String(row.name ?? "").trim();
            if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }
            await db.insert(shops).values({
              tenantId, name,
              ownerName: String(row.ownerName ?? "").trim() || undefined,
              phone: String(row.phone ?? "").trim() || undefined,
              city: String(row.city ?? "").trim() || undefined,
              district: String(row.district ?? "").trim() || undefined,
              address: String(row.address ?? "").trim() || undefined,
              debt: String(Number(String(row.debt ?? "0").replace(/[^\d.]/g, "")) || 0),
              gpsLat: row.gpsLat ? String(row.gpsLat) : undefined,
              gpsLng: row.gpsLng ? String(row.gpsLng) : undefined,
              notes: String(row.notes ?? "").trim() || undefined,
              status: "active",
            });
            success++;
          } catch (err: unknown) {
            errors.push(`Строка ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return { success, errors, skipped, total: dataRows.length };
    }),
});

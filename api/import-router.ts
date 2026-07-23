import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, shops, warehouseStock, warehouses } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { cache } from "./lib/cache";
import { env } from "./lib/env";

type ParsedRow = Record<string, string | number | null>;

/** Upload base64 data URI to S3. Returns the S3 URL or empty string if S3 not configured. */
async function uploadBase64ToS3(dataUrl: string, folder: string, tenantId: number): Promise<string> {
  const isS3 = !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);
  if (!isS3) {
    // S3 not configured — skip base64 data to avoid DB size limits
    return "";
  }

  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return dataUrl;

  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  const key = `${folder}/${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: env.s3Region || "us-east-1",
    credentials: {
      accessKeyId: env.s3AccessKey || "",
      secretAccessKey: env.s3SecretKey || "",
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: env.s3Bucket!,
    Key: key,
    Body: buffer,
    ContentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
  }));
  return `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
}

// ── Column mappings (all supported columns) ──────────────────────────────────
const PRODUCT_COLUMNS: Record<string, string> = {
  "код": "code", "code": "code", "артикул": "code",
  "название": "name", "name": "name", "наименование": "name",
  "категория": "category", "category": "category",
  "цена продажи": "unitPrice", "цена продажи (сум)": "unitPrice", "цена": "unitPrice", "price": "unitPrice", "unitprice": "unitPrice", "продажа": "unitPrice",
  "себестоимость": "costPrice", "cost": "costPrice", "costprice": "costPrice", "себестоимость (сум)": "costPrice",
  "ед. измерения": "unit", "unit": "unit", "единица": "unit",
  "вес (кг)": "unitWeight", "weight": "unitWeight", "unitweight": "unitWeight", "вес": "unitWeight",
  "штрихкод": "barcode", "barcode": "barcode", "баркод": "barcode",
  "мин. остаток": "reorderPoint", "reorder": "reorderPoint", "reorderpoint": "reorderPoint",
  "остаток на складе": "initialStock", "stock": "initialStock", "количество": "initialStock", "qty": "initialStock", "кол-во": "initialStock", "остаток": "initialStock",
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
async function parseFile(base64: string, filename: string): Promise<{ headers: string[]; rows: (string | number | null)[][] }> {
  const isXlsx = filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls");

  if (isXlsx) {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const buf = Buffer.from(base64, "base64");
    await workbook.xlsx.load(buf);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Файл пуст" });
    const headers: string[] = [];
    const rows: (string | number | null)[][] = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1); // ExcelJS row.values is 1-indexed with first element undefined
      if (rowNumber === 1) {
        headers.push(...values.map((h: unknown) => String(h ?? "").trim()));
      } else {
        const filtered = values.map((c: unknown) => c ?? null);
        if (filtered.some(c => c !== null && c !== "")) {
          rows.push(filtered);
        }
      }
    });
    if (headers.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Файл пуст" });
    return { headers, rows };
  }

  // CSV
  // Proper CSV parser that handles quoted fields with commas inside
  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  const lines = decoded.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Файл пуст" });
  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const headers = parseCsvLine(firstLine).map(h => h.replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(line => parseCsvLine(line).map(c => c.replace(/^"|"$/g, "")));
  return { headers, rows };
}

export const importRouter = createRouter({
  /** Download template as base64 CSV with full test data */
  downloadTemplate: operatorQuery
    .input(z.object({ type: z.enum(["products", "shops"]) }))
    .query(async ({ input }) => {
      const headers = input.type === "products"
        ? ["Код", "Штрихкод", "Название", "Категория", "Себестоимость (сум)", "Цена продажи (сум)", "Ед. измерения", "Вес (кг)", "Мин. остаток", "Остаток на складе", "Описание", "Фото URL"]
        : ["Название", "Владелец", "Телефон", "Город", "Район", "Адрес", "Долг", "Широта", "Долгота", "Примечания"];

      const examples = input.type === "products"
        ? [
            ["TOM-001", "4780123456789", "Помидоры свежие", "Овощи", "8500", "12000", "kg", "1.000", "50", "100", "Первый сорт, свежий урожай", ""],
            ["OGU-001", "4780123456790", "Огурцы тепличные", "Овощи", "7200", "10500", "kg", "1.000", "40", "80", "Тепличные, хрустящие", ""],
            ["KAP-001", "4780123456791", "Капуста белокочанная", "Овощи", "3500", "5500", "kg", "1.000", "60", "90", "Свежая капуста", ""],
            ["MOR-001", "4780123456792", "Морковь мытая", "Овощи", "4200", "6800", "kg", "1.000", "45", "70", "Мытая, высший сорт", ""],
            ["LUK-001", "4780123456793", "Лук репчатый", "Овощи", "2800", "4500", "kg", "1.000", "80", "120", "Репчатый, желтый", ""],
            ["KAR-001", "4780123456794", "Картофель молодой", "Овощи", "5000", "7500", "kg", "1.000", "100", "150", "Молодой картофель", ""],
            ["YAB-001", "4780123456795", "Яблоко Гала", "Фрукты", "9500", "14000", "kg", "1.000", "30", "50", "Сладкие яблоки Гала", ""],
            ["BAN-001", "4780123456796", "Банан Эквадор", "Фрукты", "14000", "19500", "kg", "1.000", "25", "40", "Спелые бананы из Эквадора", ""],
            ["VIN-001", "4780123456797", "Виноград Кишмиш", "Фрукты", "18000", "26000", "kg", "1.000", "20", "30", "Без косточки, сладкий", ""],
            ["ARB-001", "4780123456798", "Арбуз зимний", "Фрукты", "3200", "5500", "kg", "1.000", "15", "25", "Зимний арбуз из Ирана", ""],
            ["MAN-001", "4780123456799", "Мандарин Марокко", "Фрукты", "16000", "22000", "kg", "1.000", "20", "30", "Мандарины из Марокко", ""],
            ["MLK-001", "4780123456800", "Молоко Eataly 1л", "Молочные продукты", "8200", "11500", "pcs", "1.030", "50", "80", "Свежее молоко 2.5%", ""],
            ["SME-001", "4780123456801", "Сметана 20% 300г", "Молочные продукты", "9500", "13500", "pcs", "0.300", "40", "65", "Сметана жирность 20%", ""],
            ["TVO-001", "4780123456802", "Творог 5% 400г", "Молочные продукты", "11000", "15500", "pcs", "0.400", "30", "50", "Творог 5% жирности", ""],
            ["KEF-001", "4780123456803", "Кефир 1л", "Молочные продукты", "7800", "11000", "pcs", "1.020", "35", "55", "Кефир однодневный", ""],
            ["SYR-001", "4780123456804", "Сыр Российский 500г", "Молочные продукты", "28000", "38000", "pcs", "0.500", "20", "30", "Сыр твердый", ""],
            ["GOV-001", "4780123456805", "Говядина охлаждённая", "Мясо", "68000", "85000", "kg", "1.000", "15", "25", "Охлаждённая говядина", ""],
            ["KUR-001", "4780123456806", "Курица бёдра (филе)", "Мясо", "32000", "45000", "kg", "1.000", "25", "40", "Куриные бёдра без кожи", ""],
            ["BAR-001", "4780123456807", "Баранина (лопатка)", "Мясо", "75000", "95000", "kg", "1.000", "10", "15", "Баранья лопатка", ""],
            ["KOL-001", "4780123456808", "Колбаса Докторская 500г", "Мясо", "22000", "32000", "pcs", "0.500", "30", "50", "Вареная колбаса", ""],
            ["VOD-001", "4780123456809", "Вода Орол 1.5л", "Напитки", "2800", "4200", "pcs", "1.500", "100", "160", "Питьевая вода", ""],
            ["SOK-001", "4780123456810", "Сок Инжир яблочный 1л", "Напитки", "6200", "8900", "pcs", "1.030", "60", "95", "100% яблочный сок", ""],
            ["CHA-001", "4780123456811", "Чай Greenfield 100 пакетиков", "Напитки", "32000", "45000", "pcs", "0.250", "20", "30", "Чай в пакетиках", ""],
            ["KOF-001", "4780123456812", "Кофе Nescafe Classic 100г", "Напитки", "45000", "62000", "pcs", "0.100", "15", "25", "Растворимый кофе", ""],
            ["PEP-001", "4780123456813", "Пепси 1.5л", "Напитки", "3500", "5500", "pcs", "1.500", "80", "130", "Газированный напиток", ""],
            ["MUK-001", "4780123456814", "Мука высший сорт Олтин Дон", "Бакалея", "5400", "6800", "kg", "1.000", "200", "320", "Пшеничная мука", ""],
            ["RIS-001", "4780123456815", "Рис Лазер Хорезм", "Бакалея", "13500", "17000", "kg", "1.000", "150", "240", "Рис круглозёрный", ""],
            ["SAH-001", "4780123456816", "Сахар-песок", "Бакалея", "8900", "10800", "kg", "1.000", "300", "480", "Сахар белый", ""],
            ["MAS-001", "4780123456817", "Масло подсолнечное Шарк 1л", "Бакалея", "11500", "15200", "pcs", "0.920", "80", "130", "Подсолнечное масло рафинированное", ""],
            ["MAK-001", "4780123456818", "Макароны Barilla 500г", "Бакалея", "7800", "11000", "pcs", "0.500", "40", "65", "Итальянские макароны", ""],
            ["PEC-001", "4780123456819", "Печенье Юбилейное 400г", "Кондитерия", "9200", "13900", "pcs", "0.400", "40", "65", "Печенье сдобное", ""],
            ["SHO-001", "4780123456820", "Шоколад Спартак молочный 90г", "Кондитерия", "6500", "9800", "pcs", "0.090", "50", "80", "Молочный шоколад", ""],
            ["KON-001", "4780123456821", "Конфеты Барни 250г", "Кондитерия", "18000", "25000", "pcs", "0.250", "25", "40", "Конфеты ассорти", ""],
            ["MED-001", "4780123456822", "Мёд натуральный 500г", "Кондитерия", "52000", "72000", "pcs", "0.500", "10", "15", "Натуральный мёд", ""],
            ["XLE-001", "4780123456823", "Хлеб Лепёшка нарезной 500г", "Хлеб", "3200", "5000", "pcs", "0.500", "60", "95", "Нарезной хлеб", ""],
            ["LAV-001", "4780123456824", "Лаваш тонкий 400г", "Хлеб", "2500", "4000", "pcs", "0.400", "50", "80", "Тонкий лаваш", ""],          ]
        : [
            ["Олтин Дала savdo", "Эркаев Дилшод", "+998911000001", "Ташкент", "Юнусабад", "Беруни кўчаси 22", "0", "41.3603", "69.2853", ""],
            ["Барока Market", "Юсупова Дилноза", "+998911000002", "Ташкент", "Шайхонтохур", "Амир Темур 5", "850000", "41.3111", "69.2797", "Постоянный клиент"],
            ["Файз Продукт", "Рашидов Алишер", "+998911000003", "Ташкент", "Мирзо Улугбек", "Навои 41", "320000", "41.3367", "69.3389", ""],
            ["Гулистон do'koni", "Назарова Зулфия", "+998911000004", "Ташкент", "Шайхонтохур", "Навои 17", "0", "41.3046", "69.2781", ""],
            ["Рахмат Савдо", "Ибрагимов Рустам", "+998911000005", "Ташкент", "Сергели", "Алмазар 8", "150000", "41.2934", "69.2564", ""],
            ["Чойхона Марказий", "Каримова Гулнара", "+998911000006", "Ташкент", "Юнусабад", "Мустақиллик 33", "0", "41.3552", "69.2878", ""],
            ["Dokon Super", "Холматов Бекзод", "+998911000007", "Ташкент", "Олмазор", "Фарғона Йўли 112", "570000", "41.3199", "69.3363", ""],
            ["Умид Мағозин", "Тўхтасинова Нилуфар", "+998911000008", "Ташкент", "Бектемир", "Бектемир 19", "0", "41.2803", "69.3198", ""],
            ["Кўпчilik Market", "Салимов Акмал", "+998911000009", "Ташкент", "Чиланзар", "Чиланзар 45", "200000", "41.2875", "69.2673", ""],
            ["Навруз Савдо", "Дустматова Гулзода", "+998911000010", "Ташкент", "Яшнобод", "Яшнобод 7", "0", "41.3042", "69.3521", ""],
            ["Регистан Маркет", "Шарипов Мирзокирим", "+998912000001", "Самарканд", "Марказий", "Регистон 3", "0", "39.6542", "66.9756", ""],
            ["Самарқанд Таомлари", "Назарова Дилдор", "+998912000002", "Самарканд", "Марказий", "Амир Темур 28", "430000", "39.6520", "66.9770", ""],
            ["Хўжа Дийдор savdo", "Абдуллаев Сардор", "+998912000003", "Самарканд", "Самарқанд", "Бўстонсарай 12", "0", "39.6517", "66.9842", ""],
            ["Лазервёрк Маркет", "Тўраева Гулчеҳра", "+998912000004", "Самарканд", "Марказий", "Сиёб 55", "175000", "39.6470", "66.9615", ""],
            ["Нуроний Market", "Эргашев Бахром", "+998912000005", "Самарканд", "Самарқанд", "Улугбек 8", "0", "39.6530", "66.9698", ""],
            ["Дўстлик Савдо", "Исмоилова Малика", "+998912000006", "Самарканд", "Марказий", "Дўстлик 21", "80000", "39.6488", "66.9720", ""],
            ["Олтин Сари Маркет", "Худойдодов Жамшид", "+998912000007", "Самарканд", "Самарқанд", "Пойариқ 14", "0", "39.6460", "66.9590", ""],
            ["Фермер Маркет", "Ботирова Шохина", "+998912000008", "Самарканд", "Марказий", "Афросиёб 31", "620000", "39.6610", "66.9805", ""],
            ["Истиклол Маркет", "Камилов Акбар", "+998913000001", "Бухара", "Марказий", "Истиклол 9", "0", "39.7747", "64.4217", ""],
            ["Бухоро Таомлари", "Сатторова Фируза", "+998913000002", "Бухара", "Марказий", "Коракўл 18", "290000", "39.7762", "64.4231", ""],
            ["Самоний Market", "Рустамов Дилшод", "+998913000003", "Бухара", "Бухоро", "Алишер Навоий 6", "0", "39.7735", "64.4189", ""],
            ["Пойтахт Савдо", "Махмудова Гулнора", "+998913000004", "Бухара", "Марказий", "Навоий 42", "150000", "39.7700", "64.4175", ""],
            ["Чойхона Мир", "Тўхтаев Феруз", "+998913000005", "Бухара", "Бухоро", "Мир Аравалон 3", "0", "39.7780", "64.4250", ""],
            ["Бозор Маркет", "Холматова Малика", "+998913000006", "Бухара", "Марказий", "Таџик 15", "480000", "39.7715", "64.4200", ""],
            ["Роҳат Мағозин", "Эргашева Дилноза", "+998913000007", "Бухара", "Бухоро", "Ал-Bukhari 27", "0", "39.7755", "64.4210", ""],
          ];

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(input.type === "products" ? "Товары" : "Магазины");

      const headerRow = ws.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FF4F46E5" } },
          bottom: { style: "thin", color: { argb: "FF4F46E5" } },
          left: { style: "thin", color: { argb: "FF4F46E5" } },
          right: { style: "thin", color: { argb: "FF4F46E5" } },
        };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      headerRow.height = 24;

      examples.forEach((row, idx) => {
        const dataRow = ws.addRow(row);
        const isEven = idx % 2 === 0;
        dataRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF1F5F9" : "FFFFFFFF" } };
          cell.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
          cell.alignment = { vertical: "middle" };
        });
      });

      ws.columns = headers.map((h) => ({ width: Math.max(h.length + 4, 14) }));

      const buffer = await wb.xlsx.writeBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { base64, filename: `template-${input.type}.xlsx` };
    }),

  /** Preview first 5 rows without importing */
  previewImport: operatorQuery
    .input(z.object({
      type: z.enum(["products", "shops"]),
      base64: z.string(),
      filename: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { headers, rows } = await parseFile(input.base64, input.filename);
        const mapping = input.type === "products"
          ? mapColumns(headers, PRODUCT_COLUMNS)
          : mapColumns(headers, SHOP_COLUMNS);

        const preview = rows.slice(0, 5).map(cells => parseRow(cells, mapping));
        return { headers, preview, totalRows: rows.length };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Не удалось прочитать файл.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
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

      const { headers, rows: dataRows } = await parseFile(input.base64, input.filename);
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
          unitWeight: string; reorderPoint: string; initialStock: string;
          description?: string; photoUrl?: string;
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
          const unitTranslations: Record<string, string> = {
            "шт": "pcs", "штук": "pcs", "дона": "pcs",
            "кг": "kg", "kilogram": "kg",
            "л": "l", "литр": "l", "litr": "l",
            "ящ": "box", "ящик": "box", "quti": "box",
            "упак": "pack", "упаковка": "pack", "pachka": "pack",
            "м": "m", "метр": "m", "metr": "m",
          };
          const rawUnit = String(row.unit ?? "pcs").trim().toLowerCase();
          const unit = unitTranslations[rawUnit] ?? (validUnits.includes(rawUnit) ? rawUnit : "pcs");

          parsedRows.push({
            rowNum, name, code,
            barcode: String(row.barcode ?? "").trim() || undefined,
            category: String(row.category ?? "").trim() || undefined,
            costPrice: String(Number(rawCost) || 0),
            unitPrice: String(Number(rawPrice) || 0),
            unit,
            unitWeight: String(Number(String(row.unitWeight ?? "0").replace(/[^\d.]/g, "")) || 0),
            reorderPoint: String(Number(row.reorderPoint ?? 10) || 10),
            initialStock: String(Number(String(row.initialStock ?? "0").replace(/[^\d.]/g, "")) || 0),
            description: String(row.description ?? "").trim() || undefined,
            photoUrl: String(row.photoUrl ?? "").trim() || undefined,
          });
        }

        // Insert all rows — duplicates handled by unique constraint catch
        await db.transaction(async (tx) => {
          // Get default warehouse for tenant — auto-create if missing
          let [defaultWarehouse] = await tx.select({ id: warehouses.id })
            .from(warehouses)
            .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
            .limit(1);

          if (!defaultWarehouse) {
            const [created] = await tx.insert(warehouses).values({
              tenantId, name: "Основной склад", isDefault: true, status: "active",
            });
            defaultWarehouse = { id: Number(created.insertId) };
          }

          for (const row of parsedRows) {
            try {
              // Upload base64 photo to S3 if needed
              let photoUrl = row.photoUrl;
              if (photoUrl && photoUrl.startsWith("data:image/")) {
                photoUrl = await uploadBase64ToS3(photoUrl, "products", tenantId);
              }

              const [r] = await tx.insert(products).values({
                tenantId, code: row.code, name: row.name, barcode: row.barcode,
                category: row.category, costPrice: row.costPrice, unitPrice: row.unitPrice,
                unit: row.unit as any, unitWeight: row.unitWeight,
                reorderPoint: row.reorderPoint, description: row.description,
                photoUrl, status: "active",
              });
              // Use raw SQL to handle case where warehouse_id column may not exist
              try {
                await tx.execute(sql`INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available) VALUES (${tenantId}, ${defaultWarehouse.id}, ${Number(r.insertId)}, ${row.initialStock}, '0.00', ${row.initialStock})`);
              } catch {
                try {
                  await tx.execute(sql`INSERT INTO warehouse_stock (tenant_id, product_id, current_stock, reserved, available) VALUES (${tenantId}, ${Number(r.insertId)}, ${row.initialStock}, '0.00', ${row.initialStock})`);
                } catch { /* give up */ }
              }
              success++;
            } catch (err: unknown) {
              const anyErr = err as any;
              // drizzle-orm wraps the real MySQL error in .cause, not .message
              const causeMsg = anyErr?.cause?.message || "";
              const fullMsg = [anyErr?.message, causeMsg, anyErr?.sqlMessage].filter(Boolean).join(" | ");
              if (causeMsg.includes("Duplicate") || fullMsg.includes("Duplicate") || fullMsg.includes("uq_product") || anyErr?.code === "ER_DUP_ENTRY") {
                skipped.push(`${row.code} — уже существует`);
              } else {
                errors.push(`Строка ${row.rowNum}: ${fullMsg}`);
              }
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
            const anyErr = err as any;
            const causeMsg = anyErr?.cause?.message || "";
            const fullMsg = [anyErr?.message, causeMsg, anyErr?.sqlMessage].filter(Boolean).join(" | ");
            if (causeMsg.includes("Duplicate") || fullMsg.includes("Duplicate") || anyErr?.code === "ER_DUP_ENTRY") {
              skipped.push(`${rowNum}: магазин "${name}" — уже существует`);
            } else {
              errors.push(`Строка ${rowNum}: ${fullMsg}`);
            }
          }
        }
      }

      // Invalidate server-side cache so lists reflect imported data
      cache.invalidatePrefix(`products:${tenantId}`);
      cache.invalidatePrefix(`product_cats:${tenantId}`);
      cache.invalidatePrefix(`shops:${tenantId}`);
      cache.invalidatePrefix(`shop_cities:${tenantId}`);
      cache.invalidatePrefix(`shop_districts:${tenantId}`);
      cache.invalidatePrefix(`warehouse:${tenantId}`);
      cache.invalidatePrefix(`warehouse_valuation:${tenantId}`);

      return { success, errors, skipped, total: dataRows.length };
    }),
});

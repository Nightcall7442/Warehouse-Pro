/**
 * Импорт Excel принимает налоговые реквизиты: ИНН/ПИНФЛ и НДС магазина, ИКПУ,
 * код упаковки и ставку товара.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Столбцов для реквизитов не было ни в шаблоне, ни в разборе: справочник на
 * три тысячи точек с ИНН приходилось бы набирать руками по одной карточке.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Через настоящую ручку import.executeImport на настоящей MySQL:
 *   • шаблон содержит новые столбцы, и номера в нём — текстовые ячейки;
 *   • файл с заголовками из шаблона встаёт: ИКПУ с нулём в начале, ставка
 *     «12%», «без НДС»; ИНН с пробелами — цифрами, «да»/«нет» — признак;
 *   • ИКПУ числом (Excel уже съел в нём цифры) — отказ строке с причиной, а
 *     не товар с испорченным кодом; кривой ИНН, ИКПУ, ставка, «возможно» —
 *     отказ строке, остальные строки встают;
 *   • файл без новых столбцов — как раньше: реквизиты пустые.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const csv = (lines: string[]) => Buffer.from(lines.join("\n"), "utf-8").toString("base64");

describe.skipIf(!hasRealDb)("импорт: налоговые реквизиты", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  const importer = async () => (await import("../../import-router")).importRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
  const product = async (code: string) => (await db.select().from(schema.products).where(eq(schema.products.code, code)))[0];
  const shop = async (name: string) => (await db.select().from(schema.shops).where(eq(schema.shops.name, name)))[0];

  it("шаблон товаров: столбцы реквизитов на месте, ИКПУ — текстом; файл по шаблону встаёт, ИКПУ числом — отказ", async () => {
    const api = await importer();
    const tpl = await api.downloadTemplate({ type: "products" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(tpl.base64, "base64") as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(headers).toEqual(expect.arrayContaining(["ИКПУ (17 цифр)", "Код упаковки", "Ставка НДС (12 / 0 / без НДС)"]));
    const ikpuCol = headers.indexOf("ИКПУ (17 цифр)") + 1;
    expect(ws.getColumn(ikpuCol).numFmt).toBe("@");
    // Примеры реквизитов не выдуманы: ячейки пустые.
    expect(String(ws.getRow(2).getCell(ikpuCol).value ?? "")).toBe("");

    // Файл, собранный по заголовкам шаблона.
    const out = new ExcelJS.Workbook();
    const sheet = out.addWorksheet("Товары");
    sheet.addRow(headers);
    const row = (code: string, ikpu: string | number, vat: string | number) => {
      const r: unknown[] = headers.map(() => "");
      r[headers.indexOf("Код")] = code; r[headers.indexOf("Название")] = `Товар ${code}`;
      r[headers.indexOf("Цена продажи (сум)")] = 1000;
      r[headers.indexOf("ИКПУ (17 цифр)")] = ikpu; r[headers.indexOf("Код упаковки")] = "1510583";
      r[headers.indexOf("Ставка НДС (12 / 0 / без НДС)")] = vat;
      sheet.addRow(r);
    };
    row("X-1", "02202001001000000", "12%");
    row("X-2", 12345678901234568, 12);   // так Excel хранит 17 цифр, набранные в числовую ячейку: хвост уже не тот
    row("X-3", "", 0.12);                // ячейка в процентах: 12% — это 0,12
    const bytes = Buffer.from(await out.xlsx.writeBuffer()).toString("base64");
    const r = await api.executeImport({ type: "products", base64: bytes, filename: "prices.xlsx" });

    expect(r.success).toBe(2);
    expect(r.errors).toEqual([expect.stringMatching(/^Строка 3: ИКПУ записан числом/)]);
    expect(await product("X-1")).toMatchObject({ ikpu: "02202001001000000", packageCode: "1510583", vatRate: "vat12" });
    expect(await product("X-2")).toBeUndefined();
    expect(await product("X-3")).toMatchObject({ ikpu: null, vatRate: "vat12" });
  });

  it("товары CSV: «без НДС», «0%»; кривые ИКПУ и ставка — отказ строке, соседние встают", async () => {
    const r = await (await importer()).executeImport({ type: "products", filename: "p.csv", base64: csv([
      "Код,Название,Цена продажи (сум),ИКПУ,Ставка НДС",
      "C-1,Хлеб,3000,,без НДС",
      "C-2,Экспорт,5000,02202001001000001,0%",
      "C-3,Сок,7000,1234,12",
      "C-4,Чай,9000,,15",
      "C-5,Старый,1000,,",
    ]) });
    expect(r.success).toBe(3);
    expect(r.errors).toEqual([
      "Строка 4: ИКПУ «1234»: ИКПУ (МХИК) — 17 цифр",
      "Строка 5: Ставка НДС «15»: допустимо 12, 0 или «без НДС»",
    ]);
    expect(await product("C-1")).toMatchObject({ vatRate: "exempt", ikpu: null });
    expect(await product("C-2")).toMatchObject({ vatRate: "vat0", ikpu: "02202001001000001" });
    expect(await product("C-5")).toMatchObject({ vatRate: null, ikpu: null, packageCode: null });
    expect(await product("C-3")).toBeUndefined();
  });

  it("магазины: ИНН, ПИНФЛ, «да»/«нет»; кривой ИНН и «возможно» — отказ строке; без столбцов — как раньше", async () => {
    const api = await importer();
    const tpl = await api.downloadTemplate({ type: "shops" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(tpl.base64, "base64") as unknown as ArrayBuffer);
    const headers = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1).map(String);
    expect(headers).toEqual(expect.arrayContaining(["ИНН/ПИНФЛ (9 или 14 цифр)", "Плательщик НДС (да/нет)"]));
    expect(wb.worksheets[0].getColumn(headers.indexOf("ИНН/ПИНФЛ (9 или 14 цифр)") + 1).numFmt).toBe("@");

    const r = await api.executeImport({ type: "shops", filename: "s.csv", base64: csv([
      "Название,ИНН/ПИНФЛ (9 или 14 цифр),Плательщик НДС (да/нет)",
      "Альфа ООО,301 111 111,да",
      "ИП Бета,31234567890123,нет",
      "Гамма,12345,да",
      "Дельта,,возможно",
    ]) });
    expect(r.success).toBe(2);
    expect(r.errors).toEqual([
      "Строка 4: ИНН/ПИНФЛ «12345»: ИНН — 9 цифр, ПИНФЛ — 14 цифр",
      "Строка 5: Плательщик НДС «возможно»: напишите «да» или «нет»",
    ]);
    expect(await shop("Альфа ООО")).toMatchObject({ taxId: "301111111", vatPayer: true });
    expect(await shop("ИП Бета")).toMatchObject({ taxId: "31234567890123", vatPayer: false });
    expect(await shop("Гамма")).toBeUndefined();

    const old = await api.executeImport({ type: "shops", filename: "old.csv", base64: csv(["Название,Телефон", "Эпсилон,+998900000009"]) });
    expect(old.success).toBe(1);
    expect(await shop("Эпсилон")).toMatchObject({ taxId: null, vatPayer: false });
  });
});

/**
 * Дополнительные штрих-коды товара на настоящей MySQL.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У товара был один штрих-код. Сок второго поставщика, блок и пачка, новая
 * партия этикеток — всё это сканер не находил, и оператор заводил товар-
 * двойник: остаток расползался по двум карточкам. Поиск по скану шёл
 * `.limit(1)` без порядка — при двух товарах с одним кодом ответ решала база.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Через настоящие ручки product / stockCount / import:
 *   • по дополнительному коду товар находят скан (findByBarcode), поиск
 *     списка и каталога; коды приходят списком в list, listAll, getById и
 *     в строках инвентаризации;
 *   • порядок по скану: основной штрих-код выше дополнительного, действующий
 *     товар выше снятого — ответ один и тот же, а не какой придётся;
 *   • один код — один товар в обе стороны: дополнительный против чужого
 *     основного и чужого дополнительного, основной против чужого
 *     дополнительного — при создании, правке и импорте; отказ называет товар
 *     и ничего не пишет; гонку мимо проверки ловит уникальный индекс;
 *   • соседняя организация: её коды нам не мешают и к нам не ведут.
 *
 * Это нельзя проверить на заглушке: подзапрос по product_barcodes, порядок
 * выдачи и уникальный индекс — сырой SQL и свойство базы.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { cache } from "../../lib/cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const csv = (lines: string[]) => Buffer.from(lines.join("\n"), "utf-8").toString("base64");

describe.skipIf(!hasRealDb)("дополнительные штрих-коды товара", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    // Номера организаций после очистки идут заново: каталог прошлого теста
    // в памяти ответил бы за этот.
    cache.invalidatePrefix("products:");
    s = await seed();
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  const productsAs = async (tenantId = s.tenantId, userId = operatorId, role = "operator") =>
    (await import("../../product-router")).productRouter.createCaller(ctxFor(db, tenantId, userId, role));
  const codesOf = async (productId: number) =>
    (await db.select({ barcode: schema.productBarcodes.barcode }).from(schema.productBarcodes)
      .where(eq(schema.productBarcodes.productId, productId)).orderBy(schema.productBarcodes.id)).map(r => r.barcode);
  const mainOf = async (productId: number) =>
    (await db.select({ barcode: schema.products.barcode }).from(schema.products).where(eq(schema.products.id, productId)))[0]?.barcode;

  it("по дополнительному коду находят скан, поиск и каталог; коды приходят списком везде, где их ищет сканер", async () => {
    const api = await productsAs();
    const { id } = await api.create({
      code: "J-1", name: "Сок яблочный", unitPrice: "12000", barcode: "4870000000017",
      // Пустая строка, повтор и сам основной отбрасываются — хранится то, что находит товар.
      extraBarcodes: ["4870000000024", " 4870000000031 ", "", "4870000000024", "4870000000017"],
    });
    expect(await codesOf(id)).toEqual(["4870000000024", "4870000000031"]);

    expect(await api.findByBarcode({ barcode: "4870000000031" })).toMatchObject({ id, name: "Сок яблочный" });
    expect(await api.findByBarcode({ barcode: "4870000000017" })).toMatchObject({ id });
    // Часть кода — не находка: скан сравнивается целиком.
    expect(await api.findByBarcode({ barcode: "487000000003" })).toBeNull();

    const listed = await api.list({ search: "4870000000024" });
    expect(listed.data.map(p => p.id)).toEqual([id]);
    expect(listed.data[0].barcodes).toEqual(["4870000000024", "4870000000031"]);

    const catalog = await api.listAll();
    expect(catalog.find(p => p.id === id)?.barcodes).toEqual(["4870000000024", "4870000000031"]);
    // Товар без дополнительных — пустой список, а не отсутствие поля.
    expect(catalog.find(p => p.id === s.productId)?.barcodes).toEqual([]);
    expect((await api.listAll({ search: "4870000000031" })).map(p => p.id)).toEqual([id]);

    expect((await api.getById({ id }))?.barcodes).toEqual(["4870000000024", "4870000000031"]);

    // Строки инвентаризации — сканер ищет в них по тем же кодам.
    const counts = (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const { id: countId } = await counts.create({ warehouseId: s.warehouseId });
    const doc = await counts.get({ id: countId });
    expect(doc.items.find(i => i.productId === id)?.barcodes).toEqual(["4870000000024", "4870000000031"]);
    expect(doc.items.find(i => i.productId === s.productId)?.barcodes).toEqual([]);
  });

  it("скан ранжирован: основной штрих-код выше дополнительного, действующий товар выше снятого", async () => {
    /*
      Такие данные новыми ручками не завести — проверки не дадут, — но они
      бывают: основной штрих-код исторически не уникален. Пишем их прямо в
      базу, младшим номером вперёд: без порядка база отдаёт первым именно его.
    */
    await db.insert(schema.productBarcodes).values({ tenantId: s.tenantId, productId: s.productId, barcode: "SAME-1" });
    await db.update(schema.products).set({ barcode: "SAME-1" }).where(eq(schema.products.id, s.secondProductId));
    const api = await productsAs();
    expect((await api.findByBarcode({ barcode: "SAME-1" }))?.id).toBe(s.secondProductId);

    // Два товара с одним основным: снятый (младший) уступает действующему.
    await db.update(schema.products).set({ barcode: "TWIN-1", status: "inactive" }).where(eq(schema.products.id, s.productId));
    const [p3] = await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-3", name: "Новая карточка", unitPrice: "100.00", barcode: "TWIN-1" });
    expect((await api.findByBarcode({ barcode: "TWIN-1" }))?.id).toBe(Number(p3.insertId));
  });

  it("один код — один товар: создание и правка отказывают в обе стороны, называют товар и ничего не пишут", async () => {
    const api = await productsAs();
    await db.update(schema.products).set({ barcode: "MAIN-1" }).where(eq(schema.products.id, s.productId));
    await api.update({ id: s.secondProductId, extraBarcodes: ["EXTRA-2"] });
    expect(await codesOf(s.secondProductId)).toEqual(["EXTRA-2"]);
    const productsBefore = await countOf("products");

    // Дополнительный против чужого основного.
    await expect(api.create({ code: "N-1", name: "Новый", unitPrice: "10", extraBarcodes: ["main-1"] }))
      .rejects.toThrow("Штрих-код «MAIN-1» уже стоит у товара «Товар». Уберите его там или укажите другой.");
    // Дополнительный против чужого дополнительного.
    await expect(api.create({ code: "N-1", name: "Новый", unitPrice: "10", extraBarcodes: ["EXTRA-2"] }))
      .rejects.toThrow("Штрих-код «EXTRA-2» уже стоит у товара «Второй товар»");
    // Основной против чужого дополнительного.
    await expect(api.create({ code: "N-1", name: "Новый", unitPrice: "10", barcode: "EXTRA-2" }))
      .rejects.toThrow("Штрих-код «EXTRA-2» уже стоит у товара «Второй товар»");
    expect(await countOf("products")).toBe(productsBefore);

    // Правка: те же три стороны, и прежние коды на месте.
    await expect(api.update({ id: s.productId, extraBarcodes: ["EXTRA-2"] })).rejects.toThrow(/уже стоит у товара «Второй товар»/);
    await expect(api.update({ id: s.productId, barcode: "EXTRA-2" })).rejects.toThrow(/уже стоит у товара «Второй товар»/);
    await expect(api.update({ id: s.secondProductId, extraBarcodes: ["EXTRA-2", "MAIN-1"] })).rejects.toThrow(/«MAIN-1» уже стоит у товара «Товар»/);
    expect(await mainOf(s.productId)).toBe("MAIN-1");
    expect(await codesOf(s.productId)).toEqual([]);
    expect(await codesOf(s.secondProductId)).toEqual(["EXTRA-2"]);

    // Свои коды себе не мешают: основной уходит из дополнительных, а не отказывает.
    await api.update({ id: s.secondProductId, barcode: "EXTRA-2", extraBarcodes: ["EXTRA-2", "EXTRA-3"] });
    expect(await mainOf(s.secondProductId)).toBe("EXTRA-2");
    expect(await codesOf(s.secondProductId)).toEqual(["EXTRA-3"]);
    // Сменили только основной на свой дополнительный — он уходит из списка сам.
    await api.update({ id: s.secondProductId, barcode: "EXTRA-3" });
    expect(await codesOf(s.secondProductId)).toEqual([]);
    // Пустой основной — штрих-кода нет; правка без новых полей кодов не трогает.
    await api.update({ id: s.secondProductId, extraBarcodes: ["EXTRA-4"] });
    await api.update({ id: s.secondProductId, barcode: "" });
    await api.update({ id: s.secondProductId, name: "Второй товар (обновлён)" });
    expect(await mainOf(s.secondProductId)).toBeNull();
    expect(await codesOf(s.secondProductId)).toEqual(["EXTRA-4"]);
  });

  it("гонку мимо проверки ловит уникальный индекс — с понятным отказом, а не пятисоткой", async () => {
    const { replaceExtraBarcodes } = await import("../../services/product-barcodes");
    await db.insert(schema.productBarcodes).values({ tenantId: s.tenantId, productId: s.productId, barcode: "RACE-1" });
    await expect(db.transaction(tx => replaceExtraBarcodes(tx, s.tenantId, s.secondProductId, ["RACE-1"])))
      .rejects.toThrow("Этот штрих-код только что поставили другому товару. Обновите карточку и проверьте коды.");
    expect(await codesOf(s.secondProductId)).toEqual([]);
    expect(await codesOf(s.productId)).toEqual(["RACE-1"]);
  });

  it("импорт: основной штрих-код, уже стоящий дополнительным у другого товара, — отказ строке, соседние встают", async () => {
    await (await productsAs()).update({ id: s.productId, extraBarcodes: ["IMP-EXTRA"] });
    const importer = (await import("../../import-router")).importRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const r = await importer.executeImport({ type: "products", filename: "p.csv", base64: csv([
      "Код,Название,Штрихкод,Цена продажи (сум)",
      "I-1,Чай,IMP-OK,9000",
      "I-2,Кофе,imp-extra,15000",
    ]) });
    expect(r.success).toBe(1);
    expect(r.errors).toEqual(["Строка 3: штрих-код «imp-extra» уже стоит у товара «Товар»"]);
    expect(await countOf("products", "code = 'I-2'")).toBe(0);
    expect(await countOf("products", "code = 'I-1' AND barcode = 'IMP-OK'")).toBe(1);
  });

  it("соседняя организация: её коды нам не мешают и к нам не ведут", async () => {
    const [otherOp] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой оператор", email: "op2@test.local", passwordHash: "x", role: "operator" });
    const other = await productsAs(s.otherTenantId, Number(otherOp.insertId));
    const { id: theirs } = await other.create({ code: "T-1", name: "Чужой товар", unitPrice: "10", barcode: "SHARED-MAIN", extraBarcodes: ["SHARED-EXTRA"] });

    const api = await productsAs();
    // Чужой код к нам не ведёт — ни сканом, ни поиском.
    expect(await api.findByBarcode({ barcode: "SHARED-EXTRA" })).toBeNull();
    expect((await api.list({ search: "SHARED-EXTRA" })).data).toEqual([]);
    expect(await api.listAll({ search: "SHARED-EXTRA" })).toEqual([]);

    // И не мешает: тот же код у нас — свой, в обе стороны.
    await api.update({ id: s.productId, extraBarcodes: ["SHARED-EXTRA", "SHARED-MAIN"] });
    await api.update({ id: s.secondProductId, barcode: "SHARED-EXTRA-2" });
    expect(await codesOf(s.productId)).toEqual(["SHARED-EXTRA", "SHARED-MAIN"]);
    expect((await api.findByBarcode({ barcode: "SHARED-EXTRA" }))?.id).toBe(s.productId);
    expect((await other.findByBarcode({ barcode: "SHARED-EXTRA" }))?.id).toBe(theirs);
    // Чужой товар: его карточку наша правка не достаёт.
    await expect(api.update({ id: theirs, extraBarcodes: ["HIJACK"] })).rejects.toThrow("Товар не найден");
    expect(await codesOf(theirs)).toEqual(["SHARED-EXTRA"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Клиент OData 1С — против эмулятора платформы (helpers/fake-onec.ts).
 *
 * Здесь проверяется договор с 1С, а не наша логика обмена: адрес, авторизация,
 * форма выборки, постраничность, объект по ключу, создание с Ref_Key,
 * проведение, срез регистра, разбор $metadata и текст ошибки 1С вместо «500».
 */
const { fake } = vi.hoisted(() => ({ fake: { current: null as null | { fetch: (u: string, i?: RequestInit) => Promise<Response> } } }));
vi.mock("../lib/safe-fetch", () => ({ safeFetch: (u: string, i?: RequestInit) => fake.current!.fetch(u, i) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { FakeOneC } from "./helpers/fake-onec";
import { OneCBridge, OneCError, normalizeOdataUrl, guid, str } from "../lib/onec-bridge";
import { requiredFields } from "../lib/onec-presets";

let onec: FakeOneC;
const bridge = () => new OneCBridge({ url: "http://onec.example.test/base", username: "odata", password: "secret", preset: "bp_uz" });

beforeEach(() => {
  onec = new FakeOneC();
  fake.current = onec;
});

describe("адрес публикации", () => {
  it("к адресу базы дописывается /odata/standard.odata, готовый адрес не удваивается", () => {
    expect(normalizeOdataUrl("http://host/base")).toBe("http://host/base/odata/standard.odata");
    expect(normalizeOdataUrl("http://host/base/")).toBe("http://host/base/odata/standard.odata");
    expect(normalizeOdataUrl("http://host/base/odata")).toBe("http://host/base/odata/standard.odata");
    expect(normalizeOdataUrl("http://host/base/odata/standard.odata/")).toBe("http://host/base/odata/standard.odata");
  });

  it("guid и строка в $filter экранируются", () => {
    expect(guid("abc")).toBe("guid'abc'");
    expect(str("O'Neil")).toBe("'O''Neil'");
  });
});

describe("чтение", () => {
  it("выборка идёт с $format=json и разбирает { value }", async () => {
    onec.add("Catalog_Организации", { Description: "ООО Ромашка" });
    const rows = await bridge().query<{ Description: string }>("Catalog_Организации", { $select: "Ref_Key,Description" });
    expect(rows.map(r => r.Description)).toEqual(["ООО Ромашка"]);
    expect(onec.requests[0].path).toBe("Catalog_Организации");
  });

  it("queryAll тянет постранично, пока страница полная", async () => {
    for (let i = 0; i < 7; i++) onec.add("Catalog_Номенклатура", { Description: `Товар ${i}`, Code: String(i) });
    const rows = await bridge().queryAll("Catalog_Номенклатура", {}, 3);
    expect(rows).toHaveLength(7);
    // 3 + 3 + 1: третья страница неполная — четвёртой не было.
    expect(onec.requests.filter(r => r.path === "Catalog_Номенклатура")).toHaveLength(3);
  });

  it("объект по ключу; отсутствующий — null, а не исключение", async () => {
    const row = onec.add("Catalog_Склады", { Description: "Основной" });
    expect(await bridge().getOne<{ Description: string }>("Catalog_Склады", String(row.Ref_Key))).toMatchObject({ Description: "Основной" });
    expect(await bridge().getOne("Catalog_Склады", "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("срез последних регистра по условию", async () => {
    onec.add("InformationRegister_ЦеныНоменклатуры", { Номенклатура_Key: "n1", ТипЦен_Key: "opt", Цена: 100 });
    onec.add("InformationRegister_ЦеныНоменклатуры", { Номенклатура_Key: "n1", ТипЦен_Key: "retail", Цена: 130 });
    const rows = await bridge().sliceLast<{ Цена: number }>("InformationRegister_ЦеныНоменклатуры", "ТипЦен_Key eq guid'opt'");
    expect(rows.map(r => r.Цена)).toEqual([100]);
  });
});

describe("запись", () => {
  it("создание возвращает объект с Ref_Key, проведение идёт без оперативного режима", async () => {
    const b = bridge();
    const doc = await b.create("Document_РеализацияТоваровУслуг", { Комментарий: "тест" });
    expect(doc.Ref_Key).toMatch(/[0-9a-f-]{36}/);
    await b.post("Document_РеализацияТоваровУслуг", doc.Ref_Key);
    expect(onec.posted).toEqual([doc.Ref_Key]);
    expect(onec.requests.at(-1)?.path).toBe(`Document_РеализацияТоваровУслуг(guid'${doc.Ref_Key}')/Post`);
    const raw = onec.requests.at(-1);
    expect(raw?.method).toBe("POST");
  });

  it("незнакомое свойство — текст ошибки из 1С, а не «HTTP 400»", async () => {
    await expect(bridge().create("Catalog_Склады", { НетТакогоПоля: 1 })).rejects.toThrow(/1С: Свойство НетТакогоПоля не найдено/);
  });
});

describe("структура и ошибки", () => {
  it("$metadata разбирается в наборы с полями; healthCheck считает наборы", async () => {
    const meta = await bridge().metadata();
    expect(meta["Catalog_Номенклатура"].has("Артикул")).toBe(true);
    expect(meta["Document_РеализацияТоваровУслуг"].has("Товары")).toBe(true);
    const health = await bridge().healthCheck();
    expect(health.ok && health.sets).toBeGreaterThan(5);
  });

  it("каждое имя пресета bp_uz есть в эмуляторе — иначе проверка структуры отказала бы на первом клиенте", async () => {
    const meta = await bridge().metadata();
    const missing = requiredFields(bridge().names).filter(f => !meta[f.set]?.has(f.field));
    expect(missing).toEqual([]);
  });

  it("неверный пароль — понятный отказ со статусом 401", async () => {
    const wrong = new OneCBridge({ url: "http://onec.example.test/base", username: "odata", password: "bad" });
    const err = await wrong.query("Catalog_Склады").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OneCError);
    expect((err as OneCError).status).toBe(401);
    expect((err as OneCError).message).toMatch(/логин или пароль/);
  });

  it("нет набора — 404 с подсказкой про OData", async () => {
    const err = await bridge().query("Catalog_Несуществующий").catch((e: unknown) => e);
    expect((err as OneCError).status).toBe(404);
    expect((err as OneCError).message).toMatch(/1С: Нет набора/);
  });

  it("healthCheck не бросает — возвращает текст", async () => {
    onec.intercept = () => new Response("boom", { status: 500 });
    const h = await bridge().healthCheck();
    expect(h).toEqual({ ok: false, error: "1С: HTTP 500" });
  });
});

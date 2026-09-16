// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  printUzWaybill, printBatchInvoices, printLoadingList, COPY_LABELS,
  type OrderDocData, type BatchOrderData, type LoadingListData,
} from "@/lib/documents";

/**
 * Накладная — в двух экземплярах, загрузочный лист — с заказами.
 *
 * ── Что было ─────────────────────────────────────────────────────────────────
 *
 * Пачка накладных печатала по одному экземпляру на заказ сплошной лентой;
 * расходная (УЗ) — два, но подписанных «для складчика» и «для шофёра»: оба
 * оставались у поставщика, магазину не доставалось ничего, и подписанной
 * бумаги — единственного доказательства, что товар отдан, — не возвращалось.
 *
 * Загрузочный лист печатал только сводку по товарам: куда везти, кому
 * звонить, сколько взять денег — этого на бумаге не было. И печатался он
 * один раз, из окна создания: «Готово, без печати» — и лист без бумаги
 * навсегда.
 *
 * ── Что стережётся ───────────────────────────────────────────────────────────
 *
 *   · каждая накладная — дважды: «1 из 2 — покупателю», «2 из 2 —
 *     возвращается поставщику с подписью»; между ними линия отреза;
 *   · в пачке каждый заказ на своём листе — половина соседнего заказа не
 *     уедет в чужой магазин;
 *   · в загрузочном листе есть таблица заказов: магазин, адрес, телефон,
 *     сумма, оплата словом, долг; дата — дата листа, а не печати;
 *   · «Погрузочные листы» умеют печатать лист повторно через ручку
 *     loadingListPrintData, и ручка есть в маршрутизаторе.
 */
let written = "";
beforeEach(() => {
  written = "";
  const fakeWindow = {
    document: { write: (html: string) => { written += html; }, close: () => {} },
    print: () => {}, close: () => {}, onload: null as unknown,
  };
  vi.stubGlobal("open", () => fakeWindow);
});
const text = () => written.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

const COMPANY = { name: "ООО Ромашка", inn: "301234567", address: "Ургенч" };

const waybill = (): OrderDocData => ({
  number: "ORD-001", date: "01.09.2026", seller: COMPANY, buyer: { name: "Магазин Альфа" },
  items: [{ name: "Печенье", code: "P-1", unit: "pcs", qty: 10, price: 12000, total: 120000 }],
  subtotal: 120000, total: 120000, currency: "сум",
});

const batchOrder = (id: number, num: string, shop: string, sum: string): BatchOrderData => ({
  id, orderNumber: num, status: "delivered", total: sum, subtotal: sum, discount: "0",
  notes: null, createdAt: new Date("2026-09-01T10:00:00Z"),
  shopId: id, shopName: shop, shopAddress: "ул. Беруний, 41", shopCity: "Ургенч",
  shopPhone: "+998901112233", shopDebt: "0", shopDebtAmount: 0,
  agentName: "Азиз", territoryName: null, courierName: null,
  paymentMethod: "cash", invoicePrintedAt: null,
  items: [{ productId: id, quantity: "10", unitPrice: "10000", costPrice: "8000", subtotal: sum, productName: "Печенье", productCode: "P-" + id, unit: "pcs" }],
  paymentHistory: [],
});
const batch = [batchOrder(1, "ORD-001", "Магазин Альфа", "100000"), batchOrder(2, "ORD-002", "Магазин Бета", "50000")];

describe("накладная в двух экземплярах", () => {
  it("расходная (УЗ): экземпляр покупателю и экземпляр поставщику, между ними отрез", () => {
    printUzWaybill(waybill());
    const t = text();
    expect(t).toContain(COPY_LABELS[0]);
    expect(t).toContain(COPY_LABELS[1]);
    expect(count(t, "РАСХОДНАЯ НАКЛАДНАЯ")).toBe(2);
    expect(count(written, "линия отреза")).toBe(1);
    // Прежние подписи оставляли оба экземпляра у поставщика.
    expect(t).not.toMatch(/ШОФ[ЁЕ]Р|СКЛАДЧИК/);
  });

  it("подписи экземпляров говорят, кому бумага и что с ней делать", () => {
    expect(COPY_LABELS[0]).toMatch(/1 ИЗ 2/);
    expect(COPY_LABELS[0]).toMatch(/ПОКУПАТЕЛЮ/);
    expect(COPY_LABELS[1]).toMatch(/2 ИЗ 2/);
    expect(COPY_LABELS[1]).toMatch(/ПОДПИСЬЮ/);
  });

  it("пачка: каждый заказ дважды, каждый заказ на своём листе", () => {
    printBatchInvoices(batch, { pageBreakPerOrder: false } as never, COMPANY, "сум");
    const t = text();
    expect(count(t, "Накладная № ORD-001")).toBe(2);
    expect(count(t, "Накладная № ORD-002")).toBe(2);
    expect(count(t, COPY_LABELS[0])).toBe(2);
    expect(count(t, COPY_LABELS[1])).toBe(2);
    expect(count(written, "линия отреза")).toBe(2);
    // Между заказами — разрыв страницы, даже если настройка просила ленту.
    expect(count(written, "page-break-before:always")).toBe(1);
    // Первый заказ целиком раньше второго: экземпляры не перемешаны.
    expect(t.lastIndexOf("ORD-001")).toBeLessThan(t.indexOf("ORD-002"));
  });

  it("ТТН — тоже в двух экземплярах", () => {
    printBatchInvoices([batch[0]], {} as never, COMPANY, "сум", "ttn");
    const t = text();
    expect(count(t, "ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ")).toBe(2);
    expect(t).toContain(COPY_LABELS[1]);
  });
});

describe("загрузочный лист: заказы и дата", () => {
  const list: LoadingListData = {
    listId: 7, listNumber: "ZL-20260905-AB12", createdAt: "2026-09-05T06:00:00.000Z",
    totalOrders: 2, totalItems: 30, totalWeight: 12,
    orders: [
      { id: 1, orderNumber: "ORD-001", shopName: "Альфа", shopAddress: "ул. Беруний, 41", shopCity: "Ургенч", shopPhone: "+998 91 100 00 03",
        shopGpsLat: null, shopGpsLng: null, shopDebt: "320000", agentId: 1, agentName: "Азиз", territoryName: null, courierName: null, paymentMethod: "cash", total: "100000" },
      { id: 2, orderNumber: "ORD-002", shopName: "Бета", shopAddress: "Хонқа йўли, 5", shopCity: "Ургенч", shopPhone: null,
        shopGpsLat: null, shopGpsLng: null, shopDebt: "0", agentId: 1, agentName: "Азиз", territoryName: null, courierName: null, paymentMethod: "debt", total: "50000" },
    ],
    items: [{ productId: 1, productName: "Печенье", productCode: "P-1", unit: "pcs", unitWeight: "0.4", totalQty: "30", totalPrice: "150000" }],
    itemsByAgent: [{ productId: 1, productName: "Печенье", productCode: "P-1", unit: "pcs", agentId: 1, agentName: "Азиз", totalQty: "30" }],
  };

  it("сводный лист перечисляет заказы: магазин, адрес, телефон, сумма, оплата словом, долг", () => {
    printLoadingList(list, "aggregated", "сум");
    const t = text();
    expect(t).toContain("ЗАКАЗЫ В ЛИСТЕ — 2");
    expect(t).toContain("Альфа");
    expect(t).toContain("Ургенч, ул. Беруний, 41");
    expect(t).toContain("+998 91 100 00 03");
    expect(t).toContain("Наличные");
    expect(t).toContain("В долг");
    expect(t).not.toContain(" cash ");
    expect(t).toContain("320 000");
    expect(t).toContain("Принял экспедитор");
  });

  it("дата на листе — дата составления, а не сегодняшняя", () => {
    printLoadingList(list, "aggregated", "сум");
    expect(text()).toContain("05.09.2026");
    written = "";
    printLoadingList(list, "byRoute", "сум");
    expect(text()).toContain("05.09.2026");
  });

  it("без даты составления печатается сегодняшняя, а не «Invalid Date»", () => {
    printLoadingList({ ...list, createdAt: null }, "aggregated", "сум");
    expect(text()).not.toContain("Invalid");
    expect(text()).toContain(new Date().toLocaleDateString("ru-RU"));
  });
});

describe("лист печатается повторно из «Погрузочных листов»", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("экран зовёт ручку и печать", () => {
    const modal = read("src/components/orders/LoadingListsModal.tsx");
    expect(modal).toContain("loadingListPrintData");
    expect(modal).toContain("printLoadingList(");
    expect(modal).toContain("list-print-");
  });

  it("ручка есть в маршрутизаторе и ведёт в службу", () => {
    const router = read("api/order-router.ts");
    expect(router).toMatch(/loadingListPrintData:\s*operatorQuery/);
    expect(router).toContain("LoadingListService.getForPrint(");
  });
});

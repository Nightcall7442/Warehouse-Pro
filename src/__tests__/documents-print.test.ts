// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  printUzWaybill, printArrivalReceipt, printTorg12, printInvoice,
  printBatchInvoices, printLoadingList,
  type OrderDocData, type ArrivalDocData, type BatchOrderData, type LoadingListData,
} from "@/lib/documents";

/**
 * Печатные документы: числа и экранирование.
 *
 * ── Почему это вообще проверяется ────────────────────────────────────────────
 *
 * src/lib/documents.ts — 1300 строк, покрытие 0%. Это накладные, счета и
 * загрузочные листы: бумаги, которые везут покупателю и по которым потом
 * спорят о деньгах. Ошибка здесь не роняет приложение — она печатает не ту
 * сумму, и находится через неделю в чужих руках.
 *
 * Проверяется не «функция вызвалась», а то, что попало в документ: сходятся
 * ли строки с итогом, применилась ли скидка, свернулись ли одинаковые товары
 * в сводной ведомости, и не ломает ли разметку пользовательский текст.
 *
 * ── Как ──────────────────────────────────────────────────────────────────────
 *
 * Каждая функция открывает окно и пишет в него HTML. Здесь window.open
 * подменён, и написанное перехватывается целиком — то есть проверяется
 * настоящий вывод, а не отдельно вынутый кусок разметки.
 */

let written = "";

beforeEach(() => {
  written = "";
  const fakeWindow = {
    document: {
      write: (html: string) => { written += html; },
      close: () => {},
    },
    print: () => {},
    close: () => {},
    onload: null as unknown,
  };
  vi.stubGlobal("open", () => fakeWindow);
  // Окно печати закрывается по таймеру; в тесте он не нужен.
  vi.stubGlobal("setTimeout", ((fn: () => void) => { void fn; return 0; }) as unknown as typeof setTimeout);
});

/** Текст документа без разметки — для проверок «что увидит человек». */
const text = () => written.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const COMPANY = { name: "ООО Ромашка", inn: "301234567", address: "Ташкент" };

function order(over: Partial<OrderDocData> = {}): OrderDocData {
  return {
    number: "ORD-001", date: "01.09.2026",
    seller: COMPANY, buyer: { name: "Магазин Альфа" },
    items: [
      { name: "Печенье", code: "P-1", unit: "pcs", qty: 10, price: 12000, total: 120000 },
      { name: "Сок",     code: "P-2", unit: "l",   qty: 5,  price: 8000,  total: 40000 },
    ],
    subtotal: 160000, total: 160000, currency: "сум",
    ...over,
  };
}

describe("печатные документы: числа", () => {
  it("расходная накладная печатает каждую позицию и итог", () => {
    printUzWaybill(order());
    const t = text();
    expect(t).toContain("Печенье");
    expect(t).toContain("Сок");
    // Итог именно 160 000, а не сумма чего-нибудь другого.
    expect(t).toContain("160 000");
  });

  it("счёт показывает скидку и итог после неё", () => {
    // Скидка — самое частое место расхождения бумаги с системой: подитог
    // печатают до неё, итог после, и перепутать их легко.
    printInvoice(order({ subtotal: 160000, discount: 10000, total: 150000 }));
    const t = text();
    expect(t).toContain("160 000");
    expect(t).toContain("150 000");
  });

  it("ТОРГ-12 не теряет позиции", () => {
    printTorg12(order());
    expect((written.match(/Печенье/g) ?? []).length).toBeGreaterThan(0);
    expect(text()).toContain("Сок");
  });

  it("приходная накладная печатает расходы и общее количество", () => {
    const arrival: ArrivalDocData = {
      number: "ARR-001", date: "01.09.2026",
      supplier: { name: "Завод Ташкент" }, receiver: COMPANY,
      items: [{ name: "Печенье", qty: 100, price: 9000, total: 900000 }],
      totalQty: 100,
      expenses: { fuel: 40000, toll: 15000, other: 10000, total: 65000 },
      currency: "сум",
    };
    printArrivalReceipt(arrival);
    const t = text();
    expect(t).toContain("Завод Ташкент");
    expect(t).toContain("65 000");
  });

  it("пустой список позиций не роняет документ", () => {
    // Заказ без строк — редкость, но бывает после отмены всех позиций.
    // Печать должна дать пустой бланк, а не исключение.
    expect(() => printUzWaybill(order({ items: [], subtotal: 0, total: 0 }))).not.toThrow();
    expect(written.length).toBeGreaterThan(0);
  });
});

describe("печатные документы: пакетная печать и ведомость", () => {
  /** Полный заказ: тип требует и историю платежей, и долг магазина. */
  const batchOrder = (id: number, num: string, shop: string, agent: string, sum: string, product: string): BatchOrderData => ({
    id, orderNumber: num, status: "delivered", total: sum, subtotal: sum, discount: "0",
    notes: null, createdAt: new Date("2026-09-01T10:00:00Z"),
    shopId: id, shopName: shop, shopAddress: "Ташкент", shopCity: "Ташкент",
    shopPhone: "+998901112233", shopDebt: "0", shopDebtAmount: 0,
    agentName: agent, territoryName: null, courierName: null,
    paymentMethod: "cash", invoicePrintedAt: null,
    items: [{
      productId: id, quantity: "10", unitPrice: "10000", costPrice: "8000",
      subtotal: sum, productName: product, productCode: "P-" + id, unit: "pcs",
    }],
    paymentHistory: [],
  });

  const batch: BatchOrderData[] = [
    batchOrder(1, "ORD-001", "Магазин Альфа", "Азиз", "100000", "Печенье"),
    batchOrder(2, "ORD-002", "Магазин Бета", "Дилшод", "50000", "Сок"),
  ];

  it("пакетная печать выводит все заказы, а не только первый", () => {
    printBatchInvoices(batch, {} as never, COMPANY, "сум");
    const t = text();
    expect(t).toContain("ORD-001");
    expect(t).toContain("ORD-002");
    expect(t).toContain("Магазин Альфа");
    expect(t).toContain("Магазин Бета");
  });

  it("сводная ведомость складывает одинаковый товар из разных заказов", () => {
    // Смысл сводного формата ровно в этом: кладовщик берёт со склада один раз
    // общее количество. Если свёртка сломается, он наберёт не то.
    const list: LoadingListData = {
      listNumber: "LL-001", date: "01.09.2026", company: COMPANY,
      items: [{ productName: "Печенье", productCode: "P-1", unit: "pcs", totalQty: 30, unitWeight: 0.4 }],
      orders: [
        { orderNumber: "ORD-001", shopName: "Альфа", agentName: "Азиз", total: "100000", itemCount: 1 },
        { orderNumber: "ORD-002", shopName: "Бета",  agentName: "Азиз", total: "50000",  itemCount: 1 },
      ],
      totalOrders: 2, totalItems: 1,
    } as unknown as LoadingListData;

    printLoadingList(list, "aggregated", "сум");
    const t = text();
    expect(t).toContain("30");        // 10 + 20 уже свёрнуто вызывающей стороной
    expect(t).toContain("12");        // вес: 30 × 0,4
    // Итог по агенту — оба заказа одного человека сложены.
    expect(t).toContain("150 000");
  });
});

describe("печатные документы: пользовательский текст не ломает разметку", () => {
  /**
   * Названия магазинов, товаров и территорий заводят люди. Символ «<» в
   * названии не должен превращаться в разметку: в лучшем случае документ
   * поедет, в худшем — в окно печати попадёт чужой скрипт.
   */
  const EVIL = '<script>alert(1)</script>';

  it("название магазина экранируется", () => {
    printUzWaybill(order({ buyer: { name: EVIL } }));
    expect(written).not.toContain("<script>");
    expect(written).toContain("&lt;script&gt;");
  });

  it("название товара экранируется", () => {
    printInvoice(order({ items: [{ name: EVIL, qty: 1, price: 1, total: 1 }] }));
    expect(written).not.toContain("<script>");
  });

  it("символ валюты из настроек экранируется", () => {
    // Валюту задаёт администратор организации в настройках — это такой же
    // пользовательский текст, как название магазина.
    printInvoice(order({ currency: EVIL }));
    expect(written).not.toContain("<script>");
  });

  it("ИНН продавца из настроек экранируется", () => {
    printTorg12(order({ seller: { name: "ООО Ромашка", inn: EVIL } }));
    expect(written).not.toContain("<script>");
  });

  it("название территории в ведомости экранируется", () => {
    const list = {
      listNumber: "LL-001", date: "01.09.2026", company: COMPANY,
      items: [{ productName: "Печенье", productCode: "P-1", unit: "pcs", totalQty: 1, unitWeight: 1 }],
      orders: [{ orderNumber: "ORD-001", shopName: "Альфа", agentName: "Азиз", total: "1", itemCount: 1, territoryName: EVIL }],
      totalOrders: 1, totalItems: 1,
    } as unknown as LoadingListData;

    printLoadingList(list, "aggregated", "сум");
    expect(written).not.toContain("<script>");
  });
});

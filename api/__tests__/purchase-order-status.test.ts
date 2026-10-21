/**
 * Правила заказа поставщику без базы: куда он может перейти, когда он
 * «принят», в какой валюте его цена ляжет в себестоимость, когда срок оплаты
 * и сколько долга родит приёмка (ADR 0013).
 *
 * Поведение целиком, на реальной базе, — real-db/purchase-order-flow; здесь
 * края, которые там дорого перебирать.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PO_STATUSES, PO_TRANSITIONS, canTransition, poStatusAfterReceipt, priceInTenantCurrency,
  inTenantCurrency, dueDateAfter, receiptDebt, RECEIVING_STATUSES, poStatusLabel,
} from "../services/purchase-order-receipt";

describe("переходы заказа", () => {
  it("согласованный заказ правят только через черновик: правка требует нового согласования", () => {
    expect(canTransition("approved", "draft")).toBe(true);
    expect(canTransition("pending_approval", "draft")).toBe(true);
    // Директор согласует и прямо из черновика — без отправки самому себе.
    expect(canTransition("draft", "approved")).toBe(true);
  });

  it("частично принятый — только закрыть с недовозом или допринять, но не отменить", () => {
    expect(canTransition("partially_received", "cancelled")).toBe(false);
    expect(canTransition("partially_received", "closed")).toBe(true);
    expect(canTransition("partially_received", "draft")).toBe(false);
    // Закрыть с недовозом можно только то, по чему что-то принято.
    expect(canTransition("approved", "closed")).toBe(false);
  });

  it("принятый, закрытый и отменённый — конечные", () => {
    for (const s of ["received", "closed", "cancelled"] as const) {
      expect(PO_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("каждое состояние базы есть в таблице переходов, и переходы ведут только в известные", () => {
    const schema = readFileSync(join(__dirname, "../../db/schema.ts"), "utf8");
    const chunk = schema.slice(schema.indexOf("export const purchaseOrders = mysqlTable"));
    const values = /mysqlEnum\("status",\s*\[([^\]]+)\]/.exec(chunk)![1]
      .split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect([...PO_STATUSES].sort()).toEqual([...values].sort());
    for (const to of Object.values(PO_TRANSITIONS).flat()) expect(PO_STATUSES).toContain(to);
  });

  it("приход проводится по согласованному, частично и полностью принятому — не по черновику", () => {
    expect(RECEIVING_STATUSES).toEqual(["approved", "partially_received", "received"]);
    expect(poStatusLabel("draft")).toBe("черновик");
  });
});

describe("принят или принят частично", () => {
  it("всё заказанное принято — принят; излишек не мешает", () => {
    expect(poStatusAfterReceipt([{ quantity: "10.00", receivedQty: "10.00" }, { quantity: "5", receivedQty: 7 }])).toBe("received");
  });

  it("хоть одна строка недобрана — принят частично", () => {
    expect(poStatusAfterReceipt([{ quantity: "10.00", receivedQty: "10.00" }, { quantity: "5", receivedQty: "4.99" }])).toBe("partially_received");
    expect(poStatusAfterReceipt([{ quantity: "1", receivedQty: "0" }])).toBe("partially_received");
  });
});

describe("цена заказа в валюте организации", () => {
  it("та же валюта — как есть, до тийина", () => {
    expect(priceInTenantCurrency(1234.567, "UZS", "UZS", null)).toBe(1234.57);
    expect(inTenantCurrency("UZS", " uzs ")).toBe(true);
    expect(inTenantCurrency("USD", null)).toBe(false);
  });

  it("доллары в сумы — по курсу заказа; нет курса — нечего подставить", () => {
    expect(priceInTenantCurrency(2.5, "USD", "UZS", 12700)).toBe(31750);
    expect(priceInTenantCurrency(2.5, "USD", "UZS", null)).toBeNull();
    expect(priceInTenantCurrency(2.5, "USD", "UZS", 0)).toBeNull();
  });

  it("сумы в доллары — делением; рублёвой организации не пересчитываем", () => {
    expect(priceInTenantCurrency(127000, "UZS", "USD", 12700)).toBe(10);
    expect(priceInTenantCurrency(10, "USD", "RUB", 12700)).toBeNull();
  });
});

describe("срок оплаты", () => {
  it("день прихода по Ташкенту плюс отсрочка, строкой", () => {
    expect(dueDateAfter("2026-10-01", 10)).toBe("2026-10-11");
    expect(dueDateAfter("2026-12-25", 14)).toBe("2027-01-08");
    expect(dueDateAfter("2026-10-01", 0)).toBe("2026-10-01");
  });

  it("отсрочки нет — срока нет", () => {
    expect(dueDateAfter("2026-10-01", null)).toBeNull();
    expect(dueDateAfter("2026-10-01", undefined)).toBeNull();
    expect(dueDateAfter("2026-10-01", -1)).toBeNull();
  });
});

describe("долг приёмки", () => {
  const lines = new Map([[1, { unitPrice: "80.00" }], [2, { unitPrice: "2.50" }]]);

  it("валюта организации — принятое × себестоимость прихода, а не цена заказа", () => {
    expect(receiptDebt([{ productId: 1, quantity: "6", costPrice: "85.00" }], lines, true)).toBe(510);
  });

  it("другая валюта — принятое × цена заказа", () => {
    expect(receiptDebt([{ productId: 2, quantity: "4", costPrice: "31750.00" }], lines, false)).toBe(10);
  });

  it("излишек входит в долг, нулевые строки — нет", () => {
    expect(receiptDebt([
      { productId: 1, quantity: "12", costPrice: "80" },
      { productId: 2, quantity: "0", costPrice: "999" },
    ], lines, true)).toBe(960);
  });
});

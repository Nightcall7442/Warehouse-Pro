import { describe, it, expect } from "vitest";
import { describeMeta } from "@/lib/audit-text";

/**
 * Подробности записи журнала — словами, а не ключами из кода.
 * Директор видел «amount: 150000 · method: cash · from: shipped»; должен
 * видеть «Сумма: 150 000 сум · Оплата: Наличные · Отгружен → Доставлен».
 */
describe("describeMeta", () => {
  it("деньги, способ оплаты и статусы — словами", () => {
    const s = describeMeta({ amount: "150000.00", method: "cash", from: "shipped", to: "delivered", orderNumber: "ORD-0123" }, "ru");
    expect(s).toContain("Сумма: 150 000 сум");
    expect(s).toContain("Оплата: Наличные");
    expect(s).toContain("Отгружен → Доставлен");
    expect(s).toContain("Заказ: ORD-0123");
    expect(s).not.toMatch(/amount|method|from|to:/);
  });

  it("изменения полей — «поле: было → стало», с названиями полей", () => {
    const s = describeMeta({ changes: { creditLimit: { from: "500000", to: "800000" }, name: { from: "Альфа", to: "Альфа+" } } }, "ru");
    expect(s).toBe("кредитный лимит: 500 000 сум → 800 000 сум · название: Альфа → Альфа+");
  });

  it("узбекский — той же формой", () => {
    const s = describeMeta({ amount: 5000, method: "card", actorRole: "courier" }, "uz");
    expect(s).toContain("Summa: 5 000 сум");
    expect(s).toContain("Rol: ");
    expect(s).not.toContain("actorRole");
  });

  it("служебные номера (shopId, productId) не показываются, неизвестный ключ — как есть, пустое — ничего", () => {
    expect(describeMeta({ shopId: 7, shopName: "Альфа", weirdKey: "x", empty: "", nothing: null }, "ru")).toBe("Магазин: Альфа · weird key: x");
    expect(describeMeta(null, "ru")).toBe("");
    expect(describeMeta({}, "ru")).toBe("");
  });

  it("булево и списки читаются", () => {
    expect(describeMeta({ enabled: true, orderIds: [1, 2, 3] }, "ru")).toBe("Включено: да · Заказы: 1, 2, 3");
    expect(describeMeta({ orderIds: [1, 2, 3, 4, 5, 6, 7] }, "ru")).toBe("Заказы: 7");
  });
});

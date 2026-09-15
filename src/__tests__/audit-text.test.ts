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

/**
 * Второй заход — по снимку владельца (16.09.2026): «agent id: 112 · discount
 * pct: 0 · payment method: cash», «failed: · updated: 1 · new status:
 * delivered», «format: aggregated · list number: ZL-… · total weight:
 * 510.2000000000001». Словарь знал двадцать ключей, сервер пишет восемьдесят.
 * Здесь — настоящие записи и то, как они должны читаться.
 */
describe("describeMeta — все ключи журнала", () => {
  it("создание заказа: без служебного номера агента и нулевой скидки, оплата словом", () => {
    const s = describeMeta({ agentId: 112, actorRole: "agent", discountPct: 0, orderNumber: "№22", paymentMethod: "cash", shopId: 5 }, "ru", "№22 · Ogiljon Sharq");
    expect(s).toBe("Роль: Агент · Оплата: Наличные");
  });

  it("скидка печатается, только когда она есть — процентом", () => {
    expect(describeMeta({ discountPct: 7.5, paymentMethod: "transfer" }, "ru")).toBe("Скидка: 7,5 % · Оплата: Перечисление");
  });

  it("массовая смена статуса: пустой список неудач молчит, статус словом", () => {
    const s = describeMeta({ failed: [], updated: 1, orderIds: [1486], newStatus: "delivered", comment: "" }, "ru");
    expect(s).toBe("Обновлено: 1 · Заказы: 1486 · Новый статус: Доставлен");
  });

  it("лист загрузки: формат словом, номер листа не повторяет заголовок, вес без хвоста дроби", () => {
    const s = describeMeta({ listNumber: "ZL-20260913-0FXY", orderIds: [1587, 1586, 1551, 1548, 1483, 1485], totalWeight: 510.2000000000001, format: "aggregated" }, "ru", "ZL-20260913-0FXY");
    expect(s).toBe("Заказы: 1587, 1586, 1551, 1548, 1483, 1485 · Вес: 510,2 кг · Формат: сводный");
  });

  it("инвентаризация: номер, который уже в заголовке, не повторяется", () => {
    expect(describeMeta({ number: "ИНВ-1", warehouseId: 1 }, "ru", "ИНВ-1")).toBe("");
    expect(describeMeta({ number: "ИНВ-1" }, "ru")).toBe("Номер: ИНВ-1");
  });

  it("правка сотрудника: before/after — «поле: было → стало», статусы и роли словами", () => {
    const s = describeMeta({ before: { role: "agent", status: "active" }, after: { role: "supervisor", status: "active" }, userName: "Феруза" }, "ru");
    expect(s).toBe("роль: Агент → Супервайзер · Сотрудник: Феруза");
  });

  it("правка товара: список изменённых полей — названиями полей", () => {
    expect(describeMeta({ code: "THS1-03", changed: ["unitPrice", "reorderPoint"] }, "ru")).toBe("Код: THS1-03 · Изменено: цена, точка дозаказа");
  });

  it("правка настроек: changed как пары «было → стало»", () => {
    expect(describeMeta({ changed: { companyName: { from: "Серена", to: "Serena Trade" } } }, "ru")).toBe("название компании: Серена → Serena Trade");
  });

  it("корректировка остатка: тип движения словом, остаток после", () => {
    expect(describeMeta({ type: "out", quantity: 12, notes: "бой", productName: "Glim", updatedAvailable: 107 }, "ru"))
      .toBe("Тип: Расход · Количество: 12 · Примечание: бой · Товар: Glim · Свободный остаток: 107");
  });

  it("возврат: решение по товару словом", () => {
    expect(describeMeta({ from: "approved", to: "completed", disposition: "write_off" }, "ru")).toBe("Одобрен → Завершён · Решение по товару: списание");
  });

  it("состав заказа: сумма «было → стало» одной парой, позиций — числом", () => {
    expect(describeMeta({ totalBefore: 100000, totalAfter: 125000, lines: 4 }, "ru")).toBe("Итого: 100 000 сум → 125 000 сум · Позиций: 4");
  });

  it("ключ API: срок днём, права списком; отзыв — статус словом", () => {
    expect(describeMeta({ name: "1С", prefix: "wp_live_ab12", scopes: ["orders:read", "products:read"], expiresAt: "2027-01-31T00:00:00.000Z" }, "ru"))
      .toBe("Название: 1С · Ключ: wp_live_ab12 · Права: orders:read, products:read · Действует до: 31.01.2027");
    expect(describeMeta({ status: "revoked" }, "ru")).toBe("Статус: Отозван");
  });

  it("зарплата: оклад деньгами, комиссия процентом, месяц днём", () => {
    expect(describeMeta({ userName: "Феруза", baseSalary: 3000000, commissionRate: 2.5 }, "ru")).toBe("Сотрудник: Феруза · Оклад: 3 000 000 сум · Комиссия: 2,5 %");
    expect(describeMeta({ userName: "Феруза", month: "2026-09-01", amount: 150000 }, "ru")).toBe("Сотрудник: Феруза · Месяц: 2026-09-01 · Сумма: 150 000 сум");
  });

  it("возврат поставщику: зачтённая сумма деньгами, позиции числом, служебные номера скрыты", () => {
    expect(describeMeta({ paymentId: 9, credited: 450000, currency: "UZS", items: [{ a: 1 }, { a: 2 }], warehouseId: 1 }, "ru")).toBe("Зачтено: 450 000 сум · Валюта: UZS · Позиций: 2");
  });

  it("узбекский: те же записи — по-узбекски", () => {
    expect(describeMeta({ failed: [], updated: 1, newStatus: "delivered" }, "uz")).toBe("Yangilandi: 1 · Yangi holat: Yetkazildi");
    expect(describeMeta({ totalWeight: 510.2, format: "byRoute" }, "uz")).toBe("Vazn: 510,2 kg · Format: marshrut bo'yicha");
  });

  it("в подробностях нет ни одного ключа из кода латиницей", () => {
    const all = describeMeta({
      agentId: 1, discountPct: 3, paymentMethod: "card", failed: [], updated: 2, newStatus: "shipped", listNumber: "L", totalWeight: 1,
      format: "aggregated", userName: "u", oldEmail: "a@b", newEmail: "c@d", by: "x", deactivated: true, denied: false, ROLE: "ceo",
      minQuantity: 5, price: 10, was: 9, applied: true, type: "in", updatedAvailable: 1, prefix: "p", scopes: [], expiresAt: "2026-01-01",
      baseSalary: 1, commissionRate: 1, partner: "P", orders: 3, shortages: [], lines: 2, arrivalNumber: "A-1", disposition: "restock",
    }, "ru");
    // Подпись каждого ключа — русская: латиница остаётся только в значениях.
    for (const part of all.split(" · ")) expect(part.split(":")[0]).not.toMatch(/[a-z]/);
  });
});

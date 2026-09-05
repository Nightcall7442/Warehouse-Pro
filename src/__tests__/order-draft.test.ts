// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft, draftHasWork, type OrderDraft } from "@/pages/NewOrder.draft";

/**
 * Набранный заказ не должен пропадать от промаха пальцем.
 *
 * На шаге «Товары» между кнопкой «Продолжить» и вкладками внизу всего 10
 * точек. Промах по «Каталогу» или «Моим заказам» — и весь заказ исчезал:
 * возврат на «Заказ» открывал пустой первый шаг, ни вопроса «уйти?», ни следа
 * набранного. То же делала перезагрузка страницы.
 *
 * Владелец у записи по той же причине, что и у очереди офлайн-заказов: на
 * складе компьютер бывает общий, и агент Б не должен увидеть набор агента А —
 * тем более отправить его от своего имени.
 */
const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  shopId: 5,
  shopName: "Магазин №1",
  items: [{ productId: 7, productName: "Печенье", unitPrice: "12000", quantity: "3", available: "50", unit: "pcs", unitWeight: 1 }],
  notes: "",
  discount: "0",
  paymentMethod: "cash",
  ...over,
});

beforeEach(() => localStorage.clear());

describe("черновик заказа", () => {
  it("сохранённое возвращается тому же человеку", () => {
    saveDraft(11, draft());
    expect(loadDraft(11)?.shopName).toBe("Магазин №1");
  });

  it("другому вошедшему чужой набор не достаётся", () => {
    // Общий компьютер на складе: агент А набрал половину и вышел.
    saveDraft(11, draft());
    expect(loadDraft(22)).toBeNull();
  });

  it("после отправки заказа черновика не остаётся", () => {
    saveDraft(11, draft());
    clearDraft(11);
    expect(loadDraft(11)).toBeNull();
  });

  it("недобранный черновик не восстанавливается", () => {
    // Без магазина или без единой позиции восстанавливать нечего, а помеха
    // настоящая: подмена приходу из карточки магазина (/orders/new?shopId=5).
    expect(draftHasWork(draft({ shopId: 0 }))).toBe(false);
    expect(draftHasWork(draft({ items: [] }))).toBe(false);
    expect(draftHasWork(draft({ items: [{ productId: 0, productName: "", unitPrice: "0", quantity: "0", available: "0", unit: "pcs", unitWeight: 0 }] }))).toBe(false);
    expect(draftHasWork(draft())).toBe(true);
  });

  it("испорченная запись не роняет экран", () => {
    // Запись от прошлой версии или обрезанная при переполнении хранилища.
    localStorage.setItem("warehouse_pro_order_draft:11", "{не json");
    expect(loadDraft(11)).toBeNull();
    localStorage.setItem("warehouse_pro_order_draft:11", JSON.stringify({ shopId: 5 }));
    expect(loadDraft(11)).toBeNull();
  });
});

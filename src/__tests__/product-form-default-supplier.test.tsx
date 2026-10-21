// @vitest-environment jsdom
/**
 * Новый товар — сразу с поставщиком по умолчанию.
 *
 * Поставщик по умолчанию решает, к кому «Дозаказ» положит товар в заказ.
 * Вписать его можно было только в карточке уже заведённого товара; теперь —
 * и в форме нового. Не выбран — поля в запросе нет (как раньше). Списка
 * поставщиков нет (роль без доступа к ним) — нет и поля.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ProductForm } from "@/components/products/ProductForm";

afterEach(cleanup);
Element.prototype.scrollIntoView = () => {};

const mount = (suppliers?: Array<{ id: number; name: string }>) => {
  const onSave = vi.fn();
  render(<ProductForm onSave={onSave} onCancel={() => {}} isPending={false} lang="ru" suppliers={suppliers} />);
  fireEvent.change(screen.getByTestId("product-code"), { target: { value: "W-1" } });
  fireEvent.change(screen.getByTestId("product-name"), { target: { value: "Вода" } });
  fireEvent.change(screen.getByTestId("product-price"), { target: { value: "4500" } });
  return onSave;
};

describe("форма товара: поставщик по умолчанию", () => {
  it("выбранный поставщик уходит вместе с товаром", () => {
    const onSave = mount([{ id: 5, name: "Завод" }, { id: 6, name: "Мельница" }]);
    fireEvent.click(screen.getByRole("combobox", { name: "Поставщик по умолчанию" }));
    fireEvent.click(screen.getByRole("option", { name: "Мельница" }));
    fireEvent.click(screen.getByTestId("product-save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ code: "W-1", defaultSupplierId: 6 }));
  });

  it("не выбран — поля в запросе нет", () => {
    const onSave = mount([{ id: 5, name: "Завод" }]);
    fireEvent.click(screen.getByTestId("product-save"));
    expect(onSave.mock.calls[0][0]).toMatchObject({ defaultSupplierId: undefined });
  });

  it("поставщиков не дали — поля нет", () => {
    mount();
    expect(screen.queryByRole("combobox", { name: "Поставщик по умолчанию" })).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * Формы нового магазина и товара принимают налоговые реквизиты.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Полей не было: ИНН магазина, ИКПУ и ставку НДС товара было некуда вписать
 * ни при заведении, ни потом.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   • магазин: ИНН не того формата — надпись с причиной и «Сохранить» не
 *     отправляет; 9 цифр с пробелами — уходят вместе с признаком НДС;
 *     пустое поле — реквизитов в запросе нет (как раньше);
 *   • товар: ИКПУ не из 17 цифр — отказ до отправки; 17 цифр, код упаковки
 *     и ставка из списка — уходят; ничего не задано — полей в запросе нет;
 *   • подписи — по-узбекски при узбекском языке.
 *
 * Нарочная поломка: в ShopForm убери `!taxError &&` из onClick и
 * `|| Boolean(taxError)` из disabled — упадёт «кривой ИНН не уходит».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShopForm } from "@/components/shops/ShopForm";
import { ProductForm } from "@/components/products/ProductForm";

afterEach(cleanup);
// jsdom не умеет прокручивать: список ставок прокручивает выбранную строку в поле зрения.
Element.prototype.scrollIntoView = () => {};

describe("форма магазина", () => {
  const mount = (lang = "ru") => {
    const onSave = vi.fn();
    render(<ShopForm onSave={onSave} onCancel={() => {}} isPending={false} lang={lang} agents={[]} />);
    fireEvent.change(screen.getByPlaceholderText(lang === "uz" ? "Nomi *" : "Название *"), { target: { value: "ООО Ромашка" } });
    return onSave;
  };

  it("кривой ИНН не уходит: причина названа, кнопка не отправляет", () => {
    const onSave = mount();
    fireEvent.change(screen.getByTestId("shop-tax-id"), { target: { value: "3011111112" } });
    expect(screen.getByRole("alert").textContent).toBe("ИНН — 9 цифр, ПИНФЛ — 14 цифр");
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ИНН и признак НДС уходят вместе с карточкой; пусто — реквизитов нет", () => {
    const onSave = mount();
    fireEvent.change(screen.getByTestId("shop-tax-id"), { target: { value: "301 111 111" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByTestId("shop-vat-payer"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "ООО Ромашка", taxId: "301 111 111", vatPayer: true }));

    cleanup();
    const plain = mount();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(plain.mock.calls[0][0]).toMatchObject({ taxId: undefined, vatPayer: undefined });
  });

  it("по-узбекски", () => {
    mount("uz");
    expect(screen.getByLabelText("STIR (9 raqam) yoki JShShIR (14 raqam)")).toBeTruthy();
    expect(screen.getByText("QQS to'lovchisi")).toBeTruthy();
  });
});

describe("форма товара", () => {
  const mount = () => {
    const onSave = vi.fn();
    render(<ProductForm onSave={onSave} onCancel={() => {}} isPending={false} lang="ru" />);
    fireEvent.change(screen.getByTestId("product-code"), { target: { value: "W-1" } });
    fireEvent.change(screen.getByTestId("product-name"), { target: { value: "Вода" } });
    fireEvent.change(screen.getByTestId("product-price"), { target: { value: "4500" } });
    return onSave;
  };

  it("ИКПУ не из 17 цифр — отказ до отправки", () => {
    const onSave = mount();
    fireEvent.change(screen.getByTestId("product-ikpu"), { target: { value: "0220200100100000" } });
    expect(screen.getByRole("alert").textContent).toBe("ИКПУ — 17 цифр");
    fireEvent.click(screen.getByTestId("product-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ИКПУ, код упаковки и ставка уходят; ничего не задано — полей нет", () => {
    const onSave = mount();
    fireEvent.change(screen.getByTestId("product-ikpu"), { target: { value: "02202001001000000" } });
    fireEvent.change(screen.getByTestId("product-package-code"), { target: { value: "1510583" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Ставка НДС" }));
    fireEvent.click(screen.getByRole("option", { name: "НДС 12%" }));
    fireEvent.click(screen.getByTestId("product-save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ code: "W-1", ikpu: "02202001001000000", packageCode: "1510583", vatRate: "vat12" }));

    cleanup();
    const plain = mount();
    fireEvent.click(screen.getByTestId("product-save"));
    expect(plain.mock.calls[0][0]).toMatchObject({ ikpu: undefined, packageCode: undefined, vatRate: undefined });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { CounterpartyForm } from "@/components/counterparties/CounterpartyForm";
import type { CounterpartyRow } from "@/components/counterparties/CounterpartyList";

/**
 * Отсрочка оплаты — в карточке контрагента.
 *
 * Её берёт заказ поставщику при заведении, а от заказа — срок долга при
 * приёмке (ADR 0013). Поле необязательное: пусто — платим по факту, и при
 * правке пустое поле снимает прежнюю отсрочку, а не оставляет её молча.
 */

afterEach(cleanup);

const row: CounterpartyRow = {
  id: 3, name: "Завод", contactName: null, phone: null, inn: null, address: null, notes: null,
  status: "active", paymentTermsDays: 14, debtUzs: 0, debtUsd: 0, overdueCount: 0, suppliesCount: 0, lastPaymentAt: null,
};

function renderForm(initial: CounterpartyRow | null, onSave = vi.fn()) {
  render(
    <LangProvider>
      <CounterpartyForm open initial={initial} isPending={false} onSave={onSave} onClose={vi.fn()} />
    </LangProvider>,
  );
  return onSave;
}

const terms = () => screen.getByTestId("counterparty-terms") as HTMLInputElement;
const save = () => screen.getByTestId("counterparty-save") as HTMLButtonElement;

describe("отсрочка оплаты контрагента", () => {
  it("правка показывает записанную отсрочку и отдаёт новую", () => {
    const onSave = renderForm(row);
    expect(terms().value).toBe("14");
    fireEvent.change(terms(), { target: { value: "30" } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paymentTermsDays: "30" }));
  });

  it("в поле — только цифры; больше года не сохранить", () => {
    renderForm(null);
    fireEvent.change(screen.getByTestId("counterparty-name"), { target: { value: "Новый" } });
    fireEvent.change(terms(), { target: { value: "4x5" } });
    expect(terms().value).toBe("45");
    fireEvent.change(terms(), { target: { value: "400" } });
    expect(save().disabled).toBe(true);
    expect(screen.getByText("От 0 до 365 дней")).toBeTruthy();
  });
});

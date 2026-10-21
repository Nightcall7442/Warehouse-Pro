// @vitest-environment jsdom
/**
 * Форма возврата поставщику называет склад, с которого уйдёт товар.
 *
 * Поставку, принятую не на основной склад (заказ поставщику на филиал),
 * сервер возвращает с того же склада (supplier.returnGoods). Форма склада
 * не присылает, поэтому обязана его назвать — и не ставить рядом «свободно»
 * склада каталога, то есть основного: это число относится к другому складу.
 *
 * Нарочная поломка: убери receivedWarehouseName из подписи формы — падает
 * первый тест.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/providers/trpc", () => ({
  trpc: {
    product: {
      list: {
        useQuery: () => ({ data: { data: [{ id: 3, name: "Сок", code: "S-1", costPrice: "9000", available: "40" }] } }),
      },
    },
  },
}));

const { SupplierReturnForm } = await import("./SupplierReturnForm");

afterEach(cleanup);

const supply = { id: 1, supplyNumber: "SUP-1", supplierName: "Завод", currency: "UZS", debt: 50000 };
const show = (extra: Record<string, unknown>) => {
  render(<SupplierReturnForm open supply={{ ...supply, ...extra }} isPending={false} lang="ru" onSubmit={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByTestId("supplier-return-search"), { target: { value: "Сок" } });
};

describe("возврат поставщику: склад", () => {
  it("поставка на филиал — форма называет филиал и не показывает «свободно» основного", () => {
    show({ receivedWarehouseName: "Филиал" });
    expect(screen.getByTestId("supplier-return-warehouse").textContent).toContain("со склада «Филиал»");
    expect(document.body.textContent).not.toContain("свободно 40");
  });

  it("поставка на основной — как раньше: «свободно» склада каталога", () => {
    show({ receivedWarehouseName: null });
    expect(screen.getByTestId("supplier-return-warehouse").textContent).not.toContain("«");
    expect(document.body.textContent).toContain("свободно 40");
  });
});

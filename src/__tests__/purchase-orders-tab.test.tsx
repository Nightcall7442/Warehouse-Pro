// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Вкладка «Заказы поставщикам»: плитки и список.
 *
 * «Ожидаемые платежи» — прогноз по неполученному остатку открытых заказов,
 * по валютам; сумы с долларами не складываются (как долг в «Контрагентах»).
 * Строка открывает заказ.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const listArgs = vi.hoisted(() => vi.fn());
const trpcStub = vi.hoisted(() => ({
  purchaseOrder: {
    list: {
      useQuery: (input: unknown) => {
        listArgs(input);
        return {
          data: {
            data: [{
              id: 9, number: "PO-9", status: "pending_approval", supplierId: 5, supplierName: "Завод",
              warehouseId: 1, warehouseName: "Основной", currency: "USD", expectedDate: "2026-10-25",
              paymentTermsDays: 10, source: "manual", createdAt: new Date(), updatedAt: new Date(),
              total: 250, remaining: 250, lines: 1, openArrivals: 0, expectedPaymentDate: "2026-11-04",
            }],
            total: 1, page: 1, pageSize: 25,
            summary: { pendingApproval: 1, open: 2, plannedUzs: 1800, plannedUsd: 250 },
          },
          isLoading: false, isLoadingError: false, refetch: vi.fn(),
        };
      },
    },
  },
  auth: { me: { useQuery: () => ({ data: { id: 1, role: "operator" }, isLoading: false }) } },
}));
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));

const { PurchaseOrdersSection } = await import("@/components/purchase-orders/PurchaseOrdersSection");

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe("вкладка заказов поставщикам", () => {
  it("плитки — по валютам, строка открывает заказ", () => {
    render(
      <LangProvider>
        <MemoryRouter initialEntries={["/arrivals"]}>
          <Routes>
            <Route path="/arrivals" element={<PurchaseOrdersSection />} />
            <Route path="/purchase-orders/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </LangProvider>,
    );
    expect(screen.getByTestId("po-tile-pending").textContent).toContain("1");
    const planned = screen.getByTestId("po-tile-planned").textContent ?? "";
    expect(planned).toContain("UZS");
    expect(planned).toContain("USD");
    const row = screen.getByTestId("po-row-9");
    expect(row.textContent).toContain("Завод");
    expect(row.textContent).toContain("25.10.2026");
    expect(row.textContent).toContain("На согласовании");
    act(() => { fireEvent.click(row); });
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/9");
    expect(listArgs).toHaveBeenCalledWith({ status: undefined, page: 1, pageSize: 25 });
  });

  it("«Новый заказ» ведёт на пустой заказ", () => {
    render(
      <LangProvider>
        <MemoryRouter initialEntries={["/arrivals"]}>
          <Routes>
            <Route path="/arrivals" element={<PurchaseOrdersSection />} />
            <Route path="/purchase-orders/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </LangProvider>,
    );
    act(() => { fireEvent.click(screen.getByTestId("purchase-orders-new")); });
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/new");
  });
});

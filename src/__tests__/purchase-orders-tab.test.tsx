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
 * Строка открывает заказ. Фильтр по поставщику; Excel — все заказы под
 * тем же фильтром, а не страница.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const listArgs = vi.hoisted(() => vi.fn());
const fetchArgs = vi.hoisted(() => vi.fn());
const exported = vi.hoisted(() => vi.fn());
const trpcStub = vi.hoisted(() => {
  const page = () => ({
    data: [{
      id: 9, number: "PO-9", status: "pending_approval", supplierId: 5, supplierName: "Завод",
      warehouseId: 1, warehouseName: "Основной", currency: "USD", expectedDate: "2026-10-25",
      paymentTermsDays: 10, source: "manual", createdAt: new Date("2026-10-20T10:00:00Z"), updatedAt: new Date(),
      total: 250, remaining: 250, expectedPaymentDate: "2026-11-04",
    }],
    total: 1, page: 1, pageSize: 25,
    summary: { pendingApproval: 1, open: 2, plannedUzs: 1800, plannedUsd: 250 },
  });
  return {
    purchaseOrder: {
      list: {
        useQuery: (input: unknown) => {
          listArgs(input);
          return { data: page(), isLoading: false, isLoadingError: false, refetch: vi.fn() };
        },
      },
    },
    supplier: { list: { useQuery: () => ({ data: [{ id: 5, name: "Завод" }, { id: 6, name: "Мельница" }], isLoading: false }) } },
    auth: { me: { useQuery: () => ({ data: { id: 1, role: "operator" }, isLoading: false }) } },
    useUtils: () => ({ purchaseOrder: { list: { fetch: async (input: unknown) => { fetchArgs(input); return page(); } } } }),
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/lib/excel", async orig => ({ ...(await orig<typeof import("@/lib/excel")>()), exportToExcel: exported }));

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

  it("из карточки поставщика — сразу с его фильтром; строка открывается и с клавиатуры", () => {
    render(
      <LangProvider>
        <MemoryRouter initialEntries={["/arrivals?tab=orders&supplierId=5"]}>
          <Routes>
            <Route path="/arrivals" element={<PurchaseOrdersSection />} />
            <Route path="/purchase-orders/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </LangProvider>,
    );
    expect(listArgs).toHaveBeenLastCalledWith({ status: undefined, supplierId: 5, page: 1, pageSize: 25 });
    act(() => { fireEvent.keyDown(screen.getByTestId("po-row-9"), { key: "Enter" }); });
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/9");
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

  it("фильтр по поставщику уходит в список, Excel — все заказы под тем же фильтром", async () => {
    render(
      <LangProvider>
        <MemoryRouter initialEntries={["/arrivals"]}>
          <Routes>
            <Route path="/arrivals" element={<PurchaseOrdersSection />} />
          </Routes>
        </MemoryRouter>
      </LangProvider>,
    );
    act(() => { fireEvent.click(screen.getByRole("combobox", { name: "Поставщик" })); });
    act(() => { fireEvent.click(screen.getByRole("option", { name: "Завод" })); });
    expect(listArgs).toHaveBeenLastCalledWith({ status: undefined, supplierId: 5, page: 1, pageSize: 25 });

    await act(async () => { fireEvent.click(screen.getByTestId("purchase-orders-excel")); });
    expect(fetchArgs).toHaveBeenCalledWith({ status: undefined, supplierId: 5, page: 1, pageSize: 5000 });
    expect(exported).toHaveBeenCalledTimes(1);
    const [rows, file] = exported.mock.calls[0] as [Array<Record<string, unknown>>, string];
    expect(file).toBe("purchase-orders");
    expect(rows).toEqual([expect.objectContaining({
      "Заказ №": "PO-9", "Поставщик": "Завод", "Статус": "На согласовании", "Валюта": "USD",
      "Сумма заказа": 250, "Не получено": 250,
    })]);
  });
});

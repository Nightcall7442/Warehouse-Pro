// @vitest-environment jsdom
/**
 * Карточка контрагента → «Заказы»: что ещё ждём от этого поставщика.
 *
 * Долга заказы не создают (ADR 0013), поэтому живут отдельной вкладкой, а не
 * среди долгов. Список грузится только на этой вкладке; строка открывает
 * заказ; «Новый заказ» открывает заказ уже с этим поставщиком — и только у
 * того, кто ведёт поставщиков.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

const state = vi.hoisted(() => ({ canManage: true, listArgs: [] as unknown[], total: 1 }));

vi.mock("@/hooks/useCan", () => ({ useCan: () => (perm: string) => perm === "suppliers.manage" ? state.canManage : true }));
vi.mock("@/hooks/useSellerCompany", () => ({ useSellerCompany: () => ({ company: { name: "ООО Тест" } }) }));
vi.mock("@/providers/trpc", () => {
  const empty = () => ({ data: undefined, isLoading: false });
  return {
    trpc: {
      supplier: {
        supplies: { useQuery: () => ({ data: { data: [] }, isLoading: false }) },
        payments: { useQuery: empty },
        reconciliation: { useQuery: empty },
      },
      purchaseOrder: {
        list: {
          useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
            if (opts?.enabled === false) return { data: undefined, isLoading: false };
            state.listArgs.push(input);
            return {
              data: {
                data: [{
                  id: 9, number: "PO-9", status: "approved", currency: "USD", total: 250, remaining: 100,
                  expectedDate: "2026-10-25", createdAt: new Date("2026-10-20T10:00:00Z"),
                }],
                total: state.total,
              },
              isLoading: false,
            };
          },
        },
      },
    },
  };
});

const { CounterpartyDetail } = await import("@/components/counterparties/CounterpartyDetail");

function Where() { return <div data-testid="where">{useLocation().pathname + useLocation().search}</div>; }

function open() {
  render(
    <MemoryRouter initialEntries={["/counterparties"]}>
      <Routes>
        <Route path="/counterparties" element={<CounterpartyDetail supplierId={5} lang="ru" onClose={() => {}} onEdit={() => {}} onPay={() => {}} onReturn={() => {}} />} />
        <Route path="/arrivals" element={<Where />} />
        <Route path="/purchase-orders/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { cleanup(); state.canManage = true; state.listArgs = []; state.total = 1; });

describe("карточка контрагента: заказы поставщику", () => {
  it("список — только на своей вкладке и только этого поставщика; строка открывает заказ", async () => {
    open();
    expect(state.listArgs, "заказы грузятся, пока вкладку не открыли").toEqual([]);
    act(() => { fireEvent.click(screen.getByText("Заказы", { selector: "button" })); });
    expect(state.listArgs[0]).toEqual({ supplierId: 5, pageSize: 50 });
    const row = screen.getByTestId("cp-order-9");
    expect(row.textContent).toContain("PO-9");
    expect(row.textContent).toContain("25.10.2026");
    expect(row.textContent).toContain("USD");
    fireEvent.click(row);
    await act(async () => {});
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/9");
  });

  it("заказов больше, чем показано, — так и сказано, и есть путь ко всем", async () => {
    open();
    act(() => { fireEvent.click(screen.getByText("Заказы", { selector: "button" })); });
    expect(screen.queryByTestId("cp-orders-more")).toBeNull();
    cleanup();

    state.total = 120;
    open();
    act(() => { fireEvent.click(screen.getByText("Заказы", { selector: "button" })); });
    expect(screen.getByTestId("cp-orders-more").textContent).toContain("Показаны последние 1 из 120");
    fireEvent.click(screen.getByTestId("cp-orders-all"));
    await act(async () => {});
    expect(screen.getByTestId("where").textContent).toBe("/arrivals?tab=orders&supplierId=5");
  });

  it("«Новый заказ» открывает заказ с этим поставщиком", async () => {
    open();
    act(() => { fireEvent.click(screen.getByText("Заказы", { selector: "button" })); });
    fireEvent.click(screen.getByTestId("cp-new-order"));
    await act(async () => {});
    expect(screen.getByTestId("where").textContent).toBe("/purchase-orders/new?supplierId=5");
  });

  it("без права вести поставщиков — список виден, «Нового заказа» нет", () => {
    state.canManage = false;
    open();
    act(() => { fireEvent.click(screen.getByText("Заказы", { selector: "button" })); });
    expect(screen.getByTestId("cp-order-9")).toBeTruthy();
    expect(screen.queryByTestId("cp-new-order")).toBeNull();
  });
});

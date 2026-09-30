// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * «Принять по заявленному» на экране: итог до нажатия, результат после,
 * кнопка в панели выбранных заказов.
 *
 * Что было: пачки не было — вечером оператор закрывал расчёт по одному
 * заказу из карточки.
 *
 * Что проверяется (AcceptClaimedModal, OrderBulkActions):
 *   · до нажатия — сколько заказов закроется и на какую сумму, какие
 *     пропущены и почему («заявлено ≠ остаток» с суммами, «уже закрыт»,
 *     «нет заявленного»);
 *   · нажатие шлёт серверу только готовые к закрытию, с тем заявленным,
 *     что было в итоге;
 *   · после — по каждому заказу «закрыт» с суммой или «пропущен — причина»,
 *     даже когда список перечитался и итог стал другим; «Готово» снимает
 *     выделение;
 *   · надписи по-узбекски — тем же окном;
 *   · панель: в очереди «Ждут расчёта» кнопка — главная; без права
 *     принимать оплату её нет.
 *
 * Нарочная поломка (проверено): слать в acceptClaimed все строки итога, а не
 * только готовые — падает «шлёт только готовые»; результат строить по живому
 * итогу вместо снимка — падает «после перечитывания».
 */
const h = vi.hoisted(() => ({
  plan: null as unknown,
  mutate: vi.fn(),
  onSuccess: undefined as undefined | ((r: unknown) => void),
  invalidate: vi.fn(),
}));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    order: {
      claimPlan: { useQuery: () => ({ data: h.plan, isLoading: false, isFetching: false }) },
      acceptClaimed: { useMutation: (o: { onSuccess: (r: unknown) => void }) => { h.onSuccess = o.onSuccess; return { mutate: h.mutate, isPending: false }; } },
    },
  },
}));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown, o?: { decimals?: number }) => `${Number(v).toFixed(o?.decimals ?? 0)} сум`, symbol: "сум" }) }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => h.invalidate }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { AcceptClaimedModal } = await import("@/components/orders/AcceptClaimedModal");
const { OrderBulkActions } = await import("@/components/orders/OrderBulkActions");

const rows = [
  { id: 1, number: "№101", shopName: "Магазин Альфа", courierName: "Ботир", total: 300000, claimed: 300000, due: 300000, reason: null },
  { id: 2, number: "№102", shopName: "Магазин Бета", courierName: "Ботир", total: 250000.5, claimed: 150000.5, due: 150000.5, reason: null },
  { id: 3, number: "№103", shopName: "Магазин Гамма", courierName: "Ботир", total: 300000, claimed: 290000, due: 300000, reason: "mismatch" },
  { id: 4, number: "№104", shopName: "Магазин Дельта", courierName: "Ботир", total: 100000, claimed: 0, due: 0, reason: "closed" },
  { id: 5, number: "№105", shopName: "Магазин Эпсилон", courierName: null, total: 100000, claimed: 0, due: 100000, reason: "no_claim" },
];
beforeEach(() => {
  h.plan = { rows, ready: { count: 2, amount: 450000.5 } };
  h.mutate.mockReset(); h.invalidate.mockReset();
  try { localStorage.setItem("lang", "ru"); } catch { /* нет хранилища */ }
});
afterEach(cleanup);

const show = (props: Partial<{ onClose: () => void; onDone: () => void }> = {}) => render(
  <LangProvider><AcceptClaimedModal open orderIds={[1, 2, 3, 4, 5]} onClose={props.onClose ?? (() => {})} onDone={props.onDone} /></LangProvider>,
);

describe("«Принять по заявленному»: окно", () => {
  it("до нажатия — сколько закроется, на какую сумму, кто пропущен и почему", () => {
    show();
    expect(screen.getByTestId("claim-plan-total").textContent).toContain("Закроется: 2");
    expect(screen.getByTestId("claim-plan-total").textContent).toContain("450000.50 сум");
    expect(screen.getByTestId("claim-plan-total").textContent).toContain("Пропущено: 3");
    expect(screen.getByTestId("claim-row-1").textContent).toContain("300000 сум");
    expect(screen.getByTestId("claim-row-3").textContent).toContain("заявлено ≠ остаток");
    expect(screen.getByTestId("claim-row-3").textContent).toContain("290000 сум ≠ 300000 сум");
    expect(screen.getByTestId("claim-row-4").textContent).toContain("уже закрыт");
    expect(screen.getByTestId("claim-row-5").textContent).toContain("нет заявленного");
    expect(screen.getByTestId("claim-accept").textContent).toBe("Принять 2");
  });

  it("шлёт только готовые, с заявленным из итога", () => {
    show();
    fireEvent.click(screen.getByTestId("claim-accept"));
    expect(h.mutate).toHaveBeenCalledWith({ items: [{ orderId: 1, claimed: 300000 }, { orderId: 2, claimed: 150000.5 }] });
  });

  it("нечего закрыть — кнопка не нажимается", () => {
    h.plan = { rows: rows.slice(2), ready: { count: 0, amount: 0 } };
    show();
    expect((screen.getByTestId("claim-accept") as HTMLButtonElement).disabled).toBe(true);
  });

  it("после — по каждому заказу, и после перечитывания итога; «Готово» снимает выделение", () => {
    const onDone = vi.fn(); const onClose = vi.fn();
    const { rerender } = show({ onDone, onClose });
    fireEvent.click(screen.getByTestId("claim-accept"));
    // Список перечитался после записи — в живом итоге все «уже закрыт».
    h.plan = { rows: rows.map(r => ({ ...r, reason: "closed" })), ready: { count: 0, amount: 0 } };
    rerender(<LangProvider><AcceptClaimedModal open orderIds={[1, 2, 3, 4, 5]} onClose={onClose} onDone={onDone} /></LangProvider>);
    act(() => h.onSuccess!({ results: [{ orderId: 1, closed: true, amount: 300000 }, { orderId: 2, closed: false, amount: 0, reason: "changed" }], closed: 1, amount: 300000 }));
    rerender(<LangProvider><AcceptClaimedModal open orderIds={[1, 2, 3, 4, 5]} onClose={onClose} onDone={onDone} /></LangProvider>);
    const result = screen.getByTestId("claim-result");
    expect(within(result).getByTestId("claim-result-total").textContent).toContain("Закрыто: 1");
    expect(within(result).getByTestId("claim-result-total").textContent).toContain("300000 сум");
    expect(within(result).getByTestId("claim-row-1").textContent).toContain("№101");
    expect(within(result).getByTestId("claim-row-1").textContent).toContain("закрыт");
    expect(within(result).getByTestId("claim-row-2").textContent).toContain("пропущен — сумма изменилась — откройте заказ");
    expect(h.invalidate).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("claim-done"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("по-узбекски", () => {
    localStorage.setItem("lang", "uz");
    show();
    expect(screen.getByTestId("claim-plan-total").textContent).toContain("Yopiladi: 2");
    expect(screen.getByTestId("claim-row-3").textContent).toContain("e'lon qilingan ≠ qoldiq");
    expect(screen.getByTestId("claim-accept").textContent).toBe("2 tasini qabul qilish");
  });
});

describe("панель выбранных заказов", () => {
  const bar = (p: Partial<React.ComponentProps<typeof OrderBulkActions>>) => render(
    <LangProvider>
      <OrderBulkActions selectedCount={3} onClearSelection={() => {}} onPrintInvoices={() => {}} onCreateLoadingList={() => {}} onChangeStatus={() => {}}
        onComplete={() => {}} onCompleteWithPayment={() => {}} onAssignAgent={() => {}} onAssignCourier={() => {}} onExportExcel={() => {}} {...p} />
    </LangProvider>,
  );
  it("в очереди «Ждут расчёта» — главная кнопка; нажатие открывает окно", () => {
    const open = vi.fn();
    bar({ onAcceptClaimed: open, acceptClaimedFirst: true });
    const btn = screen.getByTestId("bulk-accept-claimed");
    expect(btn.textContent).toBe("Принять по заявленному");
    expect(btn.className).toContain("neo-btn-primary");
    expect(screen.queryByText("Выполнить с оплатой")).toBeNull();
    fireEvent.click(btn);
    expect(open).toHaveBeenCalled();
  });
  it("без права принимать оплату — кнопки нет", () => {
    bar({});
    expect(screen.queryByTestId("bulk-accept-claimed")).toBeNull();
    expect(screen.getByText("Выполнить с оплатой")).toBeTruthy();
  });
});

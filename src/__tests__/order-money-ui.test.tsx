// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LangProvider } from "@/i18n";

/**
 * Блок «Деньги» в карточке заказа и рабочее место оператора.
 *
 *   · ждёт расчёта: заявленное курьером подставлено в поле, остаток виден,
 *     закрыть с остатком нельзя, пока не отмечен «в долг магазину»;
 *   · сдал меньше заявленного — недостача показана ДО нажатия;
 *   · закрытие зовёт order.close ровно с тем, что на экране;
 *   · рассчитанный заказ — отметка «Рассчитан», формы нет; безнал в пути —
 *     кнопка «Пришло» зовёт order.confirmBank;
 *   · список заказов: панели справа нет, строка ведёт в карточку, плитка
 *     «Ждут расчёта» фильтрует очередь; карточка — две колонки, деньги справа.
 */
const stub = vi.hoisted(() => {
  const state = {
    money: {
      id: 1534, number: "1534", status: "delivered", total: 1_250_000, paid: 1_200_000, remainder: 50_000,
      claimed: 1_200_000, inTransit: 0, received: 0, holders: [{ id: 7, name: "Ботир", amount: 1_200_000 }],
      closedAt: null as string | null, closedByName: null as string | null, shortage: null as null | { amount: number; userName: string; note: string | null },
      awaiting: true,
      payments: [{ id: 91, amount: 1_200_000, method: "cash", type: "payment", status: "paid", reversalOf: null, receivedAt: null, bankConfirmedAt: null, bankRef: null, notes: null, createdAt: "2026-09-18T09:10:00.000Z", createdByName: "Ботир", createdByRole: "courier", settled: false }],
    },
    close: vi.fn(), confirmBank: vi.fn(), invalidate: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  const mut = (fn: (v: unknown) => unknown) => (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({ mutate: (v: unknown) => { const r = fn(v); opts?.onSuccess?.(r, v); }, isPending: false });
  return {
    state,
    trpc: {
      settings: { get: { useQuery: q(() => ({ currency: "UZS", currencySymbol: "сум" })) } },
      auth: { me: { useQuery: q(() => ({ id: 1, role: "operator", name: "Дилноза", capabilities: [] })) } },
      order: {
        money: { useQuery: q(() => state.money) },
        close: { useMutation: mut(v => { state.close(v); return { shortage: 0, remainder: 0 }; }) },
        confirmBank: { useMutation: mut(v => { state.confirmBank(v); return { confirmed: 1 }; }) },
      },
      useUtils: () => ({ order: { money: { invalidate: state.invalidate }, getById: { invalidate: state.invalidate }, list: { invalidate: state.invalidate }, stats: { invalidate: state.invalidate } } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "operator", name: "Дилноза" } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const { MoneyBlock } = await import("@/components/orders/OrderMoney");

const show = () => render(<LangProvider><MoneyBlock orderId={1534} status="delivered" courierName="Ботир" /></LangProvider>);
const input = (id: string) => screen.getByTestId(id) as HTMLInputElement;
beforeEach(() => { stub.state.close.mockReset(); stub.state.confirmBank.mockReset(); stub.state.money.closedAt = null; stub.state.money.awaiting = true; stub.state.money.shortage = null; });
afterEach(cleanup);

describe("ждёт расчёта", () => {
  it("заявленное подставлено, остаток виден, без «в долг» закрыть нельзя; с ним — зовёт order.close", () => {
    show();
    expect(screen.getByTestId("order-money-state").textContent).toContain("Ждёт расчёта");
    expect(input("close-cash").value).toBe("1200000");
    expect(screen.getByText(/На руках · Ботир/)).toBeTruthy();
    const btn = screen.getByTestId("close-order") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(input("close-accept-debt"));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(stub.state.close).toHaveBeenCalledWith({ orderId: 1534, cashReceived: 1_200_000, extra: undefined, acceptDebt: true, debtDueDate: undefined, note: undefined });
  });
  it("сдал меньше — недостача видна до нажатия и уходит в запрос как есть", () => {
    show();
    fireEvent.change(input("close-cash"), { target: { value: "1000000" } });
    expect(screen.getByTestId("close-shortage").textContent).toMatch(/200\s000/);
    fireEvent.click(input("close-accept-debt"));
    fireEvent.change(input("close-note"), { target: { value: "не хватило пачки" } });
    fireEvent.click(screen.getByTestId("close-order"));
    expect(stub.state.close).toHaveBeenCalledWith(expect.objectContaining({ cashReceived: 1_000_000, note: "не хватило пачки" }));
  });
  it("доплата картой закрывает остаток — «в долг» не нужен", () => {
    show();
    fireEvent.change(input("close-extra"), { target: { value: "50000" } });
    const btn = screen.getByTestId("close-order") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(stub.state.close).toHaveBeenCalledWith(expect.objectContaining({ extra: [{ method: "card", amount: 50_000 }], acceptDebt: undefined }));
  });
});

describe("рассчитан", () => {
  it("отметка с датой и именем, формы нет, недостача показана", () => {
    stub.state.money.closedAt = "2026-09-18T14:02:00.000Z"; stub.state.money.closedByName = "Дилноза"; stub.state.money.awaiting = false;
    stub.state.money.shortage = { amount: 200_000, userName: "Ботир", note: null };
    show();
    expect(screen.getByTestId("order-money-state").textContent).toContain("Рассчитан");
    expect(screen.getByTestId("order-money-state").textContent).toContain("Дилноза");
    expect(screen.queryByTestId("order-close-form")).toBeNull();
    expect(screen.getByTestId("order-shortage").textContent).toContain("Ботир");
  });
  it("безнал в пути — «Пришло» зовёт order.confirmBank по строке", () => {
    stub.state.money.payments.push({ id: 92, amount: 50_000, method: "transfer", type: "payment", status: "paid", reversalOf: null, receivedAt: null, bankConfirmedAt: null, bankRef: null, notes: null, createdAt: "2026-09-18T09:20:00.000Z", createdByName: "Ботир", createdByRole: "courier", settled: false });
    show();
    fireEvent.click(screen.getByTestId("bank-confirm-92"));
    expect(stub.state.confirmBank).toHaveBeenCalledWith({ ids: [92] });
    stub.state.money.payments.pop();
  });
});

describe("рабочее место оператора", () => {
  const ROOT = join(__dirname, "..", "..");
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n"));
  it("список: панели справа нет, строка ведёт в карточку, плитка «Ждут расчёта» фильтрует очередь", () => {
    const orders = read("src/pages/Orders.tsx");
    expect(orders).not.toContain("OrderSlideOver");
    expect(orders).toContain("const openOrder = (id: number) => navigate(`/orders/${id}`);");
    expect(orders).toContain("onClick={() => openOrder(o.id as number)}");
    expect(orders).toContain('{ key: "money", n: stats?.awaitingMoneyCount ?? 0, ru: "Ждут расчёта"');
    expect(orders).toContain("awaitingMoney: awaitingMoney || undefined,");
  });
  it("карточка: две колонки, деньги справа с курьером, состав и переписка слева", () => {
    const detail = read("src/pages/OrderDetail.tsx");
    expect(detail).toContain('lg:grid-cols-[minmax(0,1fr)_380px]');
    expect(detail).toContain('<MoneyBlock orderId={order.id} status={order.status} courierName={order.courier?.name} />');
    expect(detail.indexOf("<OrderItemsEditor")).toBeLessThan(detail.indexOf("<MoneyBlock"));
    expect(detail).not.toContain("getOrderPayments");
  });
});

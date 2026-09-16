// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Экраны контроля: страница «Контроль» (плитки, сотрудники по индексу с
 * объяснением баллов, спорные доставки со ссылкой на заказ, Excel по-русски,
 * выключено — подсказка) и раздел настроек (тумблер под тарифом).
 */
const stub = vi.hoisted(() => {
  const state = {
    enabled: true, planAllows: true,
    overview: {
      employees: [
        { id: 3, name: "Курьер Ботир", role: "courier", score: 50, level: "watch", factors: [{ code: "dispute", points: 20, count: 1 }, { code: "shortage", points: 15, count: 1, money: 70000 }, { code: "debt", points: 15, money: 70000 }], delivered: 3, confirmed: 1, disputed: 1, unconfirmed: 1, onHand: 120000, debt: 70000 },
        { id: 4, name: "Агент Азиз", role: "agent", score: 0, level: "calm", factors: [], delivered: 0, confirmed: 0, disputed: 0, unconfirmed: 0, onHand: 0, debt: 0 },
      ],
      totals: { disputed: 1, unconfirmed: 1, confirmed: 1, delivered: 3, atRisk: 1 },
    },
    disputes: [{ id: 77, number: "№1002", total: 300000, deliveredAt: "2026-09-14T09:00:00.000Z", disputedAt: "2026-09-16T10:30:00.000Z", note: "Нет двух ящиков", shopId: 5, shopName: "Магазин Альфа", courierId: 3, courierName: "Курьер Ботир" }],
    setEnabled: vi.fn(), exportToExcel: vi.fn(), navigate: vi.fn(), invalidate: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  return {
    state,
    trpc: {
      settings: { get: { useQuery: q(() => ({ currency: "UZS" })) } },
      control: {
        status: { useQuery: q(() => ({ enabled: state.enabled, planAllows: state.planAllows })) },
        overview: { useQuery: q(() => state.overview) },
        disputes: { useQuery: q(() => state.disputes) },
        setEnabled: { useMutation: (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({ mutate: (v: unknown) => { state.setEnabled(v); opts?.onSuccess?.({ ok: true }, v); }, isPending: false }) },
      },
      useUtils: () => ({ control: { status: { invalidate: state.invalidate } } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("react-router", async (orig) => ({ ...(await orig<object>()), useNavigate: () => stub.state.navigate }));
vi.mock("@/lib/export", () => ({ exportToExcel: (...a: unknown[]) => stub.state.exportToExcel(...a) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const Control = (await import("@/pages/Control")).default;
const { ControlSettings } = await import("@/components/settings/ControlSettings");
const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);

beforeEach(() => { stub.state.enabled = true; stub.state.planAllows = true; stub.state.setEnabled.mockReset(); stub.state.exportToExcel.mockReset(); stub.state.navigate.mockReset(); });
afterEach(cleanup);

describe("страница «Контроль»", () => {
  it("плитки, сотрудники по индексу с уровнем, строка раскрывается в объяснение баллов", () => {
    show(<Control />);
    expect(screen.getByText("магазин сказал «не сходится»")).toBeTruthy();
    expect(screen.getByTestId("risk-score-3").textContent).toBe("50");
    expect(within(screen.getByTestId("risk-3")).getByText("Присмотреться")).toBeTruthy();
    expect(within(screen.getByTestId("risk-4")).getByText("Спокойно")).toBeTruthy();
    expect(screen.queryByTestId("risk-why-3")).toBeNull();
    fireEvent.click(screen.getByTestId("risk-3"));
    const why = screen.getByTestId("risk-why-3");
    expect(why.textContent).toContain("+20");
    expect(why.textContent).toContain("Магазин оспорил доставку — 1");
    expect(why.textContent).toContain("Недостача по пересчёту — 1 · ");
    // У чистого сотрудника раскрывать нечего.
    fireEvent.click(screen.getByTestId("risk-4"));
    expect(screen.queryByTestId("risk-why-4")).toBeNull();
  });
  it("спорные доставки: магазин, кто вёз, заметка; клик ведёт в заказ", () => {
    show(<Control />);
    const row = screen.getByTestId("dispute-77");
    expect(row.textContent).toContain("Магазин Альфа");
    expect(row.textContent).toContain("Курьер Ботир");
    expect(row.textContent).toContain("«Нет двух ящиков»");
    fireEvent.click(row);
    expect(stub.state.navigate).toHaveBeenCalledWith("/orders/77");
  });
  it("Excel — по-русски, два листа: индекс и споры", () => {
    show(<Control />);
    fireEvent.click(screen.getByTestId("control-excel"));
    const [sheets, name] = stub.state.exportToExcel.mock.calls[0] as [Array<{ name: string; data: Array<Record<string, unknown>>; columns: Array<{ header: string }> }>, string];
    expect(name).toBe("control-30d");
    expect(sheets.map(s => s.name)).toEqual(["Индекс риска", "Спорные доставки"]);
    expect(sheets[0].columns.map(c => c.header)).toEqual(["Сотрудник", "Роль", "Баллы", "Уровень", "Факторы", "Доставлено", "Подтверждено", "Спорных", "На руках", "Долг"]);
    expect(sheets[0].data[0]).toMatchObject({ name: "Курьер Ботир", role: "Курьер", score: 50, level: "Присмотреться" });
    expect(String(sheets[0].data[0].factors)).toContain("Магазин оспорил доставку — 1; Недостача по пересчёту — 1");
    expect(sheets[1].data[0]).toMatchObject({ number: "№1002", shop: "Магазин Альфа", note: "Нет двух ящиков", total: 300000 });
  });
  it("выключено — подсказка в настройки; Basic — подсказка о тарифе; таблиц нет", () => {
    stub.state.enabled = false;
    const { unmount } = show(<Control />);
    expect(screen.getByText(/включите его в Настройки → Контроль/)).toBeTruthy();
    expect(screen.queryByTestId("risk-3")).toBeNull();
    unmount();
    stub.state.planAllows = false;
    show(<Control />);
    expect(screen.getByText(/Pro и Exclusive/)).toBeTruthy();
  });
});

describe("настройки контроля", () => {
  it("Basic — тумблер выключен с подсказкой; Pro — включается и зовёт ручку", () => {
    stub.state.planAllows = false; stub.state.enabled = false;
    const { unmount } = show(<ControlSettings />);
    expect((screen.getByTestId("control-enabled") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Pro и Exclusive/)).toBeTruthy();
    unmount();
    stub.state.planAllows = true;
    show(<ControlSettings />);
    fireEvent.click(screen.getByTestId("control-enabled"));
    expect(stub.state.setEnabled).toHaveBeenCalledWith({ enabled: true });
    expect(stub.state.invalidate).toHaveBeenCalled();
  });
});

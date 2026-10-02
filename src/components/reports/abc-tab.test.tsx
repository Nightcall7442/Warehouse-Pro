// @vitest-environment jsdom
/**
 * «ABC» на экране: переключатели в адресе и «по прибыли» только директору.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Раздела не было. Проверяется то, что ломается молча: офис, открывший
 * пересланную директором ссылку «…&metric=profit», не должен ни видеть
 * переключателя, ни слать запрос по прибыли (сервер ответил бы отказом, и
 * раздел стоял бы ошибкой); класс и «что делим» — в адресе.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • показывать «По прибыли» всем — падает «офису переключателя нет»;
 *  • слать metricRaw вместо metric — падает «ссылка по прибыли у офиса»;
 *  • фильтр класса в useState — падает «класс в адресе».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

const state = vi.hoisted(() => ({ role: "ceo", inputs: [] as Array<Record<string, unknown>>, data: undefined as unknown }));

vi.mock("@/providers/trpc", () => ({
  trpc: { reports: { abc: { useQuery: (input: Record<string, unknown>) => { state.inputs.push(input); return { data: state.data, isError: false, refetch: () => {} }; } } } },
}));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: state.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: number) => `${v} сум` }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn() }));

const { AbcTab } = await import("./AbcTab");

const rows = [
  { key: 1, name: "Сок", sub: "S-1", value: 800, revenue: 800, abc: "A", share: 80, cumShare: 80, stockQty: 5 },
  { key: 2, name: "Вода", sub: "W-1", value: 150, revenue: 150, abc: "B", share: 15, cumShare: 95 },
  { key: 3, name: "Чай", sub: "T-1", value: 50, revenue: 50, abc: "C", share: 5, cumShare: 100, stockQty: 12 },
  { key: 4, name: "Кофе", sub: "K-1", value: 0, revenue: 0, abc: "C", share: 0, cumShare: 100, stockQty: 3 },
];
const report = (finance: boolean) => ({
  of: "product", metric: "revenue", rows,
  totals: { A: { count: 1, value: 800, share: 80 }, B: { count: 1, value: 150, share: 15 }, C: { count: 2, value: 50, share: 5 } },
  cStock: { count: 2, atCost: finance ? 9_400 : null, atPrice: 13_000, top: [{ key: 3, name: "Чай", qty: 12, atCost: finance ? 7_000 : null, atPrice: 10_000 }] },
  idleA: null,
});

function Where() { return <div data-testid="where">{useLocation().search}</div>; }
const mount = (url = "/reports?tab=abc") => render(<MemoryRouter initialEntries={[url]}><AbcTab /><Where /></MemoryRouter>);
const where = () => new URLSearchParams(screen.getByTestId("where").textContent ?? "");

beforeEach(() => { state.role = "ceo"; state.inputs = []; state.data = report(true); });
afterEach(cleanup);

describe("«ABC»: адрес и права", () => {
  it("директору — «По прибыли» в адресе и в запросе", () => {
    mount();
    expect(state.inputs.at(-1)).toMatchObject({ of: "product", metric: "revenue" });
    fireEvent.click(screen.getByRole("radio", { name: "По прибыли" }));
    expect(where().get("metric")).toBe("profit");
    expect(state.inputs.at(-1)).toMatchObject({ metric: "profit" });
  });

  it("офису переключателя нет, а пересланная ссылка «по прибыли» открывается по выручке", () => {
    state.role = "operator";
    state.data = report(false);
    mount("/reports?tab=abc&metric=profit");
    expect(screen.queryByRole("radio", { name: "По прибыли" })).toBeNull();
    expect(state.inputs.every(i => i.metric === "revenue")).toBe(true);
    // Остаток — по цене продажи, а не по себестоимости.
    expect(screen.getByTestId("abc-c-stock").textContent).toContain("13000 сум по цене продажи");
    expect(screen.getByTestId("abc-c-stock").textContent).not.toContain("себестоимости");
  });

  it("директору остаток C-товаров — по себестоимости", () => {
    mount();
    expect(screen.getByTestId("abc-c-stock").textContent).toContain("2 поз. на 9400 сум по себестоимости");
  });

  it("класс в адресе: «C» оставляет только C-строки; «Магазины» сбрасывает класс", () => {
    mount();
    fireEvent.click(screen.getByTestId("abc-cls-C"));
    expect(where().get("cls")).toBe("C");
    expect(screen.getAllByTestId("abc-row").map(r => r.dataset.abc)).toEqual(["C", "C"]);
    fireEvent.click(screen.getByRole("radio", { name: "Магазины" }));
    expect(where().get("of")).toBe("shop");
    expect(where().get("cls")).toBeNull();
    expect(state.inputs.at(-1)).toMatchObject({ of: "shop" });
  });

  it("плитки — сколько позиций и какая доля денег у каждого класса", () => {
    mount();
    expect(screen.getByTestId("abc-tile-A").textContent).toContain("1");
    expect(screen.getByTestId("abc-tile-A").textContent).toContain("80% выручки");
    expect(screen.getByTestId("abc-tile-C").textContent).toContain("5% выручки · 50 сум");
  });
});

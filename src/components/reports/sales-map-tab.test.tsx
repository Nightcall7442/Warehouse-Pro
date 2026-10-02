// @vitest-environment jsdom
/**
 * «Карта» на экране: фильтры в адресе, действие рядом с районом, права.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Раздела не было. Проверяется то, что ломается молча:
 *  • период, агент и территория — из адреса и в запросе (ссылку «Юнусабад
 *    за сентябрь» пересылают);
 *  • «Визиты» у района ставит замолчавшие магазины агенту зоны на завтра —
 *    одним agent.createPlans; офису кнопки нет (ручка — supervisorQuery);
 *  • «Указать координаты» — тем, кто правит карточку (директор, офис);
 *    супервайзеру — «Открыть»;
 *  • нажатие на точку карты открывает магазин под картой с действиями.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • canPlan без проверки роли — падает «офису кнопки нет»;
 *  • planArea без silentShopIds — падает «визиты у района»;
 *  • canFixGps = true — падает «супервайзеру — Открыть».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { addDays, format } from "date-fns";

const state = vi.hoisted(() => ({
  role: "ceo",
  inputs: [] as Array<Record<string, unknown>>,
  plans: [] as Array<Record<string, unknown>>,
  data: undefined as unknown,
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    reports: { salesMap: { useQuery: (input: Record<string, unknown>) => { state.inputs.push(input); return { data: state.data, isError: false, refetch: () => {} }; } } },
    agent: {
      listAgents: { useQuery: () => ({ data: [{ id: 10, name: "Азиз" }, { id: 12, name: "Сардор" }] }) },
      createPlans: { useMutation: (o: { onSuccess?: (r: unknown) => void }) => ({ isPending: false, mutate: (v: Record<string, unknown>) => { state.plans.push(v); o.onSuccess?.({ created: 1, skipped: 0, notFound: 0 }); } }) },
    },
    territory: { list: { useQuery: () => ({ data: [{ id: 1, name: "Юнусабад" }] }) } },
  },
}));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }), useTranslate: () => (ru: string) => ru }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: state.role } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: number) => `${v} сум` }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
// Яндекса в jsdom нет: карта — заглушка с кнопками-точками.
vi.mock("./SalesMapView", () => ({
  SalesMapView: ({ points, onSelect }: { points: Array<{ id: number; name: string }>; onSelect: (id: number) => void }) => (
    <div data-testid="map-stub">{points.map(p => <button key={p.id} type="button" onClick={() => onSelect(p.id)}>{`точка ${p.name}`}</button>)}</div>
  ),
}));

const { SalesMapTab } = await import("./SalesMapTab");
const { exportToExcel } = await import("@/lib/excel");

const area = (p: Record<string, unknown>) => ({
  kind: "territory", name: "Юнусабад", city: null, anchor: null, territoryId: 1, district: null,
  shops: 2, buying: 1, silent: 1, idle: 0, noGps: 0, revenue: 700, prevRevenue: 2500, changePct: -72, silentLost: 500,
  agents: [{ id: 10, name: "Азиз", shops: 2 }, { id: 12, name: "Сардор", shops: 0 }], suggestedAgentId: 12,
  status: "send", reasons: [{ code: "silent", count: 1, shops: 2, lost: 500 }, { code: "drop", pct: 72, amount: 1800 }],
  bounds: [[41.3, 69.28], [41.31, 69.29]], silentShopIds: [2], idleShopIds: [], ...p,
});
const map = () => ({
  from: "2099-09-01", to: "2099-09-30", prevFrom: "2099-08-02", prevTo: "2099-08-31",
  totals: { revenue: 1600, prevRevenue: 3000, changePct: -47, shops: 4, buying: 2, silent: 1, idle: 1, noGps: 1, silentLost: 500 },
  outside: null,
  areas: [
    area({ key: "t:1" }),
    area({ key: "d:ташкент|чиланзар", kind: "district", name: "Чиланзар", city: "Ташкент", territoryId: null, district: "Чиланзар", status: "ok",
      silent: 0, silentShopIds: [], idleShopIds: [5], reasons: [{ code: "growth", pct: 12 }], agents: [{ id: 10, name: "Азиз", shops: 1 }], suggestedAgentId: 10 }),
  ],
  points: [
    { id: 1, name: "Олтин", lat: 41.3, lng: 69.28, revenue: 700, prevRevenue: 2000, state: "buying", grade: 4, areaKey: "t:1", agentId: 10, agentName: "Азиз", lastOrderDay: "2099-09-20" },
    { id: 2, name: "Барака", lat: 41.31, lng: 69.29, revenue: 0, prevRevenue: 500, state: "silent", grade: 0, areaKey: "t:1", agentId: 10, agentName: "Азиз", lastOrderDay: "2099-08-15" },
  ],
  silent: [{ id: 2, name: "Барака", areaKey: "t:1", agentId: 10, agentName: "Азиз", prevRevenue: 500, lastOrderDay: "2099-08-15",
    light: { color: "yellow", reasons: [{ code: "long_pause", daysSince: 46, usualDays: 7 }], daysSinceOrder: 46 },
    lastNoOrder: { reason: "competitor", note: null, date: "2099-09-27" }, hasGps: true }],
  noGps: [{ id: 5, name: "Навруз", areaKey: "d:ташкент|чиланзар", revenue: 900, state: "buying" }],
});

function Where() { return <div data-testid="where">{useLocation().search}</div>; }
const mount = (url = "/reports?tab=map") => render(<MemoryRouter initialEntries={[url]}><SalesMapTab /><Where /></MemoryRouter>);

beforeEach(() => { state.role = "ceo"; state.inputs = []; state.plans = []; state.data = map(); });
afterEach(cleanup);

describe("«Карта»: адрес, действия, права", () => {
  it("период, агент и территория — из адреса и в запросе", () => {
    mount("/reports?tab=map&from=2099-09-01&to=2099-09-30&agent=12&territory=1");
    expect(state.inputs.at(-1)).toEqual({ from: "2099-09-01", to: "2099-09-30", agentId: 12, territoryId: 1 });
  });

  it("районы по порядку, с вердиктом и причинами словами", () => {
    mount();
    const rows = screen.getAllByTestId("sales-map-area");
    expect(rows.map(r => r.dataset.status)).toEqual(["send", "ok"]);
    expect(rows[0].textContent).toContain("Отправить агента");
    expect(rows[0].textContent).toContain("Перестали заказывать 1 из 2 — в прошлом периоде дали 500 сум");
    expect(rows[0].textContent).toContain("Выручка упала на 72% к прошлому периоду (−1800 сум)");
    expect(rows[1].textContent).toContain("Чиланзар, Ташкент");
    // «Магазины района» — список с тем же отбором.
    expect(within(rows[0]).getByRole("link", { name: /Магазины/ }).getAttribute("href")).toBe("/shops?view=list&territory=1");
    expect(within(rows[1]).getByRole("link", { name: /Магазины/ }).getAttribute("href")).toBe("/shops?view=list&district=%D0%A7%D0%B8%D0%BB%D0%B0%D0%BD%D0%B7%D0%B0%D1%80&city=%D0%A2%D0%B0%D1%88%D0%BA%D0%B5%D0%BD%D1%82");
  });

  it("визиты у района: замолчавшие — агенту зоны на завтра, одним вызовом", () => {
    mount();
    const rows = screen.getAllByTestId("sales-map-area");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Визиты/ }));
    fireEvent.click(screen.getByTestId("sales-map-plan-save"));
    expect(state.plans).toEqual([{ agentId: 12, shopIds: [2], planDate: format(addDays(new Date(), 1), "yyyy-MM-dd"), notes: "Карта продаж: вернуть магазин" }]);
  });

  it("визиты у района без замолчавших — по галочке «и те, кто не заказывает»", () => {
    mount();
    const rows = screen.getAllByTestId("sales-map-area");
    fireEvent.click(within(rows[1]).getByRole("button", { name: /Визиты/ }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("sales-map-plan-save"));
    expect(state.plans.at(-1)).toMatchObject({ agentId: 10, shopIds: [5] });
  });

  it("офису кнопок «Визит» нет; координаты — офис правит", () => {
    state.role = "operator";
    mount();
    expect(screen.queryAllByTestId("sales-map-plan-area")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Визит$/ })).toBeNull();
    expect(screen.getByTestId("sales-map-fix-gps").getAttribute("href")).toBe("/shops/5?edit=gps");
  });

  it("супервайзеру — визиты есть, а вместо «Указать координаты» — «Открыть»", () => {
    state.role = "supervisor";
    mount();
    expect(screen.getAllByTestId("sales-map-plan-area").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("sales-map-fix-gps")).toBeNull();
    const row = screen.getByTestId("sales-map-nogps-row");
    expect(within(row).getByRole("link", { name: /Открыть/ }).getAttribute("href")).toBe("/shops/5");
  });

  it("точка на карте — магазин под картой: светофор, причина «без заказа» и действия", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "точка Барака" }));
    const card = screen.getByTestId("sales-map-selected");
    expect(card.textContent).toContain("Перестал заказывать · Юнусабад · Азиз");
    expect(card.textContent).toContain("Не заказывает 46 дн., обычно — раз в 7 дн.");
    expect(card.textContent).toContain("Визит без заказа 27.09.2099: Берёт у конкурента");
    expect(within(card).getByRole("link", { name: /Открыть/ }).getAttribute("href")).toBe("/shops/2");
    expect(within(card).getByRole("button", { name: /Визит/ })).toBeTruthy();
  });

  it("Excel районов — по-русски, с причинами словами", () => {
    mount();
    fireEvent.click(within(screen.getByTestId("sales-map-areas")).getByRole("button", { name: /Excel/ }));
    const [rows, , sheet, title] = (exportToExcel as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    expect(sheet).toBe("Районы");
    expect(String(title)).toContain("Карта продаж: районы 01.09.2099 — 30.09.2099");
    expect((rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      "Район": "Юнусабад", "Вид": "Территория", "Агенты": "Азиз, Сардор", "Перестали заказывать": 1,
      "Что делать": "Отправить агента",
    });
    expect(String((rows as Array<Record<string, unknown>>)[0]["Почему"])).toContain("Выручка упала на 72%");
  });
});

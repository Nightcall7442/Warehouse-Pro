// @vitest-environment jsdom
/**
 * «Сроки» — рабочее место: строки, деньги по роли, действие рядом.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Список партий с датой и суммой закупки — одинаково всем. Что делать с
 * партией, экран не говорил; уценить было нечем; директор узнавал о сгорающем,
 * только дойдя до склада.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Директор: первой открыта группа «не успеют», сверху — где сгорит больше
 *     денег; у строки причина словами, подсказка скидки, маржа или «ниже
 *     закупки» с честным сравнением, кнопка «Уценить».
 *  2. Уценённая партия: «Уценено», «Снять уценку» снимает по товару.
 *  3. Оператор: ни «по закупке», ни маржи; цена ниже закупки — «ставит
 *     директор», без кнопки; деньги — «по цене продажи».
 *  4. Просроченные — своя плитка; «Списать» открывает движение «расход» с
 *     количеством партии и примечанием.
 *  5. Окно уценки: скидка ↔ цена; «ниже закупки» директору; уходит
 *     batchId и цена.
 *  6. Выгрузка — по-русски; столбцы закупки — только директору.
 *  7. Карточка на главной: только директору и только когда есть что делать;
 *     ведёт в «Сроки»; главная прячет подсказки о том же.
 *  8. Агент: «Продать первым» в каталоге и в заказе, уценённые — первыми.
 *
 * Нарочная поломка: в sortRows поменять порядок на возрастание — падает 1;
 * в ExpiringBatches показывать кнопку «Уценить» без оглядки на needsDirector —
 * падает 3; в excelColumns отдать столбцы закупки всем — падает 6; в
 * useExpiryHome убрать проверку роли — падает 7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { LangProvider } from "@/i18n";
import { MemoryRouter } from "react-router";

const h = vi.hoisted(() => ({
  role: "ceo",
  rows: [] as Array<Record<string, unknown>>,
  summary: null as null | Record<string, unknown>,
  setMarkdown: vi.fn(),
  clearMarkdown: vi.fn(),
  adjust: vi.fn(),
  exportToExcel: vi.fn(),
  navigate: vi.fn(),
  catalog: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/providers/trpc", () => {
  const q = (get: () => unknown) => (_i?: unknown, opts?: { enabled?: boolean }) => ({ data: opts?.enabled === false ? undefined : get(), isLoading: false, isLoadingError: false, refetch: vi.fn() });
  const m = (fn: (i: unknown) => void) => () => ({ mutate: fn, isPending: false, variables: undefined });
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      warehouseReports: {
        expiring: { useQuery: q(() => h.rows) },
        expiringSummary: { useQuery: q(() => h.summary) },
      },
      priceList: { setMarkdown: { useMutation: m(h.setMarkdown) }, clearMarkdown: { useMutation: m(h.clearMarkdown) } },
      warehouse: { adjustStock: { useMutation: m(h.adjust) } },
      product: { listAll: { useQuery: q(() => h.catalog) } },
      useUtils: () => ({
        warehouseReports: { expiring: inv, expiringSummary: inv, productBatches: { fetch: async () => ({ onHand: 40 }) } },
        product: { listAll: inv },
      }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: h.role } }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v).toLocaleString("ru-RU")} сум` }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/export", () => ({ exportToExcel: (...a: unknown[]) => h.exportToExcel(...a) }));
vi.mock("react-router", async (orig) => ({ ...(await orig<typeof import("react-router")>()), useNavigate: () => h.navigate }));

const { ExpiringBatches } = await import("@/components/warehouse/ExpiringBatches");
const { ExpiryHomeCard } = await import("@/components/warehouse/ExpiryHomeCard");

type R = Record<string, unknown>;
const row = (over: R): R => ({
  batchId: 1, productId: 1, productName: "Йогурт", productCode: "Y-1", unit: "pcs", warehouseId: 1, warehouseName: "Основной", onDefault: true,
  batchNumber: "L-1", expiresAt: "2099-03-20", daysLeft: 10, quantity: 100, state: "soon", verdict: "short", pacePerDay: 6, sold: 60, unsold: 40,
  sellOutDays: null, price: 100, atRiskSale: 4000, advice: { pct: 20, price: 80 }, needsDirector: false, markdown: null,
  costPrice: 50, value: 5000, atRiskCost: 2000, adviceMoney: { unitMargin: 30, belowCost: false, costKnown: true, recovered: 3200, writeOff: 2000 },
  ...over,
});
const asOperator = (r: R): R => ({ ...r, costPrice: null, value: null, atRiskCost: null, adviceMoney: null });

const ROWS = [
  row({}),
  row({ batchId: 2, productId: 2, productName: "Соус", verdict: "no_sales", pacePerDay: 0, sold: 0, unsold: 30, quantity: 30, atRiskSale: 2700, price: 90,
        advice: { pct: 20, price: 72 }, needsDirector: true, costPrice: 85, atRiskCost: 2550,
        adviceMoney: { unitMargin: -13, belowCost: true, costKnown: true, recovered: 2160, writeOff: 2550 } }),
  row({ batchId: 3, productId: 3, productName: "Кефир", markdown: { price: 70, endsOn: "2099-03-20", batchId: 3 }, atRiskCost: 500, atRiskSale: 900 }),
  row({ batchId: 4, productId: 4, productName: "Сметана", verdict: "expired", daysLeft: -2, state: "expired", sold: 0, unsold: 12, quantity: 12, advice: null, adviceMoney: null, atRiskCost: 720, atRiskSale: 1200 }),
  row({ batchId: 5, productId: 5, productName: "Вода", verdict: "sells", sold: 50, unsold: 0, quantity: 50, sellOutDays: 4, advice: null, adviceMoney: null, atRiskCost: 0, atRiskSale: 0 }),
];
const SUMMARY = { riskCount: 3, riskCost: 5050, riskSale: 7600, expiredCount: 1, expiredCost: 720, expiredSale: 1200, sellsCount: 1, markedDown: 1 };

const mount = () => render(<LangProvider><MemoryRouter><ExpiringBatches /></MemoryRouter></LangProvider>);
const nameOf = new Map(ROWS.map(r => [`expiry-row-${r.batchId}`, r.productName]));
const names = () => screen.getAllByTestId(/^expiry-row-/).map(el => nameOf.get(el.getAttribute("data-testid") ?? ""));
/** Текст без неразрывных пробелов: toLocaleString("ru-RU") ставит их между разрядами. */
const text = (el: Element | null) => (el?.textContent ?? "").replace(/[\u00a0\u202f]/g, " ");

beforeEach(() => {
  h.role = "ceo";
  h.rows = ROWS;
  h.summary = SUMMARY;
  for (const f of [h.setMarkdown, h.clearMarkdown, h.adjust, h.exportToExcel, h.navigate]) f.mockReset();
  try { localStorage.setItem("lang", "ru"); } catch { /* */ }
});
afterEach(cleanup);

describe("«Сроки» — рабочее место", () => {
  it("1. директор: «не успеют» первыми, дороже — выше; причина, подсказка, маржа, «ниже закупки», «Уценить»", () => {
    mount();
    expect(screen.getByTestId("expiry-tile-risk").getAttribute("aria-pressed")).toBe("true");
    expect(text(screen.getByTestId("expiry-tile-risk"))).toContain("сгорит 5 050 сум по закупке");
    expect(names()).toEqual(["Соус", "Йогурт", "Кефир"]);
    const yog = screen.getByTestId("expiry-row-1");
    expect(text(yog)).toContain("Уходит 6 шт в день: до срока продастся ~60 шт из 100 шт, останется 40 шт");
    expect(text(yog)).toContain("Совет: скидка 20 %");
    expect(text(yog)).toContain("80 сум 100 сум"); // цена со скидкой и зачёркнутая карточка
    expect(text(yog)).toContain("Маржа останется 30 сум за шт");
    expect(text(yog)).toContain("2 000 сум");
    const sauce = screen.getByTestId("expiry-row-2");
    expect(text(sauce)).toContain("Ниже закупки на 13 сум за шт. Но списание — минус 2 550 сум, а так вернётся 2 160 сум");
    expect(screen.getByTestId("expiry-markdown-2")).toBeTruthy();
  });

  it("2. уценённая партия: «Уценено», снять — по товару", () => {
    mount();
    const kefir = screen.getByTestId("expiry-row-3");
    expect(text(kefir)).toContain("Уценено: 70 сум");
    expect(text(kefir)).toContain("агенты видят «Продать первым»");
    fireEvent.click(screen.getByTestId("expiry-clear-3"));
    expect(h.clearMarkdown).toHaveBeenCalledWith({ productId: 3 });
  });

  it("3. оператор: без закупки и маржи; ниже закупки — «ставит директор», без кнопки", () => {
    h.role = "operator";
    h.rows = ROWS.map(asOperator);
    h.summary = { ...SUMMARY, riskCost: null, expiredCost: null };
    mount();
    const page = text(document.body);
    expect(page).not.toContain("по закупке");
    expect(page).not.toContain("Маржа");
    expect(text(screen.getByTestId("expiry-tile-risk"))).toContain("на 7 600 сум по цене продажи");
    // Порядок — по тем деньгам, что видны: цена продажи.
    expect(names()).toEqual(["Йогурт", "Соус", "Кефир"]);
    expect(text(screen.getByTestId("expiry-row-2"))).toContain("Эта цена ниже закупки — уценку ставит директор");
    expect(screen.queryByTestId("expiry-markdown-2")).toBeNull();
    expect(screen.getByTestId("expiry-markdown-1")).toBeTruthy();
  });

  it("4. просроченные — своя плитка; «Списать» — расход с количеством партии", async () => {
    mount();
    fireEvent.click(screen.getByTestId("expiry-tile-expired"));
    expect(names()).toEqual(["Сметана"]);
    expect(text(screen.getByTestId("expiry-row-4"))).toContain("Срок вышел 2 дн. назад");
    fireEvent.click(screen.getByTestId("expiry-writeoff-4"));
    const submit = await screen.findByTestId("adjust-submit");
    fireEvent.click(submit);
    expect(h.adjust).toHaveBeenCalledWith({ productId: 4, warehouseId: 1, quantity: "12", type: "out", notes: "Просрочка: партия L-1, годен до 20.03.2099" });
    fireEvent.click(screen.getByTestId("expiry-tile-sells"));
    expect(text(screen.getByTestId("expiry-row-5"))).toContain("Делать ничего не нужно");
  });

  it("5. окно уценки: скидка ↔ цена, «ниже закупки» директору, уходит партия и цена", () => {
    mount();
    fireEvent.click(screen.getByTestId("expiry-markdown-1"));
    const pct = screen.getByTestId("markdown-pct") as HTMLInputElement;
    const price = screen.getByTestId("markdown-price") as HTMLInputElement;
    expect([pct.value, price.value]).toEqual(["20", "80"]);
    fireEvent.change(pct, { target: { value: "55" } });
    expect(price.value).toBe("45");
    expect(text(screen.getByTestId("markdown-below-cost"))).toContain("Ниже закупки на 5 сум за шт.");
    fireEvent.change(price, { target: { value: "75" } });
    expect(pct.value).toBe("25");
    expect(screen.queryByTestId("markdown-below-cost")).toBeNull();
    fireEvent.click(screen.getByTestId("markdown-submit"));
    expect(h.setMarkdown).toHaveBeenCalledWith({ batchId: 1, price: 75 });
  });

  it("6. выгрузка по-русски; закупка — только директору", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await Promise.resolve();
    const [[sheets, file]] = h.exportToExcel.mock.calls as [[Array<{ name: string; data: R[]; columns: Array<{ header: string }> }>, string]];
    expect(file).toBe("sroki-godnosti");
    expect(sheets[0].columns.map(c => c.header)).toContain("Сгорит, по закупке");
    expect(sheets[0].data[0]).toMatchObject({ product: "Соус", verdict: "Нет продаж", reason: "За 28 дней ни одной продажи — сама не уйдёт", cost: 85, atRiskCost: 2550 });
    cleanup();
    h.role = "operator";
    h.rows = ROWS.map(asOperator);
    h.exportToExcel.mockReset();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await Promise.resolve();
    const headers = (h.exportToExcel.mock.calls[0][0] as Array<{ columns: Array<{ header: string }> }>)[0].columns.map(c => c.header);
    expect(headers).not.toContain("Закупка за ед.");
    expect(headers).not.toContain("Сгорит, по закупке");
    expect(headers).toContain("Не продастся, по цене продажи");
  });
});

describe("«Сгорит на складе» на главной", () => {
  const home = () => render(<LangProvider><MemoryRouter><ExpiryHomeCard variant="desk" /></MemoryRouter></LangProvider>);

  it("7. только директору и только когда есть что делать; ведёт в «Сроки»", () => {
    h.role = "supervisor";
    home();
    expect(screen.queryByTestId("expiry-home-card")).toBeNull();
    cleanup();
    h.role = "ceo";
    h.summary = { ...SUMMARY, riskCount: 0, expiredCount: 0 };
    home();
    expect(screen.queryByTestId("expiry-home-card")).toBeNull();
    cleanup();
    h.summary = SUMMARY;
    home();
    const card = screen.getByTestId("expiry-home-card");
    expect(text(card)).toContain("не успеют до срока: 3 партии");
    expect(text(card)).toContain("просрочено: 1 партия");
    expect(text(within(card).getByTestId("expiry-home-risk"))).toBe("5 050 сум");
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith("/warehouse?tab=expiry");
  });

  it("7б. главные (стол и телефон) ставят карточку и не дублируют подсказки о сроках", () => {
    for (const f of ["src/pages/Dashboard.tsx", "src/components/phone/OversightHome.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/<ExpiryHomeCard variant="(desk|phone)" \/>/);
      expect(src, f).toContain("!EXPIRY_ALERT_TYPES.has(a.type)");
    }
    expect(readFileSync("src/pages/Dashboard.tsx", "utf8")).toContain('expired_stock: "/warehouse?tab=expiry", expiring_stock: "/warehouse?tab=expiry"');
  });
});

describe("агент видит «Продать первым»", () => {
  it("8. каталог: пометка, фильтр и уценённые первыми; в заказе — тоже", async () => {
    h.catalog = [
      { id: 1, code: "A", name: "Аджика", category: "Соусы", unitPrice: "9000.00", basePrice: "9000.00", available: "10", unit: "pcs", photoUrl: null, markdown: null },
      { id: 2, code: "Y", name: "Йогурт", category: "Молочные", unitPrice: "7600.00", basePrice: "9500.00", available: "40", unit: "pcs", photoUrl: null, markdown: { price: "7600.00", endsOn: "2099-03-20" } },
    ];
    const { default: Catalog } = await import("@/pages/Catalog");
    render(<LangProvider><MemoryRouter><Catalog /></MemoryRouter></LangProvider>);
    const cards = screen.getAllByTestId(/^catalog-card-/).map(el => el.getAttribute("data-testid"));
    expect(cards).toEqual(["catalog-card-2", "catalog-card-1"]);
    expect(text(screen.getByTestId("catalog-sell-first-2"))).toBe("Продать первым");
    fireEvent.click(screen.getByTestId("catalog-chip-sell-first"));
    expect(screen.getAllByTestId(/^catalog-card-/)).toHaveLength(1);
    cleanup();

    const { ProductSelector } = await import("@/components/orders/ProductSelector");
    render(<LangProvider><ProductSelector items={[]} onChange={() => {}} shopId={5} /></LangProvider>);
    const rows = screen.getAllByTestId(/^product-row-/).map(el => el.getAttribute("data-testid"));
    expect(rows).toEqual(["product-row-2", "product-row-1"]);
    expect(text(screen.getByTestId("product-sell-first-2"))).toBe("Продать первым · уценка до 20.03");
  });
});

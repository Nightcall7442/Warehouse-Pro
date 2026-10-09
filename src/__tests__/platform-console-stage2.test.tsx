// @vitest-environment jsdom
/**
 * Консоль платформы, этап 2, на экране: «Уходят», «почему», запись оплаты,
 * журнал, объявления и полоса объявления у организации.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Здоровья клиента не было вовсе — только «молчат» и «истекают» порознь.
 * Оплаты не записывались, продление делалось «Изменить тариф» на глаз.
 * Журнала действий консоли и объявлений организациям не было.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · «Организации»: чип «Уходят» пишет ?f=churn в адрес и показывает только
 *     уходящих; открытие по ссылке восстанавливает отбор; в строке — оценка
 *     и уровень;
 *   · карточка, «Обзор»: оценка, правило «уходит» словами и «почему» —
 *     плохое сверху;
 *   · «Подписка»: сумма предзаполнена ценой тарифа × месяцы и следует за
 *     месяцами и тарифом, пока её не поправили руками; период — от конца
 *     оплаченного (31.01 + 3 мес. = 30.04, а не 01.05); «Записать» шлёт ровно
 *     то, что на экране;
 *   · «Журнал»: отбор из адреса уходит в ручку, смена — в адрес;
 *   · «Объявления»: предпросмотр — та же полоса на обоих языках; отправка —
 *     с адресатами и сроком;
 *   · полоса у организации: по-русски и по-узбекски (узбекский — только если
 *     он есть), «закрыть» прячет сразу и зовёт announcement.dismiss.
 *
 * Нарочная поломка (проверено): inFilter("churn") по silentDays вместо
 * health.churn — падает «Уходят»; в PaymentForm считать период от сегодня —
 * падает «период от конца оплаченного»; сумма без × months — падает
 * «предзаполнена»; localized без проверки bodyUz — падает «узбекский
 * только парой»; не звать dismiss — падает «закрыть».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

const h = vi.hoisted(() => {
  const state = {
    data: {} as Record<string, unknown>,
    inputs: {} as Record<string, unknown[]>,
    calls: [] as Array<{ path: string; input: unknown }>,
    lang: "ru" as "ru" | "uz",
    user: { id: 7, name: "Директор", role: "ceo" } as { id: number; name: string; role: string },
  };
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      const key = path.join(".");
      if (k === "useQuery") return (input: unknown, opts?: { enabled?: boolean }) => {
        (state.inputs[key] ??= []).push(input);
        const off = opts?.enabled === false;
        return { data: off ? undefined : state.data[key], isLoading: false, isError: false, refetch: () => {} };
      };
      if (k === "useMutation") return () => ({ mutate: (input: unknown) => state.calls.push({ path: key, input }), isPending: false });
      if (k === "useUtils") return () => make(["utils"]);
      return make([...path, k]);
    },
  });
  return { state, trpc: make([]) };
});
vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, isLoading: false, logout: () => {} }), hadSession: () => true }));
vi.mock("@/i18n", async (orig) => ({ ...(await orig<object>()), useLang: () => ({ lang: h.state.lang, setLang: () => {}, t: (k: string) => k }) }));

const Orgs = (await import("@/pages/superadmin/Orgs")).default;
const OrgCard = (await import("@/pages/superadmin/OrgCard")).default;
const Journal = (await import("@/pages/superadmin/Journal")).default;
const Announcements = (await import("@/pages/superadmin/Announcements")).default;
const { AnnouncementBanner } = await import("@/components/AnnouncementBanner");

const DAY = 86_400_000;
const now = Date.now();

type Health = { score: number; level: "healthy" | "watch" | "churn"; churn: boolean; churnBecause: string[]; reasons: Array<{ tone: "good" | "bad" | "neutral"; text: string }>; parts: Record<string, number> };
const health = (score: number, level: Health["level"], churnBecause: string[] = [], reasons: Health["reasons"] = []): Health => ({
  score, level, churn: level === "churn", churnBecause, reasons,
  parts: { activity: 30, trend: 0, payment: 6, breadth: 9, people: 5 },
});
const seg = { client: true, paying: true, trial: false, trialLive: false, renewalDays: null, silentDays: null, active7: true, price: 599_000 };
const org = (id: number, name: string, h: Health | null) => ({
  id, name, slug: `org-${id}`, plan: "pro", status: "active", isSandbox: false, createdAt: new Date(now - 90 * DAY),
  trialEndsAt: null, planExpiresAt: null, ownerEmail: `o${id}@x.uz`, ownerPhone: null, signupSource: null,
  userCount: 3, orderCount: 10, orderTotal: 0, subscription: { status: "active", plan: "pro", trialEndsAt: null, currentPeriodEnds: new Date(now + 30 * DAY) },
  orders30: 9, revenue30: 1_000_000, lastOrderAt: null, lastLoginAt: null, lastActivityAt: new Date(now - DAY), segment: seg,
  contactPhone: null, contactEmail: `o${id}@x.uz`, inn: null, health: h,
});
const ROWS = () => [
  org(1, "Здоровая", health(92, "healthy")),
  org(2, "Обвал", health(41, "churn", ["заказы упали на 64% к прошлому месяцу"], [
    { tone: "bad", text: "заказы упали на 64% к прошлому месяцу (9 против 25)" },
    { tone: "bad", text: "срок истекает через 3 дня" },
    { tone: "good", text: "работали сегодня" },
  ])),
  org(3, "Наблюдаем", health(58, "watch")),
  org(4, "Песочница", null),
];

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const at = (url: string, path: string, el: React.ReactNode) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path={path} element={<>{el}<Where /></>} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const params = () => new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1] ?? "");
const calls = (path: string) => h.state.calls.filter(c => c.path === path).map(c => c.input);

beforeEach(() => {
  h.state.calls = [];
  h.state.inputs = {};
  h.state.lang = "ru";
  h.state.user = { id: 7, name: "Директор", role: "ceo" };
  h.state.data = {
    "tenant.list": ROWS(),
    "tenant.platformStats": { tenants: 4, users: 12, orders: 40, revenue: 1, byPlan: {}, byStatus: {}, growth: [] },
    "tenant.featureUsage": [],
  };
});
afterEach(cleanup);

describe("«Организации»: Уходят", () => {
  it("чип «Уходят» пишет ?f=churn и оставляет только уходящих; по ссылке — тот же отбор", () => {
    at("/super-admin/orgs", "/super-admin/orgs", <Orgs />);
    const chip = screen.getByTestId("filter-churn");
    expect(chip.textContent).toBe("Уходят1");
    fireEvent.click(chip);
    expect(params().get("f")).toBe("churn");
    const rows = within(screen.getByTestId("orgs-table")).getAllByTestId("org-row");
    expect(rows.map(r => r.querySelector("a")?.textContent)).toEqual(["Обвал"]);
    expect(within(rows[0]).getByTestId("org-health-cell").textContent).toBe("41 · Уходит");

    cleanup();
    at("/super-admin/orgs?f=churn", "/super-admin/orgs", <Orgs />);
    expect(screen.getByTestId("filter-churn").getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("orgs-table")).getAllByTestId("org-row")).toHaveLength(1);
  });

  it("сортировка по здоровью: худшие сверху, без оценки — в конце", () => {
    at("/super-admin/orgs?sort=health&dir=asc", "/super-admin/orgs", <Orgs />);
    const names = within(screen.getByTestId("orgs-table")).getAllByTestId("org-row").map(r => r.querySelector("a")?.textContent);
    expect(names).toEqual(["Обвал", "Наблюдаем", "Здоровая", "Песочница"]);
  });
});

/* ── Карточка ──────────────────────────────────────────────────────────── */

const detail = (periodEnds: Date | null, plan = "pro", status = "active") => ({
  tenant: {
    id: 2, slug: "obval", name: "Обвал", plan, status: "active", trialEndsAt: null, planExpiresAt: null,
    ownerEmail: "boss@x.uz", ownerPhone: null, maxUsers: null, maxProducts: null, maxOrdersMonth: null,
    extraUsers: 0, extraProducts: 0, manualEnabledAt: null, createdAt: new Date(now - 200 * DAY), updatedAt: new Date(now - DAY),
  },
  subscription: [{ id: "s", plan, status, trialEndsAt: null, currentPeriodEnds: periodEnds }],
  users: [], stats: { orders: 34, revenue: 1, products: 1, shops: 1 }, monthlyOrders: [],
});

describe("карточка: «почему»", () => {
  it("оценка, правило «уходит» словами и причины — плохое сверху", () => {
    h.state.data["tenant.getDetail"] = detail(new Date(now + 3 * DAY));
    at("/super-admin/orgs/2", "/super-admin/orgs/:id", <OrgCard />);
    expect(screen.getByTestId("org-health-score").textContent).toBe("41");
    expect(screen.getByTestId("org-health-churn").textContent).toContain("Уходит: заказы упали на 64% к прошлому месяцу.");
    const reasons = within(screen.getByTestId("org-health-reasons")).getAllByRole("listitem");
    expect(reasons.map(r => [r.getAttribute("data-tone"), r.textContent])).toEqual([
      ["bad", "заказы упали на 64% к прошлому месяцу (9 против 25)"],
      ["bad", "срок истекает через 3 дня"],
      ["good", "работали сегодня"],
    ]);
    expect(screen.getByTestId("org-health-parts").textContent).toContain("Оплата6 / 20");
  });
});

describe("карточка: записать оплату", () => {
  /*
    Сумма зависит от даты: прежний Pro до 05.10.2027 — 599 000, после — за
    полевых (contracts/pricing.ts). Часы — на день решения, сроки — числами.
  */
  const pin = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-05T09:00:00Z")); };
  afterEach(() => { vi.useRealTimers(); });

  it("сумма предзаполнена ценой × месяцы и следует за ними, пока не поправили руками", () => {
    pin();
    h.state.data["tenant.getDetail"] = detail(new Date("2026-10-15T10:00:00Z"));
    at("/super-admin/orgs/2/subscription", "/super-admin/orgs/:id/:tab", <OrgCard />);
    const amount = () => (screen.getByTestId("pay-amount") as HTMLInputElement).value;
    expect(amount()).toBe("599 000");
    fireEvent.change(screen.getByTestId("pay-months"), { target: { value: "3" } });
    expect(amount()).toBe("1 797 000");
    fireEvent.change(screen.getByTestId("pay-amount"), { target: { value: "1 500 000" } });
    fireEvent.change(screen.getByTestId("pay-months"), { target: { value: "4" } });
    expect(amount()).toBe("1 500 000");
    expect(screen.getByTestId("sub-payment").textContent).toContain("По прайсу было бы 2 396 000 сум");
  });

  it("период — от конца оплаченного; «Записать» шлёт то, что на экране", () => {
    // 31.01.2030 15:00 по Ташкенту: + 3 месяца = 30.04 (в апреле 30 дней), а не 01.05.
    // Период целиком после 05.10.2027: прежний Pro там уже «Стандарт» — за
    // полевых; их нет, значит минимум: 3 × 119 000 × 3 мес.
    h.state.data["tenant.getDetail"] = detail(new Date("2030-01-31T10:00:00Z"));
    at("/super-admin/orgs/2/subscription", "/super-admin/orgs/:id/:tab", <OrgCard />);
    fireEvent.change(screen.getByTestId("pay-months"), { target: { value: "3" } });
    expect(screen.getByTestId("pay-period").textContent).toBe("31.01.2030 — 30.04.2030");
    fireEvent.change(screen.getByTestId("pay-date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByTestId("pay-note"), { target: { value: "  счёт № 14 " } });
    fireEvent.click(screen.getByTestId("pay-submit"));
    expect(screen.getByTestId("pay-basis").textContent).toBe("0 полевых (к оплате 3) × 119 000 × 3 мес.");
    expect(calls("platform.recordPayment")).toEqual([{ tenantId: 2, amount: 1_071_000, paidAt: "2026-10-01", method: "transfer", plan: "pro", months: 3, note: "счёт № 14" }]);
  });

  it("«Стандарт»: полевые × 119 000, год — со скидкой 15 %, отключённые не считаются", () => {
    pin();
    const d = detail(new Date("2026-10-15T10:00:00Z"), "standard");
    const person = (id: number, role: string, status = "active") => ({ id, name: `p${id}`, email: `p${id}@x`, role, status, lastSignInAt: null, createdAt: new Date() });
    d.users = [person(1, "agent"), person(2, "agent"), person(3, "agent"), person(4, "courier"), person(5, "merchandiser"),
      person(6, "courier", "inactive"), person(7, "operator"), person(8, "supervisor"), person(9, "ceo")] as never;
    h.state.data["tenant.getDetail"] = d;
    at("/super-admin/orgs/2/subscription", "/super-admin/orgs/:id/:tab", <OrgCard />);
    const amount = () => (screen.getByTestId("pay-amount") as HTMLInputElement).value;
    expect(screen.getByTestId("sub-field-users").textContent).toMatch(/^5/);
    expect(screen.getByTestId("sub-price-now").textContent).toBe("595 000 сум/мес");
    expect(amount()).toBe("595 000");
    fireEvent.change(screen.getByTestId("pay-months"), { target: { value: "12" } });
    expect(amount()).toBe("6 069 000");
    expect(screen.getByTestId("pay-basis").textContent).toContain("год со скидкой 15%");
  });

  it("прежний Pro: цена сейчас и с 05.10.2027 — рядом", () => {
    pin();
    const d = detail(new Date("2026-10-15T10:00:00Z"), "pro");
    d.users = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `a${i}`, email: `a${i}@x`, role: "agent", status: "active", lastSignInAt: null, createdAt: new Date() })) as never;
    h.state.data["tenant.getDetail"] = d;
    at("/super-admin/orgs/2/subscription", "/super-admin/orgs/:id/:tab", <OrgCard />);
    expect(screen.getByTestId("sub-price-now").textContent).toBe("599 000 сум/мес");
    expect(screen.getByTestId("sub-price-next").textContent).toBe("833 000 сум/мес");
  });

  it("истёкший срок — период от сегодня; платящей не показан «Продлить пробный»", () => {
    h.state.data["tenant.getDetail"] = detail(new Date(now - 5 * DAY));
    at("/super-admin/orgs/2/subscription", "/super-admin/orgs/:id/:tab", <OrgCard />);
    const today = new Date(now + 5 * 3_600_000).toISOString().slice(0, 10).split("-").reverse().join(".");
    expect(screen.getByTestId("pay-period").textContent!.startsWith(today)).toBe(true);
    expect(screen.queryByTestId("sub-trial")).toBeNull();
  });
});

describe("«Журнал»", () => {
  it("отбор из адреса уходит в ручку; смена периода — в адрес", () => {
    h.state.data["platform.journal"] = { rows: [], nextBefore: null };
    at("/super-admin/journal?type=money&org=2&period=30&q=Обвал", "/super-admin/journal", <Journal />);
    expect(h.state.inputs["platform.journal"].at(-1)).toEqual({ type: "money", tenantId: 2, days: 30, q: "Обвал", limit: 50 });
    fireEvent.click(screen.getByTestId("journal-period-all"));
    expect(params().get("period")).toBeNull();
    expect(h.state.inputs["platform.journal"].at(-1)).toEqual({ type: "money", tenantId: 2, days: undefined, q: "Обвал", limit: 50 });
  });
});

describe("«Объявления»: создание с предпросмотром", () => {
  it("предпросмотр — та же полоса на обоих языках; отправка — с адресатами и сроком", () => {
    h.state.data["platform.announcements"] = [];
    at("/super-admin/announcements?new=1", "/super-admin/announcements", <Announcements />);
    fireEvent.change(screen.getByTestId("ann-title"), { target: { value: "Обновление в субботу" } });
    fireEvent.change(screen.getByTestId("ann-body"), { target: { value: "С 23:00 до 23:30." } });
    const preview = () => within(screen.getByTestId("ann-preview"));
    expect(preview().getByTestId("announcement-title").textContent).toBe("Обновление в субботу");

    fireEvent.click(screen.getByTestId("ann-add-uz"));
    fireEvent.change(screen.getByTestId("ann-title-uz"), { target: { value: "Shanba kuni yangilanish" } });
    fireEvent.change(screen.getByTestId("ann-body-uz"), { target: { value: "23:00 dan 23:30 gacha." } });
    expect(preview().getByTestId("announcement-title").textContent).toBe("Shanba kuni yangilanish");
    fireEvent.click(screen.getByTestId("ann-preview-ru"));
    expect(preview().getByTestId("announcement-body").textContent).toBe("С 23:00 до 23:30.");

    fireEvent.click(screen.getByTestId("ann-level-warning"));
    expect(preview().getByRole("status").getAttribute("data-level")).toBe("warning");
    fireEvent.click(screen.getByTestId("ann-aud-plans"));
    expect((screen.getByTestId("ann-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ann-plan-pro"));
    fireEvent.click(screen.getByTestId("ann-submit"));
    const [sent] = calls("platform.createAnnouncement") as Array<Record<string, unknown>>;
    expect(sent).toMatchObject({
      title: "Обновление в субботу", body: "С 23:00 до 23:30.", titleUz: "Shanba kuni yangilanish", bodyUz: "23:00 dan 23:30 gacha.",
      level: "warning", audience: "plans", plans: ["pro"], tenantIds: undefined,
    });
    expect((sent.endsAt as Date).getTime() - (sent.startsAt as Date).getTime()).toBe(24 * 3_600_000);
  });
});

describe("полоса объявления у организации", () => {
  const ANN = [
    { id: 11, level: "warning", title: "Обновление", body: "В субботу ночью.", titleUz: "Yangilanish", bodyUz: "Shanba kuni tunda." },
    { id: 12, level: "info", title: "Новая накладная", body: "Компактная — в настройках.", titleUz: null, bodyUz: null },
  ];
  it("по-русски", () => {
    h.state.data["announcement.active"] = ANN;
    render(<AnnouncementBanner />);
    expect(screen.getAllByTestId("announcement-title").map(e => e.textContent)).toEqual(["Обновление", "Новая накладная"]);
    expect(screen.getAllByTestId("announcement-close")[0].getAttribute("aria-label")).toBe("Закрыть");
  });

  it("по-узбекски — где узбекский есть; без него — по-русски", () => {
    h.state.lang = "uz";
    h.state.data["announcement.active"] = ANN;
    render(<AnnouncementBanner />);
    expect(screen.getAllByTestId("announcement-title").map(e => e.textContent)).toEqual(["Yangilanish", "Новая накладная"]);
    expect(screen.getAllByTestId("announcement-body")[0].textContent).toBe("Shanba kuni tunda.");
    expect(screen.getAllByTestId("announcement-close")[0].getAttribute("aria-label")).toBe("Yopish");
  });

  it("узбекский только парой: заголовок без текста — по-русски целиком", () => {
    h.state.lang = "uz";
    h.state.data["announcement.active"] = [{ ...ANN[0], bodyUz: null }];
    render(<AnnouncementBanner />);
    expect(screen.getByTestId("announcement-title").textContent).toBe("Обновление");
    expect(screen.getByTestId("announcement-body").textContent).toBe("В субботу ночью.");
  });

  it("«закрыть» прячет сразу и зовёт announcement.dismiss", () => {
    h.state.data["announcement.active"] = ANN;
    render(<AnnouncementBanner />);
    fireEvent.click(screen.getAllByTestId("announcement-close")[0]);
    expect(screen.getAllByTestId("announcement-title").map(e => e.textContent)).toEqual(["Новая накладная"]);
    expect(calls("announcement.dismiss")).toEqual([{ id: 11 }]);
  });

  it("суперадмину — ни полосы, ни запроса", () => {
    h.state.user = { id: 1, name: "Владелец", role: "superadmin" };
    h.state.data["announcement.active"] = ANN;
    const { container } = render(<AnnouncementBanner />);
    expect(container.textContent).toBe("");
  });
});

// @vitest-environment jsdom
/**
 * «Организации» консоли: фильтры, поиск и сортировка — в адресе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Список — шестой блок общей страницы: поиск по имени, slug и почте, два
 * выпадающих фильтра (тариф, статус), счётчики за всё время. Ни «молчат», ни
 * «истекают», ни ИНН с телефоном; фильтр жил в состоянии и пропадал после
 * карточки; платящему без строки подписки срок считался по давнему пробному.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · чипы показывают своих — по сегментам сервера (тем же правилом, что
 *     панель владельца), с числом у каждого; «Приостановлены» — по статусу;
 *     «Сверх тарифа» появляется, только когда такие есть;
 *   · тариф — отдельным выбором (?plan=…), как «Все тарифы» прежнего списка;
 *   · фильтр, поиск и сортировка — в адресе: открытие по ссылке
 *     восстанавливает список, нажатие пишет в адрес;
 *   · поиск по названию (ё=е), slug, ИНН, телефону владельца кусками цифр,
 *     почте; пустой результат — словами, а не пустой таблицей;
 *   · сортировка по столбцу и обратно; бессрочные — в конце по сроку;
 *   · срок и статус — по подписке, как калитка доступа; без подписки
 *     платный судится по оплаченному сроку, а не по давнему пробному;
 *   · строка ведёт в карточку /super-admin/orgs/:id.
 *
 * Нарочная поломка (проверено): в inFilter «silent» считать на глаз по
 * lastActivityAt с порогом 7 дней вместо сегмента сервера — падают «чипы»;
 * чип перестаёт писать set({ f }) — «Молчат» из адреса…»;
 * искать телефон без чистки от пробелов — «поиск»; в endsAt вернуть
 * trialEndsAt первым делом — «срок по подписке».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

const h = vi.hoisted(() => {
  const state = { data: {} as Record<string, unknown> };
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: state.data[path.join(".")], isLoading: false, isError: false, refetch: () => {} });
      if (k === "useMutation") return () => ({ mutate: () => {}, isPending: false });
      if (k === "useUtils") return () => make(["utils"]);
      return make([...path, k]);
    },
  });
  return { state, trpc: make([]) };
});
vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));

const Orgs = (await import("@/pages/superadmin/Orgs")).default;
const O = await import("@/components/superadmin/console/orgs");

const DAY = 86_400_000;
const now = Date.now();
type Row = Parameters<typeof O.matches>[0];
const seg = (s: Partial<Row["segment"]> = {}): Row["segment"] => ({ client: true, paying: false, trial: false, trialLive: false, renewalDays: null, silentDays: null, active7: true, price: 0, ...s });
const org = (id: number, name: string, extra: Partial<Row> = {}): Row => ({
  id, name, slug: `org-${id}`, plan: "basic", status: "active", isSandbox: false, createdAt: new Date(now - 90 * DAY),
  trialEndsAt: null, planExpiresAt: null, ownerEmail: `o${id}@x.uz`, ownerPhone: null, signupSource: null,
  userCount: 1, orderCount: 0, orderTotal: 0, subscription: null, orders30: 0, revenue30: 0,
  lastOrderAt: null, lastLoginAt: null, lastActivityAt: new Date(now - DAY), segment: seg(),
  contactPhone: null, contactEmail: `o${id}@x.uz`, inn: null, ...extra,
} as unknown as Row);

const ROWS = (): Row[] => [
  org(1, "Самарканд Дистрибьюшн", { plan: "pro", inn: "305112233", contactPhone: "+998901112233", userCount: 7, orders30: 24, revenue30: 50_462_000,
    subscription: { status: "active", plan: "pro", trialEndsAt: null, currentPeriodEnds: new Date(now + 41 * DAY) } as Row["subscription"],
    segment: seg({ paying: true, price: 599_000 }) }),
  org(2, "Бухара Сок", { plan: "exclusive", inn: "306554433", contactPhone: "+998935554433", userCount: 10, orders30: 31, revenue30: 90_370_000,
    subscription: { status: "active", plan: "exclusive", trialEndsAt: null, currentPeriodEnds: new Date(now + 9 * DAY) } as Row["subscription"],
    segment: seg({ paying: true, renewalDays: 9, price: 1_299_000 }) }),
  org(3, "Фергана Фуд Сервис", { contactPhone: "+998913334455", orders30: 2, revenue30: 2_100_000, lastActivityAt: new Date(now - 8 * DAY),
    subscription: { status: "active", plan: "basic", trialEndsAt: null, currentPeriodEnds: new Date(now + 25 * DAY) } as Row["subscription"],
    segment: seg({ paying: true, silentDays: 8, active7: false, price: 299_000 }) }),
  org(4, "Наманган Трейд", { plan: "trial", contactPhone: "+998946667788", lastActivityAt: new Date(now - 6 * DAY),
    subscription: { status: "trialing", plan: "trial", trialEndsAt: new Date(now + 6 * DAY), currentPeriodEnds: null } as Row["subscription"],
    segment: seg({ trial: true, trialLive: true, silentDays: 6, active7: false }) }),
  org(5, "Хорезм Опт", { status: "suspended", segment: seg({ client: false }) }),
  org(6, "Ёлка Маркет", { ownerEmail: "boss@yolka.uz", contactEmail: "boss@yolka.uz",
    subscription: { status: "active", plan: "basic", trialEndsAt: null, currentPeriodEnds: null } as Row["subscription"],
    segment: seg({ paying: true, price: 299_000 }) }),
];

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const show = (url = "/super-admin/orgs") => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/super-admin/orgs" element={<><Orgs /><Where /></>} />
      <Route path="/super-admin/orgs/:id" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const names = () => within(screen.getByTestId("orgs-table")).getAllByTestId("org-row").map(r => r.querySelector("a")?.textContent);
const params = () => new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1] ?? "");

beforeEach(() => {
  h.state.data = {
    "tenant.list": ROWS(),
    "tenant.platformStats": { tenants: 6, users: 20, orders: 300, revenue: 1_000_000, byPlan: { trial: 1, basic: 3, pro: 1, exclusive: 1 }, byStatus: { active: 5, suspended: 1 }, growth: [] },
    "tenant.featureUsage": [],
  };
});
afterEach(cleanup);

describe("чипы", () => {
  it("каждый показывает своих и считает их", () => {
    show();
    const count = (k: string) => screen.getByTestId(`filter-${k}`).textContent;
    expect(count("all")).toBe("Все6");
    expect(count("paying")).toBe("Платят4");
    expect(count("trial")).toBe("Пробные1");
    expect(count("expiring")).toBe("Истекают ≤14 дн1");
    expect(count("silent")).toBe("Молчат 5+ дн2");
    expect(count("suspended")).toBe("Приостановлены1");
    expect(screen.queryByTestId("filter-overreach"), "«Сверх тарифа» без таких").toBeNull();
  });

  it("«Молчат» из адреса — ровно молчащие; нажатие на чип пишет фильтр в адрес", () => {
    show("/super-admin/orgs?f=silent");
    expect(names()).toEqual(expect.arrayContaining(["Фергана Фуд Сервис", "Наманган Трейд"]));
    expect(names()).toHaveLength(2);
    expect(screen.getByTestId("filter-silent").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("filter-suspended"));
    expect(params().get("f")).toBe("suspended");
    expect(names()).toEqual(["Хорезм Опт"]);
    fireEvent.click(screen.getByTestId("filter-all"));
    expect(params().has("f")).toBe(false);
    expect(names()).toHaveLength(6);
  });

  it("«Сверх тарифа» — когда отчёт по тарифам нашёл таких, и фильтрует по нему", () => {
    h.state.data["tenant.featureUsage"] = [{ tenantId: 2, overreach: ["gps"] }, { tenantId: 1, overreach: [] }];
    show("/super-admin/orgs?f=overreach");
    expect(screen.getByTestId("filter-overreach").textContent).toBe("Сверх тарифа1");
    expect(names()).toEqual(["Бухара Сок"]);
  });
});

describe("поиск — в адресе", () => {
  it("по ИНН, куску телефона, почте, «ё» как «е»", () => {
    show();
    const box = screen.getByTestId("orgs-search");
    fireEvent.change(box, { target: { value: "306 554" } });
    expect(params().get("q")).toBe("306 554");
    expect(names()).toEqual(["Бухара Сок"]);
    fireEvent.change(box, { target: { value: "91 333 44" } });
    expect(names()).toEqual(["Фергана Фуд Сервис"]);
    fireEvent.change(box, { target: { value: "boss@yolka" } });
    expect(names()).toEqual(["Ёлка Маркет"]);
    fireEvent.change(box, { target: { value: "елка" } });
    expect(names()).toEqual(["Ёлка Маркет"]);
  });

  it("тариф — отдельным выбором из адреса (как «Все тарифы» прежнего списка)", () => {
    show("/super-admin/orgs?plan=exclusive");
    expect(names()).toEqual(["Бухара Сок"]);
    cleanup();
    show("/super-admin/orgs?plan=pro&f=paying");
    expect(names()).toEqual(["Самарканд Дистрибьюшн"]);
  });

  it("ссылка с поиском и фильтром открывает тот же список; пусто — словами", () => {
    show("/super-admin/orgs?f=paying&q=%D1%81%D0%B0%D0%BC%D0%B0%D1%80");
    expect(names()).toEqual(["Самарканд Дистрибьюшн"]);
    // Счётчики чипов — внутри найденного.
    expect(screen.getByTestId("filter-paying").textContent).toBe("Платят1");
    fireEvent.change(screen.getByTestId("orgs-search"), { target: { value: "нет такой" } });
    expect(screen.getByTestId("orgs-empty").textContent).toContain("Никого не нашли");
  });
});

describe("сортировка", () => {
  it("по выручке за 30 дней — сверху большие, повторно — наоборот; в адресе", () => {
    show();
    fireEvent.click(screen.getByTestId("sort-revenue30"));
    expect(params().get("sort")).toBe("revenue30");
    expect(params().get("dir")).toBe("desc");
    expect(names()!.slice(0, 3)).toEqual(["Бухара Сок", "Самарканд Дистрибьюшн", "Фергана Фуд Сервис"]);
    fireEvent.click(screen.getByTestId("sort-revenue30"));
    expect(params().get("dir")).toBe("asc");
    expect(names()!.at(-1)).toBe("Бухара Сок");
  });

  it("по сроку — ближайшие сверху, бессрочные в конце", () => {
    show("/super-admin/orgs?sort=ends&dir=asc&f=paying");
    expect(names()).toEqual(["Бухара Сок", "Фергана Фуд Сервис", "Самарканд Дистрибьюшн", "Ёлка Маркет"]);
  });
});

describe("строка", () => {
  it("ведёт в карточку", () => {
    show();
    fireEvent.click(within(screen.getByTestId("orgs-table")).getByText("Бухара Сок"));
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/orgs/2");
  });

  it("на телефоне — карточки с телефоном ссылкой", () => {
    show("/super-admin/orgs?f=silent");
    const cards = within(screen.getByTestId("orgs-cards")).getAllByTestId("org-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('a[href^="tel:"]')?.getAttribute("href")).toMatch(/^tel:\+998\d{9}$/);
  });
});

describe("срок и статус — по подписке", () => {
  it("платный без строки подписки — по оплаченному, не по давнему пробному", () => {
    const o = org(9, "X", { plan: "basic", trialEndsAt: new Date(now - 40 * DAY), planExpiresAt: new Date(now + 20 * DAY + 3_600_000) });
    expect(O.daysLeft(o)).toBe(21);
    expect(O.statusOf(o).label).toBe("Платит");
  });

  it("с подпиской — по ней: пробный по концу пробного, отменённая — «Не оплачена»", () => {
    const trial = org(9, "X", { plan: "basic", subscription: { status: "trialing", plan: "basic", trialEndsAt: new Date(now + 5 * DAY + 3_600_000), currentPeriodEnds: null } as Row["subscription"], segment: seg({ trial: true }) });
    expect(O.daysLeft(trial)).toBe(6);
    expect(O.statusOf(trial).label).toBe("Пробный");
    const canceled = org(9, "X", { plan: "pro", subscription: { status: "canceled", plan: "pro", trialEndsAt: null, currentPeriodEnds: new Date(now + DAY) } as Row["subscription"] });
    expect(O.statusOf(canceled)).toEqual({ label: "Не оплачена", tone: "danger" });
    expect(O.statusOf(org(9, "X", { status: "suspended" })).label).toBe("Приостановлена");
  });

  it("адрес без параметров — все, по активности, свежие сверху; мусор в адресе не ломает", () => {
    expect(O.readListParams(new URLSearchParams(""))).toEqual({ filter: "all", plan: "", q: "", sort: "activity", dir: "desc" });
    expect(O.readListParams(new URLSearchParams("f=bogus&plan=gold&sort=evil&dir=up"))).toEqual({ filter: "all", plan: "", q: "", sort: "activity", dir: "desc" });
  });
});

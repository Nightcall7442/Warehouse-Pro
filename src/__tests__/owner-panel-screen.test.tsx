// @vitest-environment jsdom
/**
 * «Обзор» консоли платформы — кто платит, кто уходит, что требует внимания.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Сначала наверху суперадминки стояли счётчики по всей платформе и ни одного
 * ответа о деньгах и уходе клиентов. Потом появилась панель владельца
 * (OwnerPanel) — четыре списка «кому звонить» подряд, на общей странице
 * стопкой с обращениями, заявками и отчётом по тарифам. Ошибки сервера и
 * ночная копия базы жили на другой странице, о новых заявках узнавали,
 * долистав до них.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящий экран «Обзор» с ответами ручек (числа посчитаны на настоящей
 * базе в real-db/owner-panel.test.ts и real-db/tenant-list-aggregates; здесь
 * — показ):
 *   · шесть плиток (платят, MRR, активны из всех, пробные, молчат,
 *     продления), каждая — ссылка на свой фильтр списка; подпись к MRR
 *     честная («по прайсу, без скидок»);
 *   · «Требует внимания»: истекают, молчат, новые заявки, обращения ждут
 *     ответа, ошибки за сутки, копия базы (старше 26 ч — красным), сверх
 *     тарифа — у каждого число и адрес, где с ним работают;
 *   · «Кому позвонить»: у каждой строки телефон ссылкой tel:, цель касания не
 *     меньше 44 точек; без телефона — так и сказано; пустой список — словами;
 *   · воронка: счётчик у каждого этапа; у пробной — этап и источник.
 *
 * Нарочная поломка (проверено): заменить href звонка на пустой — падает
 * «телефон ссылкой»; снять minHeight — «цель касания»; убрать подпись к MRR
 * — «подпись»; поставить порог копии 48 ч — «копия базы»; считать обращения
 * по сообщениям — «требует внимания».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, refetched: [] as string[] }));
vi.mock("@/providers/trpc", () => {
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: state.data[path.join(".")], isLoading: false, isError: false, refetch: () => state.refetched.push(path.join(".")) });
      if (k === "useUtils") return () => make(["utils"]);
      return make([...path, k]);
    },
  });
  return { trpc: make([]) };
});

const Overview = (await import("@/pages/superadmin/Overview")).default;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const panel = () => ({
  generatedAt: new Date(now),
  clients: 12,
  activeLast7: 9,
  paying: {
    count: 2, mrr: 898_000,
    list: [
      { tenantId: 1, name: "Бессрочный Про", plan: "pro", price: 599_000, periodEnds: null, phone: "+998 91 000 00 01", email: "ceo@forever.uz" },
      { tenantId: 2, name: "Платит Базовый", plan: "basic", price: 299_000, periodEnds: new Date(now + 40 * DAY), phone: "+998901110001", email: null },
    ],
  },
  silent: [
    { tenantId: 3, name: "Молчит Про", kind: "paying", plan: "pro", lastActivityAt: new Date(now - 7 * DAY), silentDays: 7, phone: "+998901110005", email: "q@x.uz" },
    { tenantId: 4, name: "Без номера", kind: "trial", plan: "trial", lastActivityAt: new Date(now - 8 * DAY), silentDays: 8, phone: null, email: "n@x.uz" },
  ],
  renewals: [],
  funnel: {
    stages: [
      { key: "registered", reached: 6 }, { key: "emailVerified", reached: 5 }, { key: "products", reached: 4 },
      { key: "agent", reached: 2 }, { key: "agentOrder", reached: 1 }, { key: "delivered", reached: 1 }, { key: "paid", reached: 1 },
    ],
    trials: [
      {
        tenantId: 5, name: "Пробный Оператор", createdAt: new Date(now - 12 * DAY), trialEndsAt: new Date(now + 2 * DAY),
        trialExpired: false, stage: "agent", done: ["registered", "emailVerified", "products", "agent"],
        source: "answer=referral; ref=bekzod", lastActivityAt: new Date(now - 4 * DAY), phone: "+998901110011", email: null,
      },
    ],
  },
});
const seg = (s: Record<string, unknown>) => ({ client: true, paying: false, trial: false, trialLive: false, renewalDays: null, silentDays: null, active7: true, price: 0, ...s });
const org = (id: number, name: string, s: Record<string, unknown>, createdDaysAgo: number) =>
  ({ id, name, slug: `o${id}`, plan: "trial", isSandbox: false, createdAt: new Date(now - createdDaysAgo * DAY), signupSource: null, subscription: null, segment: seg(s) });

beforeEach(() => {
  state.data = {
    "tenant.ownerPanel": panel(),
    "tenant.list": [
      org(5, "Пробный Оператор", { trial: true, trialLive: true }, 12),
      org(6, "Свежий пробный", { trial: true, trialLive: true }, 1),
      org(7, "Истёкший пробный", { trial: true, trialLive: false }, 30),
    ],
    "lead.list": [{ id: 1 }, { id: 2 }],
    "support.inbox": [{ unread: 4 }, { unread: 0 }, { unread: 1 }],
    "system.groupedErrors": [{ count: 3 }, { count: 2 }],
    "system.jobs": { generatedAt: new Date(), jobs: [{ name: "backup", lastSuccessAt: new Date(now - 5 * HOUR) }] },
    "tenant.featureUsage": [{ tenantId: 1, overreach: ["gps"] }, { tenantId: 2, overreach: [] }],
  };
});
afterEach(cleanup);
const show = () => render(<MemoryRouter><Overview /></MemoryRouter>);

describe("плитки", () => {
  it("платят, MRR с суммой, активные из всех, пробные, молчат, продления — и ведут в свой фильтр", () => {
    show();
    const tile = (k: string) => screen.getByTestId(`tile-${k}`);
    expect(tile("paying").textContent).toBe("Платят сейчас2");
    expect(tile("mrr").textContent).toMatch(/898\s000\s?сум/);
    expect(tile("active").textContent).toContain("из 12");
    expect(tile("trials").textContent).toContain("2");
    expect(tile("trials").textContent).toContain("ещё 1 с истёкшим сроком");
    expect(tile("silent").textContent).toContain("2");
    expect(tile("paying").getAttribute("href")).toBe("/super-admin/orgs?f=paying");
    expect(tile("silent").getAttribute("href")).toBe("/super-admin/orgs?f=silent");
    expect(tile("renewals").getAttribute("href")).toBe("/super-admin/orgs?f=expiring&sort=ends&dir=asc");
    expect(tile("trials").getAttribute("href")).toBe("/super-admin/orgs?f=trial");
  });

  it("подпись к MRR честная: прайс, без скидок и докупленных мест", () => {
    show();
    expect(screen.getByTestId("owner-mrr-note").textContent).toMatch(/по прайсу: без скидок и без докупленных мест/);
  });
});

describe("требует внимания", () => {
  const row = (k: string) => screen.getByTestId(`attn-${k}`);
  it("у каждого пункта число и адрес, где с ним работают", () => {
    show();
    expect(row("expiring").getAttribute("href")).toBe("/super-admin/orgs?f=expiring&sort=ends&dir=asc");
    expect(row("silent").textContent).toContain("2");
    expect(row("leads").getAttribute("href")).toBe("/super-admin/leads");
    expect(row("leads").textContent).toContain("2");
    // Обращения — числом разговоров, где ждут, а не сообщений (4 + 1).
    expect(row("support").textContent).toMatch(/ответа.*2$/);
    expect(row("support").getAttribute("href")).toBe("/super-admin/support");
    expect(row("errors").textContent).toContain("5");
    expect(row("errors").getAttribute("href")).toBe("/super-admin/system");
    expect(row("overreach").textContent).toContain("1 из 2");
    expect(row("overreach").getAttribute("href")).toBe("/super-admin/orgs?f=overreach");
  });

  it("копия базы: свежая — без тревоги; старше 26 часов — красная метка", () => {
    show();
    expect(row("backup").getAttribute("href")).toBe("/super-admin/system?tab=jobs");
    expect(row("backup").textContent).toContain("5 ч назад");
    expect(screen.queryByTestId("attn-backup-stale")).toBeNull();
    cleanup();
    state.data["system.jobs"] = { generatedAt: new Date(), jobs: [{ name: "backup", lastSuccessAt: new Date(now - 27 * HOUR) }] };
    show();
    expect(screen.getByTestId("attn-backup-stale").textContent).toBe("старше 26 ч");
    cleanup();
    state.data["system.jobs"] = { generatedAt: new Date(), jobs: [] };
    show();
    expect(row("backup").textContent).toContain("Удачных копий нет");
    expect(screen.getByTestId("attn-backup-stale")).toBeTruthy();
  });
});

describe("кому звонить", () => {
  it("телефон ссылкой tel:, номер группами; без номера — так и сказано", () => {
    show();
    const silent = screen.getByTestId("owner-silent");
    const call = within(silent).getAllByTestId("owner-call")[0] as HTMLAnchorElement;
    expect(call.getAttribute("href")).toBe("tel:+998901110005");
    expect(call.textContent).toContain("+998 90 111 00 05");
    expect(silent.textContent).toContain("тишина 7 дн.");
    expect(silent.textContent).toContain("телефона нет");

    // Номер из карточки директора, записанный с пробелами, — в ссылке без них.
    fireEvent.click(screen.getByTestId("owner-tab-paying"));
    const paying = screen.getByTestId("owner-paying");
    expect(within(paying).getAllByTestId("owner-call")[0].getAttribute("href")).toBe("tel:+998910000001");
    expect(paying.textContent).toContain("бессрочно");
  });

  it("цель касания у звонка и у названия — не меньше 44 точек", () => {
    show();
    for (const a of screen.getAllByTestId("owner-call")) {
      expect(parseInt((a as HTMLElement).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    }
    for (const r of screen.getAllByTestId("owner-row")) {
      expect(parseInt((r.querySelector("a") as HTMLElement).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it("пустой список — честным «пусто», а не пропавшим разделом", () => {
    show();
    fireEvent.click(screen.getByTestId("owner-tab-renewals"));
    expect(screen.getByTestId("owner-renewals").textContent).toContain("оплаченный срок не кончается ни у кого");
  });

  it("название ведёт в карточку организации", () => {
    show();
    expect(within(screen.getAllByTestId("owner-row")[0]).getByText("Молчит Про").closest("a")?.getAttribute("href")).toBe("/super-admin/orgs/3");
  });
});

describe("пробные по этапам", () => {
  it("счётчик у каждого этапа, этап и источник у строки", () => {
    show();
    expect(screen.getByTestId("owner-stage-registered").textContent).toContain("6");
    expect(screen.getByTestId("owner-stage-agent").textContent).toContain("Заведён агент");
    expect(screen.getByTestId("owner-stage-paid").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("owner-tab-trials"));
    const trials = screen.getByTestId("owner-trials");
    expect(trials.textContent).toContain("Пробный Оператор");
    expect(trials.textContent).toContain("Знакомые, рекомендация · ref: bekzod");
  });
});

describe("обновить", () => {
  it("кнопка в шапке перечитывает все числа обзора разом", () => {
    state.refetched = [];
    show();
    fireEvent.click(screen.getByTestId("overview-refresh"));
    expect(state.refetched.sort()).toEqual([
      "lead.list", "support.inbox", "system.groupedErrors", "system.jobs", "tenant.featureUsage", "tenant.list", "tenant.ownerPanel",
    ]);
  });
});

describe("последние регистрации", () => {
  it("свежие сверху, ссылкой в карточку", () => {
    show();
    const links = within(screen.getByTestId("recent-signups")).getAllByRole("link").filter(a => a.getAttribute("href")?.startsWith("/super-admin/orgs/"));
    expect(links.map(a => a.getAttribute("href"))).toEqual(["/super-admin/orgs/6", "/super-admin/orgs/5", "/super-admin/orgs/7"]);
  });
});

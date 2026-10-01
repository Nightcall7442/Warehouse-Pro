// @vitest-environment jsdom
/**
 * Оболочка консоли платформы: разделы, значки, только русский, поиск Ctrl+K.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Суперадмин жил в оболочке склада: меню из «Super Admin» и «Мониторинга»,
 * внизу «Справка» (книга дистрибьютора) и переключатель «РУС/UZB»; всё
 * остальное — стопкой на одной странице, карточка организации без своей
 * ссылки. Найти организацию можно было только пролистав до списка.
 * Владелец, 01.10.2026: «вообще каша сейчас… зачем справка; только русский
 * оставь».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · колонка разделов: Обзор, Организации, Заявки, Обращения, Система,
 *     Интеграторы — по нажатию свой адрес; активный помечен;
 *   · значок непрочитанных обращений — числом тредов, где ждут ответа (и на
 *     нижней вкладке телефона), новых заявок — у «Заявок»;
 *   · ни «Справки», ни «РУС/UZB»; при сохранённом «uz» всё по-русски — и в
 *     разметке, и у tt() вне компонентов, а после выхода из консоли язык
 *     человека возвращается;
 *   · карточка «кто вошёл» ведёт в профиль, без второго фактора — так и
 *     сказано;
 *   · нижние вкладки: Обзор, Организации, Обращения, Ещё; заявки и система
 *     подсвечивают «Ещё»;
 *   · Ctrl+K (и в русской раскладке — по месту клавиши) открывает поиск,
 *     ИНН или кусок телефона находит организацию, Enter открывает карточку;
 *   · заголовок шапки телефона и «назад» — по адресу.
 *
 * Нарочная поломка (проверено): считать значок по сообщениям, а не по тредам
 * (`reduce(+unread)`) — падает «значок»; вернуть ConsoleShell без FixedLang —
 * падают «по-русски» и «tt»; искать только по названию (убрать цифры из
 * matches) — падает «Ctrl+K»; ловить Ctrl+K по e.key — падает «русская
 * раскладка».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

const h = vi.hoisted(() => {
  const state = {
    data: {} as Record<string, unknown>,
    user: { id: 1, name: "Владелец платформы", email: "root@system.local", role: "superadmin", totpEnabledAt: null as string | null },
  };
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
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, isLoading: false, logout: () => {} }), hadSession: () => true }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "dark", toggle: () => {} }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/brand/AppBrand", () => ({ AppBrand: () => null }));

const { ConsoleShell } = await import("@/components/superadmin/console/ConsoleShell");
const { activeSection, activeTab, consoleTitle } = await import("@/components/superadmin/console/nav");
const { useLang, tt, currentLang, LangProvider } = await import("@/i18n");

const org = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, slug: `org-${id}`, plan: "pro", status: "active", isSandbox: false, createdAt: new Date(), trialEndsAt: null, planExpiresAt: null,
  ownerEmail: `o${id}@x.uz`, ownerPhone: null, signupSource: null, userCount: 1, orderCount: 0, orderTotal: 0,
  subscription: { status: "active", plan: "pro", trialEndsAt: null, currentPeriodEnds: null },
  orders30: 0, revenue30: 0, lastOrderAt: null, lastLoginAt: null, lastActivityAt: new Date(),
  segment: { client: true, paying: true, trial: false, trialLive: false, renewalDays: null, silentDays: null, active7: true, price: 599000 },
  contactPhone: null, contactEmail: `o${id}@x.uz`, inn: null, ...extra,
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function LangProbe() {
  const { lang } = useLang();
  return <span data-testid="lang">{lang}</span>;
}
// Как в main.tsx: язык человека — снаружи, из сохранённого в браузере.
const show = (path = "/super-admin") => render(
  <LangProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<ConsoleShell><LangProbe /><Where /></ConsoleShell>} />
      </Routes>
    </MemoryRouter>
  </LangProvider>,
);

beforeEach(() => {
  localStorage.clear();
  h.state.user.totpEnabledAt = null;
  h.state.data = {
    "support.inbox": [
      { tenantId: 1, userId: 10, unread: 3 }, { tenantId: 2, userId: 20, unread: 1 }, { tenantId: 3, userId: 30, unread: 0 },
    ],
    "lead.list": [{ id: 1 }, { id: 2 }, { id: 3 }],
    "tenant.list": [
      org(5, "Бухара Сок", { inn: "306554433", contactPhone: "+998935554433" }),
      org(6, "Самарканд Дистрибьюшн", { inn: "305112233", contactPhone: "+998901112233" }),
    ],
  };
});
afterEach(cleanup);

describe("разделы", () => {
  it("шесть разделов по порядку, у каждого свой адрес", () => {
    show();
    const nav = within(screen.getByTestId("console-nav"));
    const labels = nav.getAllByRole("button").map(b => b.textContent?.replace(/\d+$/, ""));
    expect(labels).toEqual(["Обзор", "Организации", "Заявки", "Обращения", "Система", "Интеграторы"]);
    const go: Array<[string, string]> = [
      ["orgs", "/super-admin/orgs"], ["leads", "/super-admin/leads"], ["support", "/super-admin/support"],
      ["system", "/super-admin/system"], ["sandboxes", "/super-admin/sandboxes"], ["overview", "/super-admin"],
    ];
    for (const [key, path] of go) {
      fireEvent.click(screen.getByTestId(`console-nav-${key}`));
      expect(screen.getByTestId("where").textContent).toBe(path);
      expect(screen.getByTestId(`console-nav-${key}`).getAttribute("aria-current")).toBe("page");
    }
  });

  it("карточка организации подсвечивает «Организации»", () => {
    show("/super-admin/orgs/5/subscription");
    expect(screen.getByTestId("console-nav-orgs").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("console-nav-overview").getAttribute("aria-current")).toBeNull();
  });
});

describe("значок", () => {
  it("обращения — числом разговоров, где ждут ответа; заявки — числом новых", () => {
    show();
    expect(screen.getByTestId("console-badge-support").textContent).toBe("2");
    expect(screen.getByTestId("console-badge-leads").textContent).toBe("3");
    // На телефоне — на вкладке «Обращения»; заявки живут в «Ещё».
    expect(screen.getByTestId("console-tab-badge-support").textContent).toBe("2");
    expect(screen.getByTestId("console-tab-badge-more").textContent).toBe("3");
  });

  it("никто не ждёт — значка нет", () => {
    h.state.data["support.inbox"] = [{ tenantId: 1, userId: 10, unread: 0 }];
    h.state.data["lead.list"] = [];
    show();
    expect(screen.queryByTestId("console-badge-support")).toBeNull();
    expect(screen.queryByTestId("console-badge-leads")).toBeNull();
  });
});

describe("только по-русски", () => {
  it("нет «Справки» и переключателя языка", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Справка");
    expect(text).not.toMatch(/РУС|UZB|O'zbek/);
    expect(document.querySelector(".lang-btn")).toBeNull();
    expect(document.querySelector('a[href^="/manual/"]')).toBeNull();
  });

  it("сохранённый «uz» консоль не переводит", () => {
    localStorage.setItem("lang", "uz");
    show();
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(screen.getByTestId("console-nav-orgs").textContent).toContain("Организации");
  });

  it("tt вне компонентов — тоже русский, пока открыта консоль; после — язык человека", () => {
    localStorage.setItem("lang", "uz");
    const { unmount } = show();
    expect(currentLang()).toBe("ru");
    expect(tt("Сохранено", "Saqlandi")).toBe("Сохранено");
    unmount();
    expect(currentLang()).toBe("uz");
  });
});

describe("кто вошёл", () => {
  it("карточка ведёт в профиль; без второго фактора — предупреждение", () => {
    show();
    const card = screen.getByTestId("console-account");
    expect(card.getAttribute("href")).toBe("/settings?section=profile");
    expect(card.textContent).toContain("root@system.local");
    expect(screen.getByTestId("console-totp-off").textContent).toContain("выключен");
  });

  it("второй фактор включён — предупреждения нет", () => {
    h.state.user.totpEnabledAt = "2026-10-01T00:00:00Z";
    show();
    expect(screen.queryByTestId("console-totp-off")).toBeNull();
  });
});

describe("нижние вкладки телефона", () => {
  it("Обзор, Организации, Обращения, Ещё; заявки и система — под «Ещё»", () => {
    show("/super-admin/leads");
    const tabs = within(screen.getByTestId("console-tabs")).getAllByRole("button").map(b => b.getAttribute("aria-label"));
    expect(tabs).toEqual(["Обзор", "Организации", "Обращения", "Ещё"]);
    expect(screen.getByTestId("console-tab-more").getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByTestId("console-tab-support"));
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/support");
    expect(screen.getByTestId("console-tab-support").getAttribute("aria-current")).toBe("page");
  });

  it("правило вкладок и заголовков — по адресу", () => {
    expect(activeSection("/super-admin")).toBe("overview");
    expect(activeSection("/super-admin/orgs/5/danger")).toBe("orgs");
    expect(activeSection("/settings")).toBeNull();
    expect(activeTab("/super-admin/system")).toBe("more");
    expect(activeTab("/settings")).toBe("more");
    expect(consoleTitle("/super-admin/orgs/5/users")).toEqual({ title: "Организация", back: "/super-admin/orgs" });
    expect(consoleTitle("/super-admin/system").back).toBe("/super-admin/more");
    expect(consoleTitle("/super-admin").back).toBeUndefined();
  });
});

describe("поиск организации из любого места", () => {
  const ctrlK = (init: KeyboardEventInit) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, ...init })); });

  it("Ctrl+K открывает, ИНН находит, Enter открывает карточку", () => {
    show("/super-admin/system");
    expect(screen.queryByTestId("org-search")).toBeNull();
    ctrlK({ key: "k", code: "KeyK" });
    const input = screen.getByTestId("org-search-input");
    fireEvent.change(input, { target: { value: "305 112" } });
    const hits = screen.getAllByTestId("org-search-result");
    expect(hits.map(r => r.textContent)).toEqual([expect.stringContaining("Самарканд Дистрибьюшн")]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/orgs/6");
    expect(screen.queryByTestId("org-search")).toBeNull();
  });

  it("кусок телефона и стрелка вниз; русская раскладка (Ctrl+«л») тоже открывает", () => {
    show();
    ctrlK({ key: "л", code: "KeyK" });
    const input = screen.getByTestId("org-search-input");
    fireEvent.change(input, { target: { value: "сок" } });
    expect(screen.getAllByTestId("org-search-result")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "+998 9" } });
    expect(screen.getAllByTestId("org-search-result")).toHaveLength(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/orgs/6");
  });

  it("на телефоне — кнопкой в шапке; пустой запрос показывает недавно активных", () => {
    show();
    fireEvent.click(screen.getByTestId("console-search-button"));
    expect(screen.getAllByTestId("org-search-result")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("org-search-input"), { target: { value: "нет такой" } });
    expect(screen.getByTestId("org-search-empty")).toBeTruthy();
  });
});

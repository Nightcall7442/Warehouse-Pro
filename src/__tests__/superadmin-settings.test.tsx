// @vitest-environment jsdom
/**
 * Настройки суперадмина — одно место для логина, пароля и второго фактора.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В меню суперадмина «Настроек» не было ни сбоку, ни внизу на телефоне, хотя
 * /settings ему открыт. Его «Мой профиль» на /super-admin — урезанная копия
 * формы (имя, телефон, пароль) без второго фактора и без логина, а логин
 * в профиле был только надписью «сменить может администратор организации» —
 * которого у суперадмина нет (владелец, 01.10.2026).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - у суперадмина в боковом и нижнем меню есть «Настройки» → /settings;
 *   - на /settings ему видны «Профиль» и «Внешний вид», а разделов
 *     организации и Telegram (личный чат ему ничего не приносит) — нет;
 *     оператору Telegram по-прежнему виден;
 *   - в профиле логин суперадмина меняется в блоке «Логин и пароль» по кнопке
 *     «Сменить логин» (раскрывается отдельно от смены пароля): без второго фактора просит пароль
 *     и уговаривает включить код, со вторым фактором — просит и код; кнопка
 *     отправляет в user.changeMyLogin почту в нижнем регистре;
 *   - у оператора логин — надпись, поля нет;
 *   - «Мой профиль» на /super-admin — карточка без формы: логин, состояние
 *     второго фактора и «Настройки профиля» → /settings?section=profile;
 *   - на телефоне (/settings без раздела — PhoneProfile) строка «Логин и
 *     пароль» ведёт к тому же блоку профиля (с 01.10.2026 — у всех ролей), а
 *     строки Telegram у суперадмина нет; у оператора — есть.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LangProvider } from "@/i18n";

type TestUser = { id: number; name: string; email: string; phone: string; role: string; totpEnabledAt: string | null };
const h = vi.hoisted(() => {
  const state = {
    user: null as unknown as TestUser,
    navigated: [] as string[],
    search: "",
    mutations: [] as Array<{ path: string; input: unknown }>,
  };
  // tRPC-заглушка на любую глубину: запросы пусты, мутации записываются.
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: undefined, isLoading: false, isError: false, refetch: () => {} });
      if (k === "useMutation") return () => ({ mutate: (input: unknown) => state.mutations.push({ path: path.join("."), input }), isPending: false });
      if (k === "useUtils") return () => make(["utils"]);
      if (k === "invalidate") return () => {};
      return make([...path, k]);
    },
  });
  return { state, trpc: make([]) };
});

vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.state.user, isLoading: false, logout: () => {} }),
  hadSession: () => true,
}));
vi.mock("react-router", () => ({
  useNavigate: () => (to: string) => h.state.navigated.push(to),
  useLocation: () => ({ pathname: "/super-admin", search: "", state: null }),
  useSearchParams: () => [new URLSearchParams(h.state.search), () => {}],
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useAppBrand", () => ({ useAppBrand: () => ({ name: "Warehouse Pro" }) }));
vi.mock("@/hooks/useLocationPing", () => ({ useLocationPing: () => {} }));
vi.mock("@/hooks/useBackToOrders", () => ({ useBackToOrders: () => () => {} }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", toggle: () => {} }) }));
vi.mock("@/components/brand/AppBrand", () => ({ AppBrand: () => null }));
vi.mock("@/components/brand/SupportLine", () => ({ SupportLine: () => null }));
vi.mock("@/components/GlobalSearch", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/TrialBanner", () => ({ TrialBanner: () => null }));
vi.mock("@/components/OfflineQueueBadge", () => ({ OfflineQueueBadge: () => null }));
// Разделы организации здесь не открываются — достаточно, что их нет в списке.
vi.mock("@/components/settings/CompanySettings", () => ({ CompanySettings: () => null }));
vi.mock("@/components/settings/WarehouseSettings", () => ({ WarehouseSettings: () => null }));
vi.mock("@/components/settings/ControlSettings", () => ({ ControlSettings: () => null }));
vi.mock("@/components/settings/InvoiceSettings", () => ({ InvoiceSettings: () => null }));
vi.mock("@/components/settings/PriceListSettings", () => ({ PriceListSettings: () => null }));
vi.mock("@/components/settings/ApiKeySettings", () => ({ ApiKeySettings: () => null }));
vi.mock("@/components/settings/TelegramSettings", () => ({ TelegramSettings: () => null }));
vi.mock("@/components/settings/OneCSettings", () => ({ OneCSettings: () => null }));
vi.mock("@/components/settings/BrandingSettings", () => ({ BrandingSettings: () => null }));
vi.mock("@/components/settings/OperatorAccess", () => ({ OperatorAccess: () => null }));

const Layout = (await import("@/components/Layout")).default;
const Settings = (await import("@/pages/Settings")).default;
const { ProfileSettings } = await import("@/components/settings/ProfileSettings");
const { AdminActions } = await import("@/components/superadmin/AdminActions");
const { PhoneProfile } = await import("@/components/phone/PhoneProfile");

const superadmin = (totp: boolean): TestUser => ({ id: 1, name: "Владелец платформы", email: "superadmin@system.local", phone: "", role: "superadmin", totpEnabledAt: totp ? "2026-10-01T00:00:00Z" : null });
const operator: TestUser = { id: 7, name: "Оператор", email: "op@velora.uz", phone: "", role: "operator", totpEnabledAt: null };

beforeEach(() => {
  h.state.user = superadmin(false);
  h.state.navigated = [];
  h.state.search = "";
  h.state.mutations = [];
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);

describe("меню суперадмина", () => {
  it("сбоку есть «Настройки», и они ведут на /settings", () => {
    const { container } = show(<Layout><div /></Layout>);
    const aside = container.querySelector("aside")!;
    expect(aside, "боковое меню не отрисовалось").toBeTruthy();
    fireEvent.click(within(aside as HTMLElement).getByRole("button", { name: "Настройки" }));
    expect(h.state.navigated).toContain("/settings");
  });

  it("внизу на телефоне есть «Настройки», и они ведут на /settings", () => {
    const { container } = show(<Layout><div /></Layout>);
    const bottom = container.querySelector("nav.bottom-nav-premium") as HTMLElement;
    expect(bottom, "нижнее меню не отрисовалось").toBeTruthy();
    fireEvent.click(within(bottom).getByRole("button", { name: "Настройки" }));
    expect(h.state.navigated).toEqual(["/settings"]);
  });
});

describe("/settings у суперадмина", () => {
  const rail = () => within(screen.getByRole("navigation", { name: "Разделы настроек" }));

  it("профиль и внешний вид есть; организации и Telegram — нет", () => {
    show(<Settings />);
    expect(rail().getByRole("button", { name: /Профиль/ })).toBeTruthy();
    expect(rail().getByRole("button", { name: /Внешний вид/ })).toBeTruthy();
    for (const hidden of ["Telegram", "Компания", "Брендинг", "Склады", "Ключи API", "1С"]) {
      expect(rail().queryByRole("button", { name: new RegExp(hidden) }), hidden).toBeNull();
    }
  });

  it("оператору Telegram по-прежнему виден — скрыт только суперадмину", () => {
    h.state.user = operator;
    show(<Settings />);
    expect(rail().getByRole("button", { name: /Telegram/ })).toBeTruthy();
  });
});

describe("логин в профиле", () => {
  it("суперадмин без второго фактора: поле, пароль, настойчивый совет включить код; отправка — в changeMyLogin", () => {
    show(<ProfileSettings />);
    fireEvent.click(screen.getByTestId("my-login-toggle"));
    const block = within(screen.getByTestId("my-login"));
    expect(screen.getByTestId("my-login-current").textContent).toBe("superadmin@system.local");
    expect(screen.queryByTestId("login-readonly")).toBeNull();
    expect(block.queryByTestId("my-login-code")).toBeNull();
    expect(block.getByTestId("my-login-no-totp").textContent).toMatch(/Включите/);

    const save = screen.getByRole("button", { name: "Сменить логин" }) as HTMLButtonElement;
    expect(save.disabled, "без нового логина и пароля кнопка не должна жать").toBe(true);
    fireEvent.change(block.getByTestId("my-login-email"), { target: { value: " Owner@Warehouse.UZ " } });
    fireEvent.change(block.getByTestId("my-login-password"), { target: { value: "тестовый-пароль-1" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(h.state.mutations).toEqual([{ path: "user.changeMyLogin", input: { email: "owner@warehouse.uz", currentPassword: "тестовый-пароль-1", code: undefined } }]);
  });

  it("суперадмин со вторым фактором: без кода кнопка не жмёт, с кодом — код уходит", () => {
    h.state.user = superadmin(true);
    show(<ProfileSettings />);
    fireEvent.click(screen.getByTestId("my-login-toggle"));
    const block = within(screen.getByTestId("my-login"));
    expect(block.queryByTestId("my-login-no-totp")).toBeNull();
    fireEvent.change(block.getByTestId("my-login-email"), { target: { value: "owner@warehouse.uz" } });
    fireEvent.change(block.getByTestId("my-login-password"), { target: { value: "тестовый-пароль-1" } });
    const save = screen.getByRole("button", { name: "Сменить логин" }) as HTMLButtonElement;
    expect(save.disabled, "со вторым фактором без кода отправлять нечего").toBe(true);
    fireEvent.change(block.getByTestId("my-login-code"), { target: { value: " 123456 " } });
    fireEvent.click(save);
    expect(h.state.mutations).toEqual([{ path: "user.changeMyLogin", input: { email: "owner@warehouse.uz", currentPassword: "тестовый-пароль-1", code: "123456" } }]);
  });

  it("свой же логин — кнопка не жмёт", () => {
    show(<ProfileSettings />);
    fireEvent.click(screen.getByTestId("my-login-toggle"));
    const block = within(screen.getByTestId("my-login"));
    fireEvent.change(block.getByTestId("my-login-email"), { target: { value: "SuperAdmin@System.local" } });
    fireEvent.change(block.getByTestId("my-login-password"), { target: { value: "тестовый-пароль-1" } });
    expect((screen.getByRole("button", { name: "Сменить логин" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("у оператора логин — надпись, поля нет", () => {
    h.state.user = operator;
    show(<ProfileSettings />);
    expect(screen.queryByTestId("my-login-toggle")).toBeNull();
    expect(screen.queryByRole("button", { name: /Сменить логин/ })).toBeNull();
    expect(screen.getByTestId("my-login-current").textContent).toBe("op@velora.uz");
    expect(screen.getByTestId("login-readonly").textContent).toContain("администратор организации");
  });
});

describe("«Мой профиль» на /super-admin", () => {
  it("карточка без формы: логин, второй фактор, «Настройки профиля» → профиль настроек", () => {
    show(<AdminActions />);
    expect(screen.getByTestId("admin-login").textContent).toBe("superadmin@system.local");
    expect(screen.getByTestId("admin-totp").textContent).toContain("Выключен");
    expect(document.querySelectorAll("input").length, "дубль формы профиля вернулся").toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Настройки профиля/ }));
    expect(h.state.navigated).toEqual(["/settings?section=profile"]);
    expect(h.state.mutations).toEqual([]);
  });
});

describe("профиль на телефоне", () => {
  it("суперадмин: строка логина ведёт к блоку «Логин и пароль», Telegram нет", () => {
    show(<PhoneProfile />);
    fireEvent.click(screen.getByTestId("profile-login-row"));
    expect(h.state.navigated).toEqual(["/settings?section=profile&block=login"]);
    expect(screen.queryByText("Telegram")).toBeNull();
  });

  it("оператор: строка логина ведёт к тому же блоку, Telegram на месте", () => {
    h.state.user = operator;
    show(<PhoneProfile />);
    fireEvent.click(screen.getByTestId("profile-login-row"));
    expect(h.state.navigated).toEqual(["/settings?section=profile&block=login"]);
    expect(screen.getByText("Telegram")).toBeTruthy();
  });
});
